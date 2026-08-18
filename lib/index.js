// src/host/index.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { readFileSync as readFileSync3 } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

// src/host/store.ts
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  chmodSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join as pathJoin, resolve } from "node:path";

// src/host/types.ts
function toServerView(s) {
  const { password: _p, privateKey: _k, passphrase: _pp, ...rest } = s;
  return {
    ...rest,
    hasPassword: Boolean(s.password),
    hasPrivateKey: Boolean(s.privateKey)
  };
}

// src/host/store.ts
var AUTH_KINDS = ["password", "privateKey", "agent", "none"];
var ServerStore = class {
  servers = /* @__PURE__ */ new Map();
  file;
  dir;
  writeChain = Promise.resolve();
  constructor(dshHome) {
    this.dir = pathJoin(dshHome, "plugin-data", "ssh-hub");
    this.file = pathJoin(this.dir, "servers.json");
    this.load();
  }
  load() {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      const list = Array.isArray(raw) ? raw : raw.servers ?? [];
      for (const item of list) {
        if (item && typeof item.id === "string") {
          this.servers.set(item.id, normalizeServer(item));
        }
      }
    } catch (err) {
      console.warn(
        `[dsh-ssh-hub] failed to read ${this.file}: ${String(err?.message ?? err)}`
      );
    }
  }
  /** Serialized write: atomic-ish (temp file + rename), mode 0600. */
  persist() {
    this.writeChain = this.writeChain.then(() => {
      try {
        mkdirSync(this.dir, { recursive: true, mode: 448 });
        const tmp = this.file + ".tmp";
        writeFileSync(tmp, JSON.stringify([...this.servers.values()], null, 2), {
          encoding: "utf8",
          mode: 384
        });
        try {
          chmodSync(tmp, 384);
        } catch {
        }
        renameSync(tmp, this.file);
      } catch (err) {
        console.warn(
          `[dsh-ssh-hub] failed to persist servers: ${String(err?.message ?? err)}`
        );
      }
    });
  }
  list() {
    return [...this.servers.values()].sort((a, b) => (a.name ?? a.host).localeCompare(b.name ?? b.host)).map(toServerView);
  }
  get(id) {
    return this.servers.get(id);
  }
  /** Insert or update. `input` is the raw client payload (may carry secrets). */
  upsert(input) {
    const now = Date.now();
    const existing = input.id ? this.servers.get(input.id) : void 0;
    const config = {
      ...normalizeServer({ ...existing ?? {}, ...input }),
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (existing && config.authKind === "password" && input.password === void 0) {
      config.password = existing.password;
    }
    if (existing && config.authKind === "privateKey" && input.privateKey === void 0) {
      config.privateKey = existing.privateKey;
      config.passphrase = input.passphrase === void 0 ? existing.passphrase : input.passphrase;
    }
    this.servers.set(config.id, config);
    this.persist();
    return toServerView(config);
  }
  remove(id) {
    const existed = this.servers.delete(id);
    if (existed) this.persist();
    return existed;
  }
};
function normalizeServer(raw) {
  const now = Date.now();
  const authKind = AUTH_KINDS.includes(raw.authKind) ? raw.authKind : "password";
  const host = String(raw.host ?? "").trim();
  const username = String(raw.username ?? "").trim();
  const name = String(raw.name ?? "").trim();
  return {
    id: typeof raw.id === "string" ? raw.id : randomUUID(),
    name: name.length > 0 ? name : `${username || "?"}@${host || "?"}`,
    host,
    port: clampInt(raw.port, 1, 65535, 22),
    username,
    authKind,
    password: typeof raw.password === "string" && raw.password.length > 0 ? raw.password : void 0,
    privateKey: typeof raw.privateKey === "string" && raw.privateKey.length > 0 ? raw.privateKey : void 0,
    passphrase: typeof raw.passphrase === "string" && raw.passphrase.length > 0 ? raw.passphrase : void 0,
    remoteCwd: typeof raw.remoteCwd === "string" && raw.remoteCwd.trim().length > 0 ? raw.remoteCwd.trim() : void 0,
    readyTimeout: clampInt(raw.readyTimeout, 1e3, 3e5, 15e3),
    keepaliveInterval: clampInt(raw.keepaliveInterval, 0, 36e5, 3e4),
    strictHostKey: raw.strictHostKey === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now
  };
}
function clampInt(value, min, max, fallback) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
function resolveDshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? resolve(process.env.DSH_HOME) : pathJoin(homedir(), ".dsh");
}
function serverFromInput(input) {
  return normalizeServer({ ...input });
}
function resolveKeyPath(p) {
  if (p === "~" || p.startsWith("~/")) {
    return pathJoin(homedir(), p.slice(2));
  }
  return resolve(p);
}

