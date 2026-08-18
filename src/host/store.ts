/**
 * Server store — persistent CRUD for SSH target configs.
 *
 * Lives at $DSH_HOME/plugin-data/ssh-hub/servers.json (mode 0600: the
 * file may contain passwords / private key material). The whole store is kept
 * in memory and flushed on every mutation; writes are serialized through a
 * promise chain so concurrent CRUD cannot interleave.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join as pathJoin, resolve } from "node:path";
import type { ServerConfig, ServerView, AuthKind } from "./types.js";
import { toServerView } from "./types.js";

const AUTH_KINDS: AuthKind[] = ["password", "privateKey", "agent", "none"];

export class ServerStore {
  private servers = new Map<string, ServerConfig>();
  private file: string;
  private dir: string;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(dshHome: string) {
    this.dir = pathJoin(dshHome, "plugin-data", "ssh-hub");
    this.file = pathJoin(this.dir, "servers.json");
    this.load();
  }

  private load(): void {
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
        `[dsh-ssh-hub] failed to read ${this.file}: ${String(err?.message ?? err)}`,
      );
    }
  }

  /** Serialized write: atomic-ish (temp file + rename), mode 0600. */
  private persist(): void {
    this.writeChain = this.writeChain.then(() => {
      try {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        const tmp = this.file + ".tmp";
        writeFileSync(tmp, JSON.stringify([...this.servers.values()], null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });
        try {
          chmodSync(tmp, 0o600);
        } catch {
          /* best effort */
        }
        renameSync(tmp, this.file);
      } catch (err) {
        console.warn(
          `[dsh-ssh-hub] failed to persist servers: ${String(err?.message ?? err)}`,
        );
      }
    });
  }

  list(): ServerView[] {
    return [...this.servers.values()]
      .sort((a, b) => (a.name ?? a.host).localeCompare(b.name ?? b.host))
      .map(toServerView);
  }

  get(id: string): ServerConfig | undefined {
    return this.servers.get(id);
  }

  /** Insert or update. `input` is the raw client payload (may carry secrets). */
  upsert(input: ServerInput): ServerView {
    const now = Date.now();
    const existing = input.id ? this.servers.get(input.id) : undefined;
    const config: ServerConfig = {
      ...normalizeServer({ ...(existing ?? {}), ...input }),
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // Empty secret fields on update mean "keep existing"; explicit "clear"
    // markers are handled by the caller sending null-ish values. When a
    // client sends no password/privateKey at all we preserve what we have.
    if (existing && config.authKind === "password" && input.password === undefined) {
      config.password = existing.password;
    }
    if (
      existing &&
      (config.authKind === "privateKey") &&
      input.privateKey === undefined
    ) {
      config.privateKey = existing.privateKey;
      config.passphrase = input.passphrase === undefined ? existing.passphrase : input.passphrase;
    }
    this.servers.set(config.id, config);
    this.persist();
    return toServerView(config);
  }

  remove(id: string): boolean {
    const existed = this.servers.delete(id);
    if (existed) this.persist();
    return existed;
  }
}

/** Raw shape accepted from the client form. */
export interface ServerInput {
  id?: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authKind?: AuthKind;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remoteCwd?: string;
  readyTimeout?: number;
  keepaliveInterval?: number;
  strictHostKey?: boolean;
}

function normalizeServer(raw: Record<string, unknown>): ServerConfig {
  const now = Date.now();
  const authKind = AUTH_KINDS.includes(raw.authKind as AuthKind)
    ? (raw.authKind as AuthKind)
    : "password";
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
    password: typeof raw.password === "string" && raw.password.length > 0 ? raw.password : undefined,
    privateKey: typeof raw.privateKey === "string" && raw.privateKey.length > 0 ? raw.privateKey : undefined,
    passphrase: typeof raw.passphrase === "string" && raw.passphrase.length > 0 ? raw.passphrase : undefined,
    remoteCwd: typeof raw.remoteCwd === "string" && raw.remoteCwd.trim().length > 0 ? raw.remoteCwd.trim() : undefined,
    readyTimeout: clampInt(raw.readyTimeout, 1000, 300000, 15000),
    keepaliveInterval: clampInt(raw.keepaliveInterval, 0, 3600000, 30000),
    strictHostKey: raw.strictHostKey === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Resolve the DSH home directory. */
export function resolveDshHome(): string {
  return process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? resolve(process.env.DSH_HOME)
    : pathJoin(homedir(), ".dsh");
}

/**
 * Build a ServerConfig from a raw client payload WITHOUT touching the store —
 * used by the "test connection" route for unsaved form input.
 */
export function serverFromInput(input: ServerInput): ServerConfig {
  return normalizeServer({ ...input });
}

/** Expand `~` and resolve relative paths for key files. */
export function resolveKeyPath(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return pathJoin(homedir(), p.slice(2));
  }
  return resolve(p);
}

/** Guard against directory traversal / empty storage paths (unused for now). */
export function storageDir(dshHome: string): string {
  return dirname(pathJoin(dshHome, "plugin-data", "ssh-hub", "servers.json"));
}
