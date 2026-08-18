/**
 * Host-owned Terminal Sessions registry (ADR-0004).
 *
 * Sessions live here independently of any WebSocket client. Attach cancels
 * the idle-reclaim timer; the last detach arms it; when it fires with no
 * clients attached the session is killed and forgotten. Reclaim also runs
 * for sessions whose shell already exited — they stay attachable (scrollback
 * replay + exit state) until reaped.
 */
import type { TerminalSession } from "./types.js";

export type ReclaimHook = (id: string) => void;

export class SessionRegistry {
  readonly sessions = new Map<string, TerminalSession>();
  readonly idleReclaimMs: number;
  private reclaimHook: ReclaimHook | null = null;

  constructor(idleReclaimMs: number) {
    this.idleReclaimMs = idleReclaimMs;
  }

  /** Notified when a session leaves the registry (killed or reaped). */
  onReclaim(hook: ReclaimHook) {
    this.reclaimHook = hook;
  }

  add(session: TerminalSession) {
    this.sessions.set(session.id, session);
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  list() {
    return [...this.sessions.values()];
  }

  /** A client attached: cancel any pending idle reclaim. */
  attach(id: string) {
    const s = this.sessions.get(id);
    if (s === undefined) return;
    if (s.idleTimer !== null) {
      clearTimeout(s.idleTimer);
      s.idleTimer = null;
    }
    s.lastDetachedAt = null;
  }

  /** A client detached: arm the idle reclaim when no client remains. */
  detach(id: string) {
    const s = this.sessions.get(id);
    if (s === undefined) return;
    if (s.wsClients.size > 0) return; // still attached
    if (s.idleTimer !== null) return; // already armed
    s.lastDetachedAt = Date.now();
    s.idleTimer = setTimeout(() => {
      s.idleTimer = null;
      if (s.wsClients.size === 0) {
        this.kill(id);
        this.forget(id);
      }
    }, this.idleReclaimMs);
  }

  /** Terminate the shell connection. Returns false when the id is unknown. */
  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (s === undefined) return false;
    if (s.idleTimer !== null) {
      clearTimeout(s.idleTimer);
      s.idleTimer = null;
    }
    try {
      s.stream.end();
      s.client.end();
    } catch {
      /* already gone */
    }
    return true;
  }

  /** Remove from the registry and notify the owner (upgrade-route disposal). */
  forget(id: string) {
    this.sessions.delete(id);
    this.reclaimHook?.(id);
  }
}
