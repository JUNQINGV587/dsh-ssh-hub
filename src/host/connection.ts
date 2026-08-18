/**
 * SSH connection layer over ssh2.
 *
 * - buildSsh2Config: turns a ServerConfig into ssh2 connect options, expanding
 *   private-key paths (and `~`) into key data.
 * - testConnection: one-shot connect/exec('true')/disconnect round trip.
 * - createShellSession: opens a shell channel with an xterm PTY and returns
 *   the live session record; the caller wires it to a WebSocket.
 *
 * Sessions own a dedicated ssh2 connection each — a dropped terminal never
 * disturbs another one, and connection bookkeeping stays trivial.
 */
import { Client, type ConnectConfig } from "ssh2";
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { homedir } from "node:os";
import type { ServerConfig, TerminalSession, TestResult } from "./types.js";
import { resolveKeyPath } from "./store.js";
import { Scrollback } from "./scrollback.js";

/**
 * Connection tunables for one attempt. The server's own field wins; when it
 * is blank (undefined), the Server Default (from the `ssh-hub` settings
 * namespace) applies; when neither exists, the hardcoded constant stands
 * (ADR 0003).
 */
export interface ConnTunables {
  readyTimeoutMs: number;
  keepaliveIntervalMs: number;
  strictHostKey: boolean;
}

/** Hardcoded fallbacks — the bottom of the resolution chain. */
export const DEFAULT_TUNABLES: ConnTunables = {
  readyTimeoutMs: 15000,
  keepaliveIntervalMs: 30000,
  strictHostKey: false,
};

/**
 * Resolve the connection tunables for one Server: Server field > Server
 * Default > hardcoded constant.
 * @param s - the Server Config (fields may be undefined = "inherit").
 * @param defaults - the effective Server Defaults, if a settings layer exists.
 */
export function resolveConnTunables(
  s: ServerConfig,
  defaults?: Partial<ConnTunables>,
): ConnTunables {
  return {
    readyTimeoutMs: s.readyTimeout ?? defaults?.readyTimeoutMs ?? DEFAULT_TUNABLES.readyTimeoutMs,
    keepaliveIntervalMs:
      s.keepaliveIntervalMs ?? defaults?.keepaliveIntervalMs ?? DEFAULT_TUNABLES.keepaliveIntervalMs,
    strictHostKey: s.strictHostKey ?? defaults?.strictHostKey ?? DEFAULT_TUNABLES.strictHostKey,
  };
}

export function buildSsh2Config(s: ServerConfig, defaults?: Partial<ConnTunables>): ConnectConfig {
  const t = resolveConnTunables(s, defaults);
  const base: ConnectConfig = {
    host: s.host,
    port: s.port,
    username: s.username,
    readyTimeout: t.readyTimeoutMs,
    keepaliveInterval: t.keepaliveIntervalMs,
    keepaliveCountMax: 3,
    strictHostKeyChecking: t.strictHostKey ? "yes" : "no",
  };

  switch (s.authKind) {
    case "password":
      base.password = s.password ?? "";
      break;
    case "privateKey": {
      const raw = s.privateKey ?? "";
      // Path (contains '/' or starts with '~') vs inline PEM content.
      if (raw.includes("/") || raw.startsWith("~")) {
        const p = resolveKeyPath(raw);
        try {
          base.privateKey = readFileSync(p);
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
      // Unix: use $SSH_AUTH_SOCK if present; ssh2 also supports 'pageant'.
      const sock = process.env.SSH_AUTH_SOCK;
      if (sock && sock.length > 0) base.agent = sock;
      else base.agent = undefined; // let ssh2 try its default agent
      break;
    }
    case "none":
      // No auth — only sensible against test/allow-empty-password sshds.
      break;
  }
  return base;
}

export function testConnection(
  s: ServerConfig,
  defaults?: Partial<ConnTunables>,
): Promise<TestResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const client = new Client();
    const tunables = resolveConnTunables(s, defaults);
    let settled = false;
    const done = (result: TestResult) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ok: false, message: "connection timed out" });
    }, tunables.readyTimeoutMs + 3000);

    client
      .on("ready", () => {
        client.exec("true", (err) => {
          if (err) {
            clearTimeout(timer);
            done({ ok: false, message: `connected but exec failed: ${err.message}` });
            return;
          }
          clearTimeout(timer);
          done({ ok: true, message: "ok", latencyMs: Date.now() - started });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        done({ ok: false, message: err.message });
      })
      .connect(buildSsh2Config(s));
  });
}

/**
 * Open an interactive shell on the server. Resolves with the session record
 * once the channel is up; rejects on connect/channel failure.
 */
export function createShellSession(
  s: ServerConfig,
  cols: number,
  rows: number,
  defaults?: Partial<ConnTunables>,
): Promise<TerminalSession> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    client
      .on("ready", () => {
        const ptyOpts: Record<string, unknown> = {
          term: "xterm-256color",
          cols: Math.max(2, Math.min(500, Math.round(cols))),
          rows: Math.max(2, Math.min(200, Math.round(rows))),
        };
        const openShell = (cb: (err: Error | undefined, stream?: any) => void) => {
          if (s.remoteCwd && s.remoteCwd.length > 0) {
            // Open a shell already sitting in remoteCwd: ssh2 has no
            // "start shell in dir" option, so exec a cd + interactive shell
            // under a PTY (exec({pty}) is supported since ssh2@1.x).
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
          const session: TerminalSession = {
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
            wsClients: new Set(),
            buffer: new Scrollback(),
            lastDetachedAt: null,
            idleTimer: null,
          };
          stream.on("close", () => {
            session.exited = true;
            session.exitDetail = "session closed";
            for (const ws of session.wsClients) {
              try {
                ws.close(1000, "session closed");
              } catch {
                /* ignore */
              }
            }
            session.wsClients.clear();
          });
          stream.on("error", (e: Error) => {
            session.exitDetail = e.message;
          });
          resolve(session);
        });
      })
      .on("error", (err) => fail(err))
      .connect(buildSsh2Config(s, defaults));
  });
}

/** Resolve the default private key candidate list for the form's convenience. */
export function defaultKeyHints(): string[] {
  const home = homedir();
  const sshDir = pathJoin(home, ".ssh");
  return [
    pathJoin(sshDir, "id_ed25519"),
    pathJoin(sshDir, "id_rsa"),
    pathJoin(sshDir, "id_ecdsa"),
  ];
}
