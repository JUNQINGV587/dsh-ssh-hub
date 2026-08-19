/**
 * dsh-ssh-hub — host half.
 *
 * Owns the SSH server store and live terminal sessions, and exposes them to
 * the Web GUI through named routes on ctx.webServer (same-origin,
 * loopback-server model of DSH).
 *
 *   GET    /ssh-hub/servers              list servers (secrets stripped)
 *   POST   /ssh-hub/servers              create server
 *   PUT    /ssh-hub/servers/:id          update server
 *   DELETE /ssh-hub/servers/:id          remove server (kills its sessions)
 *   POST   /ssh-hub/servers/:id/test     one-shot connectivity test
 *   GET    /ssh-hub/servers/export       secret-stripped export (version 1)
 *   POST   /ssh-hub/servers/import       import (always creates new servers)
 *   GET    /ssh-hub/xterm.css            xterm stylesheet
 *   GET    /ssh-hub/defaults             current Server Defaults (seconds)
 *   GET    /ssh-hub/sessions             list live SSH sessions
 *   POST   /ssh-hub/sessions             open a shell on a server
 *   DELETE /ssh-hub/sessions/:id         close a session
 *   WS     /ssh-hub/ws/:id               terminal stream (data + resize)
 *   GET    /ssh-hub/workspace           current workspace collection
 *   PUT    /ssh-hub/workspace           replace the collection (validated)
 *   WS     /ssh-hub/workspace/events    collection pushes (initial + broadcast)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ServerConfig, ServerDefaults, TerminalSession, TestResult } from "./types.js";
import { ServerStore, resolveDshHome, serverFromInput, SECRET_FIELDS, type ServerInput } from "./store.js";
import { testConnection, createShellSession } from "./connection.js";
import { SessionRegistry } from "./registry.js";
import { defaultCollection, normalizeCollection, migrateLegacy } from "../shared/group.mjs";

const PREFIX = "/ssh-hub";
/** Default idle reclaim for a session with no attached clients (ADR-0004). */
const DEFAULT_IDLE_RECLAIM_MS = 30 * 60 * 1000;

/**
 * @typedef {import("../shared/layout.mjs").TreeNode} TreeNode
 */
/** Schema defaults for the `ssh-hub` settings namespace (ADR 0003). */
const DEFAULT_SERVER_DEFAULTS: ServerDefaults = {
  defaultReadyTimeoutSec: 15,
  defaultKeepaliveIntervalSec: 30,
  defaultStrictHostKey: false,
  defaultTerminalTheme: "auto",
};

/** Project a resolved settings section into ServerDefaults, filling defaults. */
function projectServerDefaults(raw: unknown): ServerDefaults {
  const v = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
  const theme =
    v.defaultTerminalTheme === "dark" || v.defaultTerminalTheme === "light"
      ? v.defaultTerminalTheme
      : "auto";
  return {
    defaultReadyTimeoutSec: clamp(num(v.defaultReadyTimeoutSec, 15), 3, 120),
    defaultKeepaliveIntervalSec: clamp(num(v.defaultKeepaliveIntervalSec, 30), 0, 300),
    defaultStrictHostKey: v.defaultStrictHostKey === true,
    defaultTerminalTheme: theme,
  };
}
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