// src/host/connection.ts
import { Client } from "ssh2";
import { readFileSync as readFileSync2 } from "node:fs";
function buildSsh2Config(s) {
  const base = {
    host: s.host,
    port: s.port,
    username: s.username,
    readyTimeout: s.readyTimeout ?? 15e3,
    keepaliveInterval: s.keepaliveInterval ?? 3e4,
    keepaliveCountMax: 3,
    strictHostKeyChecking: s.strictHostKey === true ? "yes" : "no"
  };
  switch (s.authKind) {
    case "password":
      base.password = s.password ?? "";
      break;
    case "privateKey": {
      const raw = s.privateKey ?? "";
      if (raw.includes("/") || raw.startsWith("~")) {
        const p = resolveKeyPath(raw);
        try {
          base.privateKey = readFileSync2(p);
        } catch (err) {
          throw new Error(`cannot read private key at ${p}: ${String(err?.message ?? err)}`);
        }
      } else if (raw.length > 0) {
        base.privateKey = Buffer.from(raw);
      }
      if (s.passphrase) base.passphrase = s.passphrase;
      break;
    }
    case "agent": {
      const sock = process.env.SSH_AUTH_SOCK;
      if (sock && sock.length > 0) base.agent = sock;
      else base.agent = void 0;
      break;
    }
    case "none":
      break;
  }
  return base;
}
function testConnection(s) {
  return new Promise((resolve2) => {
    const started = Date.now();
    const client = new Client();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
      }
      resolve2(result);
    };
    const timer = setTimeout(() => {
      done({ ok: false, message: "connection timed out" });
    }, (s.readyTimeout ?? 15e3) + 3e3);
    client.on("ready", () => {
      client.exec("true", (err) => {
        if (err) {
          clearTimeout(timer);
          done({ ok: false, message: `connected but exec failed: ${err.message}` });
          return;
        }
        clearTimeout(timer);
        done({ ok: true, message: "ok", latencyMs: Date.now() - started });
      });
    }).on("error", (err) => {
      clearTimeout(timer);
      done({ ok: false, message: err.message });
    }).connect(buildSsh2Config(s));
  });
}
function createShellSession(s, cols, rows) {
  return new Promise((resolve2, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
      }
      reject(err);
    };
    client.on("ready", () => {
      const ptyOpts = {
        term: "xterm-256color",
        cols: Math.max(2, Math.min(500, Math.round(cols))),
        rows: Math.max(2, Math.min(200, Math.round(rows)))
      };
      const openShell = (cb) => {
        if (s.remoteCwd && s.remoteCwd.length > 0) {
          const cd = `cd "${s.remoteCwd.replace(/"/g, '\\"')}" 2>/dev/null || true; exec $SHELL -i`;
          client.exec(cd, { pty: ptyOpts }, cb);
        } else {
          client.shell(ptyOpts, cb);
        }
      };
      openShell((err, stream) => {
        if (err) {
          fail(new Error(`shell failed: ${err.message}`));
          return;
        }
        if (settled) return;
        settled = true;
        const session = {
          id: "",
          serverId: s.id,
          label: `${s.username}@${s.host}:${s.port}`,
          serverName: s.name,
          host: s.host,
          username: s.username,
          client,
          stream,
          connectedAt: Date.now(),
          exited: false,
          exitDetail: null,
          wsClients: /* @__PURE__ */ new Set()
        };
        stream.on("close", () => {
          session.exited = true;
          session.exitDetail = "session closed";
          for (const ws of session.wsClients) {
            try {
              ws.close(1e3, "session closed");
            } catch {
            }
          }
          session.wsClients.clear();
        });
        stream.on("error", (e) => {
          session.exitDetail = e.message;
        });
        resolve2(session);
      });
    }).on("error", (err) => fail(err)).connect(buildSsh2Config(s));
  });
}

