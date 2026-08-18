/**
 * dsh-multi-server — host half.
 *
 * Owns the SSH server store and live terminal sessions, and exposes them to
 * the Web GUI through named routes on ctx.webServer (same-origin,
 * loopback-server model of DSH).
 *
 *   GET    /multi-server/servers              list servers (secrets stripped)
 *   POST   /multi-server/servers              create server
 *   PUT    /multi-server/servers/:id          update server
 *   DELETE /multi-server/servers/:id          remove server (kills its sessions)
 *   POST   /multi-server/servers/:id/test     one-shot connectivity test
 *   GET    /multi-server/xterm.css            xterm stylesheet
 *   GET    /multi-server/sessions             list live SSH sessions
 *   POST   /multi-server/sessions             open a shell on a server
 *   DELETE /multi-server/sessions/:id         close a session
 *   WS     /multi-server/ws/:id               terminal stream (data + resize)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ServerConfig, TerminalSession, TestResult } from "./types.js";
import { ServerStore, resolveDshHome, serverFromInput, type ServerInput } from "./store.js";
import { testConnection, createShellSession } from "./connection.js";

const PREFIX = "/multi-server";
// Bundled by build.mjs into lib/client.css, next to lib/index.js.
const XTERM_CSS_PATH = fileURLToPath(new URL("./client.css", import.meta.url));
let xtermCss: string | null = null;
try {
  xtermCss = readFileSync(XTERM_CSS_PATH, "utf8");
} catch {
  /* css absent — client degrades gracefully */
}

/** Route namespace; the client half must agree. */
export const inject = ["webServer"];

