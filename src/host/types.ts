/**
 * Shared types for dsh-ssh-hub.
 *
 * A "server" is a named SSH target the user manages from the panel. Secrets
 * (password / private key material) are kept out of every API response — the
 * client only ever sees flags like hasPassword / hasPrivateKey.
 */
import type { Client, ClientChannel } from "ssh2";
import type { WebSocket } from "ws";

export type AuthKind = "password" | "privateKey" | "agent" | "none";

/**
 * Server Defaults — the plugin-level settings document (namespace `ssh-hub`).
 * Seconds at the boundary: the settings schema and `settings.yaml` speak
 * seconds; the connection layer converts to milliseconds. Fields with
 * `undefined` on a Server Config inherit these; these in turn fall back to
 * the hardcoded constants (ADR 0003).
 */
export interface ServerDefaults {
  defaultReadyTimeoutSec: number;
  defaultKeepaliveIntervalSec: number;
  defaultStrictHostKey: boolean;
  defaultTerminalTheme: "auto" | "dark" | "light";
}

export interface ServerConfig {
  id: string;
  /** Display name shown in the panel (defaults to user@host). */
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: AuthKind;
  /** Password auth: the password (stored on disk, mode 0600). */
  password?: string;
  /**
   * privateKey auth: either the PEM content itself or a path to a key file
   * ( `~` expands to the user's home, `~/.ssh/id_ed25519` is the usual case).
   */
  privateKey?: string;
  /** Passphrase for an encrypted private key. */
  passphrase?: string;
  /** Optional absolute remote directory to `cd` into on login. */
  remoteCwd?: string;
  /** Connect timeout in ms (default 15000). */
  readyTimeout?: number;
  /** SSH keepalive interval in ms (0 disables, default 30000). */
  keepaliveInterval?: number;
  /** Verify the host key when true; requires a known-hosts entry (default false). */
  strictHostKey?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The server object sent to the client — never contains secrets. */
export type ServerView = Omit<
  ServerConfig,
  "password" | "privateKey" | "passphrase"
> & {
  hasPassword: boolean;
  hasPrivateKey: boolean;
};

export function toServerView(s: ServerConfig): ServerView {
  const { password: _p, privateKey: _k, passphrase: _pp, ...rest } = s;
  return {
    ...rest,
    hasPassword: Boolean(s.password),
    hasPrivateKey: Boolean(s.privateKey),
  };
}

/** A live SSH terminal session (one ssh2 connection + one shell channel). */
export interface TerminalSession {
  id: string;
  serverId: string;
  /** Resolved label: username@host:port */
  label: string;
  serverName: string;
  host: string;
  username: string;
  /** ssh2 Client instance. */
  client: Client;
  /** The shell stream (ClientChannel). */
  stream: ClientChannel;
  connectedAt: number;
  exited: boolean;
  exitDetail: string | null;
  /** WebSocket clients attached to this session. */
  wsClients: Set<WebSocket>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  /** Round-trip latency in ms when ok. */
  latencyMs?: number;
}
