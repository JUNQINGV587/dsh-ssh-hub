# Host-owned Terminal Sessions with attach/detach

Status: accepted

Terminal Sessions live on the host independently of any UI surface. Clients attach and detach freely; the host reclaims a session only after an idle timeout (no attached clients). This replaces the v1 behavior where collapsing the panel killed every session (`src/host/index.ts:233-239`, "v1: no persistence").

## Why

The multi-surface redesign (ADR-0005) requires switching between the Dock and the Focus View, pinning sessions into Grid tiles, and surviving conversation switches — none of which is possible if session lifetime is tied to one client's WebSocket. Without host-owned sessions, every surface switch would kill running shells (vim, `tail -f`) and lose scrollback.

## Consequences

- The host needs a session registry with attach/detach refcounting and an idle-timeout reaper (default 30 min without clients).
- Reattached clients need a scrollback snapshot, so the host must buffer recent output per session.
- Secrets still never leave the host (ADR-0001 unchanged); sessions remain in-memory only — nothing is persisted to disk across restarts.

## Considered Options

- **Keep UI-coupled lifetime** (v1): rejected — makes multi-surface switching destructive.
- **tmux-style server-side persistence to disk**: rejected — over-engineered for this plugin's "live monitoring + operation" use; idle-timeout reclaim is enough.