export function apply(ctx: any, config: any) {
  const webServer = ctx.webServer;
  const store = new ServerStore(resolveDshHome());
  /** Idle reclaim for sessions with no attached clients (ADR-0004); tests inject a short value. */
  const idleReclaimMs =
    typeof config?.idleReclaimMs === "number" && config.idleReclaimMs > 0
      ? config.idleReclaimMs
      : DEFAULT_IDLE_RECLAIM_MS;

  /**
   * Current Server Defaults. Starts at the schema defaults; replaced when the
   * rc.7 settings layer resolves (see below).
   */
  let currentDefaults: () => ServerDefaults = () => DEFAULT_SERVER_DEFAULTS;

  // Register the `ssh-hub` settings namespace when the rc.7 settings service
  // is available. Dynamic import keeps the plugin loadable on older DSH
  // profiles that lack the @deepseek-ai/dsh-settings package; when the
  // package exists but the service is absent, installSettingsSection's
  // ctx.inject(["settings"]) simply never fires, so the hardcoded constants
  // stay authoritative (ADR 0003).
  void Promise.all([
    import("@deepseek-ai/dsh-settings"),
    import("@deepseek-ai/schemastery"),
  ])
    .then(([{ installSettingsSection, settingsNamespace }, schemastery]) => {
      const z = (schemastery as any).default ?? schemastery;
      const Config = z.object({
        defaultReadyTimeoutSec: z
          .number().step(1).min(3).max(120)
          .default(DEFAULT_SERVER_DEFAULTS.defaultReadyTimeoutSec),
        defaultKeepaliveIntervalSec: z
          .number().step(1).min(0).max(300)
          .default(DEFAULT_SERVER_DEFAULTS.defaultKeepaliveIntervalSec),
        defaultStrictHostKey: z.boolean().default(DEFAULT_SERVER_DEFAULTS.defaultStrictHostKey),
        defaultTerminalTheme: z
          .union([z.const("auto"), z.const("dark"), z.const("light")])
          .default(DEFAULT_SERVER_DEFAULTS.defaultTerminalTheme),
      });
      installSettingsSection(ctx, settingsNamespace("ssh-hub"), Config, {}, {
        setSource: (source) => {
          currentDefaults = () => projectServerDefaults(source());
        },
        onChange: () => {},
      });
    })
    .catch(() => {
      /* pre-rc.7 DSH: no settings namespace; hardcoded constants apply */
    });

  /** Connection tunables from the current Server Defaults (ms at this seam). */
  const connTunables = () => {
    const d = currentDefaults();
    return {
      readyTimeoutMs: d.defaultReadyTimeoutSec * 1000,
      keepaliveIntervalMs: d.defaultKeepaliveIntervalSec * 1000,
      strictHostKey: d.defaultStrictHostKey,
    };
  };

  /** live terminal sessions: id -> session (host-owned, ADR-0004) */
  const registry = new SessionRegistry(idleReclaimMs);
  /** id -> per-session WS upgrade route disposer */
  const upgradeDisposers = new Map<string, () => void>();

  /* ---- global workspace collection state (ADR-0007) ---- */
  /** The three-layer layout state: workspaces of tabs of split trees. */
  let workspaceState: any = defaultCollection();
  /** Clients subscribed to workspace/events. */
  const workspaceClients = new Set<WebSocket>();

  /** Validate a client-supplied collection: legacy shapes (two/three-layer
   *  with trees) flatten to tabs, then dead sessions are dropped (the host is
   *  authoritative — an item pointing at a gone session is garbage). */
  function sanitizeWorkspaces(input: any) {
    const migrated = Array.isArray(input?.items) ? input : migrateLegacy(input);
    const collection = normalizeCollection(migrated);
    const alive = (id: any) => typeof id === "string" && registry.get(id) !== undefined;
    const items = collection.items
      .map((it: any) => {
        if (it.kind === "tab") return it.sessionId === null || alive(it.sessionId) ? it : null;
        if (it.kind === "workspace") {
          const members = it.members.filter((m: any) => alive(m.sessionId));
          const sizes = it.sizes.slice(0, members.length);
          return members.length === 0 ? null : { ...it, members, sizes };
        }
        return null;
      })
      .filter((it: any) => it !== null);
    return { items, activeIndex: Math.min(collection.activeIndex, Math.max(0, items.length - 1)) };
  }

  function broadcastWorkspaces() {
    const payload = JSON.stringify(workspaceState);
    for (const ws of workspaceClients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  /** A session left the registry: drop it from every item and broadcast. */
  function clearSessionFromWorkspaces(id: string) {
    const items = workspaceState.items
      .map((it: any) => {
        if (it.kind === "tab" && it.sessionId === id) return null;
        if (it.kind === "workspace") {
          const members = it.members.filter((m: any) => m.sessionId !== id);
          const sizes = it.sizes.slice(0, members.length);
          return members.length === 0 ? null : { ...it, members, sizes };
        }
        return it;
      })
      .filter((it: any) => it !== null);
    if (items.length !== workspaceState.items.length || items.some((it: any, i: number) => it !== workspaceState.items[i])) {
      workspaceState = { items, activeIndex: Math.min(workspaceState.activeIndex, Math.max(0, items.length - 1)) };
      broadcastWorkspaces();
    }
  }

  // Reclaim disposes the session's WS upgrade route along with the session,
  // and empties any leaves pointing at it (the blocks stay).
  registry.onReclaim((id) => {
    upgradeDisposers.get(id)?.();
    upgradeDisposers.delete(id);
    clearSessionFromWorkspaces(id);
  });

  /** Unpredictable session id: readable counter prefix + crypto-random suffix. */
  let sessionCounter = 0;
  const makeId = () => `s${++sessionCounter}-${randomUUID()}`;

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
    const record = registry.get(id);
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
          // Exited sessions stay attachable: the client gets the scrollback
          // replay plus the exit state instead of a refused socket.
          const current = registry.get(id);
          if (current === undefined) {
            socket.destroy();
            return;
          }
          const wss = new WebSocketServer({ noServer: true });
          wss.on("connection", (ws) => {
            // Send nothing synchronously: frames written during the upgrade
            // callback are dropped by ws (the socket is not writable yet), so
            // the whole attach + replay moves to the next turn. Ordering stays
            // sound: the client is added to the broadcast set only inside the
            // deferred block, so no live frame can reach it before the replay,
            // and the snapshot taken there still covers any output that
            // arrived in the gap (it all went into the scrollback ring).
            setImmediate(() => {
              registry.attach(id);
              current.wsClients.add(ws);
              const replay = current.buffer.snapshot();
              if (replay.length > 0) ws.send(replay);
              // resend a fresh prompt so the user sees a live shell immediately
              ws.send("\r\n");
            });
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
              // Detach, never kill: the session lives on the host until an
              // explicit close or the idle reclaim (ADR-0004).
              registry.detach(id);
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

  /** Workspace-state event channel: every surface subscribes and converges
   *  on the broadcast collection (ADR-0007). */
  const workspaceEventsDispose = webServer.registerUpgrade({
    path: PREFIX + "/workspace/events",
    handler(req: any, socket: any, head: Buffer) {
      if (!sameOrigin(req)) {
        socket.destroy();
        return;
      }
      const wss = new WebSocketServer({ noServer: true });
      wss.on("connection", (ws) => {
        workspaceClients.add(ws);
        // Defer the initial state like the session replay: frames written
        // synchronously inside the connection event are dropped by ws.
        setImmediate(() => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(workspaceState));
        });
        ws.on("close", () => {
          workspaceClients.delete(ws);
        });
      });
      wss.on("error", () => socket.destroy());
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    },
  });

  async function openSession(body: any): Promise<{ id: string; label: string; serverName: string; error?: string }> {
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    const server = store.get(serverId);
    if (server === undefined) {
      return { id: "", label: "", serverName: "", error: "unknown server" };
    }
    const cols = clampInt(body.cols, 20, 500, 80);
    const rows = clampInt(body.rows, 5, 200, 24);
    try {
      const session = await createShellSession(server, cols, rows, connTunables());
      const id = makeId();
      session.id = id;
      registry.add(session);
      registerSessionWs(id);
      // stream -> scrollback ring + all websocket clients
      session.stream.on("data", (data: Buffer) => {
        session.buffer.push(data);
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
          const result: TestResult = await testConnection(server, connTunables());
          json(res, 200, result);
          return;
        }
        // GET /servers/export — every Server as a ServerView (secrets absent
        // by construction) plus a format version. Literal paths MUST be
        // matched before the /servers/:id regex below.
        if (rest === "/servers/export" && method === "GET") {
          json(res, 200, { version: 1, servers: store.list() });
          return;
        }
        // POST /servers/import — always create, never overwrite (ADR 0001):
        // fresh ids, incoming ids/timestamps/flags discarded, secret fields
        // ignored even when present. Accepts { version, servers } or a bare
        // array, mirroring the store's load tolerance.
        if (rest === "/servers/import" && method === "POST") {
          const body = await readBody(req);
          const list = Array.isArray(body) ? body : body?.servers;
          if (!Array.isArray(list)) {
            json(res, 400, { error: "import body must be an array or { servers: [...] }" });
            return;
          }
          if (!Array.isArray(body) && body?.version !== undefined && body.version !== 1) {
            json(res, 400, { error: `unsupported export version: ${String(body.version)}` });
            return;
          }
          for (const item of list) {
            if (item === null || typeof item !== "object") {
              json(res, 400, { error: "import entries must be objects" });
              return;
            }
            const input = importInput(item);
            if (input === undefined) {
              json(res, 400, { error: "import entries must include a non-empty host and username" });
              return;
            }
            store.upsert(input);
          }
          json(res, 200, { imported: list.length });
          return;
        }

        // ---- Server Defaults (read-only; powers the form's placeholders) ----
        if (rest === "/defaults" && method === "GET") {
          json(res, 200, currentDefaults());
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
            for (const sid of registry.allIds()) {
              if (registry.get(sid)?.serverId === id) {
                registry.kill(sid);
                registry.forget(sid);
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
            const result: TestResult = await testConnection(server, connTunables());
            json(res, 200, result);
            return;
          }
          json(res, 404, { error: "not found" });
          return;
        }

        // ---- global workspace collection (ADR-0007) ----
        if (rest === "/workspace" && method === "GET") {
          json(res, 200, { workspace: workspaceState });
          return;
        }
        if (rest === "/workspace" && method === "PUT") {
          const body = await readBody(req);
          const clean = sanitizeWorkspaces(body);
          workspaceState = clean;
          broadcastWorkspaces();
          json(res, 200, { workspace: workspaceState });
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
            sessions: registry.list().map((s) => ({
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
          if (!registry.kill(id)) {
            json(res, 404, { error: "no such session" });
            return;
          }
          registry.forget(id);
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
      workspaceEventsDispose();
      for (const ws of workspaceClients) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      workspaceClients.clear();
      // clearAll kills and forgets every session; forget() disposes the
      // per-session upgrade routes through the reclaim hook.
      registry.clearAll();
      upgradeDisposers.clear();
    };
  });

  console.log(
    `[dsh-ssh-hub] host half active; routes under ${PREFIX} (${store.list().length} servers)`,
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

/**
 * Sanitize one import entry (ADR 0001): never trust incoming ids, timestamps,
 * flags, or secret fields — the store re-mints everything. Returns undefined
 * when the entry lacks the minimum identity (host + username).
 */
function importInput(item: unknown): ServerInput | undefined {
  const input = validateInput(item);
  delete input.id;
  for (const field of SECRET_FIELDS) delete input[field];
  if (
    typeof input.host !== "string" || input.host.trim().length === 0 ||
    typeof input.username !== "string" || input.username.trim().length === 0
  ) {
    return undefined;
  }
  return input;
}