export function apply(ctx: any, _config: unknown) {
  const webServer = ctx.webServer;
  const store = new ServerStore(resolveDshHome());

  /** live terminal sessions: id -> session */
  const sessions = new Map<string, TerminalSession>();
  /** id -> per-session WS upgrade route disposer */
  const upgradeDisposers = new Map<string, () => void>();

  /** Unpredictable session id: readable counter prefix + crypto-random suffix. */
  let sessionCounter = 0;
  const makeId = () => `s${++sessionCounter}-${randomUUID()}`;

  function killSession(id: string): boolean {
    const record = sessions.get(id);
    if (record === undefined) return false;
    try {
      record.stream.end();
      record.client.end();
    } catch {
      /* already gone */
    }
    return true;
  }

  function forgetSession(id: string) {
    sessions.delete(id);
    upgradeDisposers.get(id)?.();
    upgradeDisposers.delete(id);
  }

  /** Reject cross-origin requests: the DSH webserver has no auth by design,
   *  so at minimum never let another origin drive the terminal. */
  function sameOrigin(req: any) {
    const origin = req.headers.origin;
    if (origin === undefined) return true; // non-browser clients and same-origin GETs
    try {
      const host = req.headers.host ?? "";
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const json = (res: any, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: any) =>
    new Promise<any>((resolve, reject) => {
      let text = "";
      req.on("data", (chunk: Buffer) => {
        text += chunk;
        if (text.length > 1_000_000) reject(new Error("body too large"));
      });
      req.on("end", () => {
        try {
          resolve(text.length === 0 ? {} : JSON.parse(text));
        } catch {
          reject(new Error("invalid JSON body"));
        }
      });
      req.on("error", reject);
    });

  /** Wire a session's stream to WebSocket clients (binary data + resize). */
  function registerSessionWs(id: string) {
    const record = sessions.get(id);
    if (record === undefined) return;
    upgradeDisposers.set(
      id,
      webServer.registerUpgrade({
        path: PREFIX + "/ws/" + id,
        handler(req: any, socket: any, head: Buffer) {
          // Same-origin gate BEFORE the existence probe, so the route never
          // answers whether an id exists to cross-origin callers.
          if (!sameOrigin(req)) {
            socket.destroy();
            return;
          }
          const current = sessions.get(id);
          if (current === undefined || current.exited) {
            socket.destroy();
            return;
          }
          const wss = new WebSocketServer({ noServer: true });
          wss.on("connection", (ws) => {
            current.wsClients.add(ws);
            // resend a fresh prompt so the user sees a live shell immediately
            ws.send("\r\n");
            ws.on("message", (data) => {
              if (current.exited) return;
              const text = String(data);
              if (text.startsWith('{"type":"resize"')) {
                try {
                  const body = JSON.parse(text);
                  if (typeof body.cols === "number" && typeof body.rows === "number") {
                    current.stream.setWindow(
                      Math.max(2, Math.min(500, Math.round(body.rows))),
                      Math.max(2, Math.min(500, Math.round(body.cols))),
                      0,
                      0,
                    );
                  }
                } catch {
                  /* ignore malformed resize */
                }
                return;
              }
              try {
                current.stream.write(text);
              } catch {
                /* stream closed */
              }
            });
            ws.on("close", () => {
              current.wsClients.delete(ws);
              // Last client gone: tear the session down (v1: no persistence).
              if (current.wsClients.size === 0 && !current.exited) {
                killSession(id);
                forgetSession(id);
              }
            });
          });
          wss.on("error", () => socket.destroy());
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        },
      }),
    );
  }

  async function openSession(body: any): Promise<{ id: string; label: string; serverName: string; error?: string }> {
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    const server = store.get(serverId);
    if (server === undefined) {
      return { id: "", label: "", serverName: "", error: "unknown server" };
    }
    const cols = clampInt(body.cols, 20, 500, 80);
    const rows = clampInt(body.rows, 5, 200, 24);
    try {
      const session = await createShellSession(server, cols, rows);
      const id = makeId();
      session.id = id;
      sessions.set(id, session);
      registerSessionWs(id);
      // stream -> all websocket clients
      session.stream.on("data", (data: Buffer) => {
        for (const ws of session.wsClients) {
          if (ws.readyState === ws.OPEN) ws.send(data);
        }
      });
      return { id, label: session.label, serverName: server.name };
    } catch (err) {
      return {
        id: "",
        label: "",
        serverName: server.name,
        error: String(err instanceof Error ? err.message : err),
      };
    }
  }

  const disposeRoute = webServer.register({
    kind: "prefix",
    path: PREFIX,
    async handler(req: any, res: any) {
      if (!sameOrigin(req)) {
        json(res, 403, { error: "cross-origin rejected" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      const rest = path.slice(PREFIX.length);
      const method = req.method ?? "GET";

      try {
        // ---- servers ----
        if (rest === "/servers" && method === "GET") {
          json(res, 200, { servers: store.list() });
          return;
        }
        if (rest === "/servers" && method === "POST") {
          const body = await readBody(req);
          // POST always creates: never let the client pick/override an id.
          const input = validateInput(body);
          delete input.id;
          const view = store.upsert(input);
          json(res, 200, { server: view });
          return;
        }
        // POST /servers/test — connectivity test for UNSAVED form input
        if (rest === "/servers/test" && method === "POST") {
          const body = await readBody(req);
          const server = serverFromInput(validateInput(body));
          const result: TestResult = await testConnection(server);
          json(res, 200, result);
          return;
        }

        const serverMatch = rest.match(/^\/servers\/([^/]+)(?:\/(.*))?$/);
        if (serverMatch !== null) {
          const id = serverMatch[1];
          const action = serverMatch[2] ?? "";
          if (action === "" && method === "PUT") {
            const body = await readBody(req);
            const existing = store.get(id);
            if (existing === undefined) {
              json(res, 404, { error: "no such server" });
              return;
            }
            const view = store.upsert(validateInput({ ...body, id }));
            json(res, 200, { server: view });
            return;
          }
          if (action === "" && method === "DELETE") {
            const existed = store.remove(id);
            if (!existed) {
              json(res, 404, { error: "no such server" });
              return;
            }
            // kill sessions bound to this server
            for (const sid of [...sessions.keys()]) {
              if (sessions.get(sid)?.serverId === id) {
                killSession(sid);
                forgetSession(sid);
              }
            }
            json(res, 200, { ok: true });
            return;
          }
          if (action === "test" && method === "POST") {
            const server = store.get(id);
            if (server === undefined) {
              json(res, 404, { error: "no such server" });
              return;
            }
            const result: TestResult = await testConnection(server);
            json(res, 200, result);
            return;
          }
          json(res, 404, { error: "not found" });
          return;
        }

        // ---- xterm css ----
        if (rest === "/xterm.css" && method === "GET") {
          if (xtermCss === null) {
            json(res, 404, { error: "xterm.css not bundled" });
            return;
          }
          res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
          res.end(xtermCss);
          return;
        }

        // ---- sessions ----
        if (rest === "/sessions" && method === "GET") {
          json(res, 200, {
            sessions: [...sessions.values()].map((s) => ({
              id: s.id,
              serverId: s.serverId,
              label: s.label,
              serverName: s.serverName,
              host: s.host,
              username: s.username,
              connectedAt: s.connectedAt,
              exited: s.exited,
              exitDetail: s.exitDetail,
            })),
          });
          return;
        }
        if (rest === "/sessions" && method === "POST") {
          const body = await readBody(req);
          const result = await openSession(body);
          if (result.error) {
            json(res, 502, { error: result.error, serverName: result.serverName });
            return;
          }
          json(res, 200, { id: result.id, label: result.label, serverName: result.serverName });
          return;
        }

        const sessionMatch = rest.match(/^\/sessions\/([^/]+)$/);
        if (sessionMatch !== null && method === "DELETE") {
          const id = sessionMatch[1];
          if (!killSession(id)) {
            json(res, 404, { error: "no such session" });
            return;
          }
          forgetSession(id);
          json(res, 200, { ok: true });
          return;
        }

        json(res, 404, { error: "not found" });
      } catch (err) {
        json(res, 500, { error: String(err instanceof Error ? err.message : err) });
      }
    },
  });

  ctx.effect(() => {
    return () => {
      disposeRoute();
      for (const [, dispose] of upgradeDisposers) dispose();
      upgradeDisposers.clear();
      for (const id of [...sessions.keys()]) killSession(id);
      sessions.clear();
    };
  });

  console.log(
    `[dsh-multi-server] host half active; routes under ${PREFIX} (${store.list().length} servers)`,
  );
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Validate + sanitize client payloads before they touch the store. */
function validateInput(body: any): ServerInput {
  const clean: ServerInput = {};
  if (typeof body.id === "string") clean.id = body.id;
  if (typeof body.name === "string") clean.name = body.name;
  if (typeof body.host === "string") clean.host = body.host;
  if (typeof body.port === "number") clean.port = body.port;
  if (typeof body.username === "string") clean.username = body.username;
  if (typeof body.authKind === "string") clean.authKind = body.authKind;
  if (typeof body.password === "string") clean.password = body.password;
  if (typeof body.privateKey === "string") clean.privateKey = body.privateKey;
  if (typeof body.passphrase === "string") clean.passphrase = body.passphrase;
  if (typeof body.remoteCwd === "string") clean.remoteCwd = body.remoteCwd;
  if (typeof body.readyTimeout === "number") clean.readyTimeout = body.readyTimeout;
  if (typeof body.keepaliveInterval === "number") clean.keepaliveInterval = body.keepaliveInterval;
  if (typeof body.strictHostKey === "boolean") clean.strictHostKey = body.strictHostKey;
  return clean;
}