// src/host/index.ts
var PREFIX = "/ssh-hub";
var XTERM_CSS_PATH = fileURLToPath(new URL("./client.css", import.meta.url));
var xtermCss = null;
try {
  xtermCss = readFileSync3(XTERM_CSS_PATH, "utf8");
} catch {
}
var inject = ["webServer"];
function apply(ctx, _config) {
  const webServer = ctx.webServer;
  const store = new ServerStore(resolveDshHome());
  const sessions = /* @__PURE__ */ new Map();
  const upgradeDisposers = /* @__PURE__ */ new Map();
  let sessionCounter = 0;
  const makeId = () => `s${++sessionCounter}-${randomUUID2()}`;
  function killSession(id) {
    const record = sessions.get(id);
    if (record === void 0) return false;
    try {
      record.stream.end();
      record.client.end();
    } catch {
    }
    return true;
  }
  function forgetSession(id) {
    sessions.delete(id);
    upgradeDisposers.get(id)?.();
    upgradeDisposers.delete(id);
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin === void 0) return true;
    try {
      const host = req.headers.host ?? "";
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve2, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve2(text.length === 0 ? {} : JSON.parse(text));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
  function registerSessionWs(id) {
    const record = sessions.get(id);
    if (record === void 0) return;
    upgradeDisposers.set(
      id,
      webServer.registerUpgrade({
        path: PREFIX + "/ws/" + id,
        handler(req, socket, head) {
          if (!sameOrigin(req)) {
            socket.destroy();
            return;
          }
          const current = sessions.get(id);
          if (current === void 0 || current.exited) {
            socket.destroy();
            return;
          }
          const wss = new WebSocketServer({ noServer: true });
          wss.on("connection", (ws) => {
            current.wsClients.add(ws);
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
                      0
                    );
                  }
                } catch {
                }
                return;
              }
              try {
                current.stream.write(text);
              } catch {
              }
            });
            ws.on("close", () => {
              current.wsClients.delete(ws);
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
        }
      })
    );
  }
  async function openSession(body) {
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    const server = store.get(serverId);
    if (server === void 0) {
      return { id: "", label: "", serverName: "", error: "unknown server" };
    }
    const cols = clampInt2(body.cols, 20, 500, 80);
    const rows = clampInt2(body.rows, 5, 200, 24);
    try {
      const session = await createShellSession(server, cols, rows);
      const id = makeId();
      session.id = id;
      sessions.set(id, session);
      registerSessionWs(id);
      session.stream.on("data", (data) => {
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
        error: String(err instanceof Error ? err.message : err)
      };
    }
  }
  const disposeRoute = webServer.register({
    kind: "prefix",
    path: PREFIX,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        json(res, 403, { error: "cross-origin rejected" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      const rest = path.slice(PREFIX.length);
      const method = req.method ?? "GET";
      try {
        if (rest === "/servers" && method === "GET") {
          json(res, 200, { servers: store.list() });
          return;
        }
        if (rest === "/servers" && method === "POST") {
          const body = await readBody(req);
          const input = validateInput(body);
          delete input.id;
          const view = store.upsert(input);
          json(res, 200, { server: view });
          return;
        }
        if (rest === "/servers/test" && method === "POST") {
          const body = await readBody(req);
          const server = serverFromInput(validateInput(body));
          const result = await testConnection(server);
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
            if (existing === void 0) {
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
            if (server === void 0) {
              json(res, 404, { error: "no such server" });
              return;
            }
            const result = await testConnection(server);
            json(res, 200, result);
            return;
          }
          json(res, 404, { error: "not found" });
          return;
        }
        if (rest === "/xterm.css" && method === "GET") {
          if (xtermCss === null) {
            json(res, 404, { error: "xterm.css not bundled" });
            return;
          }
          res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
          res.end(xtermCss);
          return;
        }
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
              exitDetail: s.exitDetail
            }))
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
    }
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
    `[dsh-ssh-hub] host half active; routes under ${PREFIX} (${store.list().length} servers)`
  );
}
function clampInt2(value, min, max, fallback) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
function validateInput(body) {
  const clean = {};
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
export {
  apply,
  inject
};
//# sourceMappingURL=index.js.map
