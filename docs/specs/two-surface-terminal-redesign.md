# Two-surface terminal redesign: in-flow Dock + frame-wide Focus View, host-owned global sessions

> Spec for the layout/window rework of the SSH terminal panel. Vocabulary follows `CONTEXT.md`; architectural background in ADR-0004 (host-owned Terminal Sessions) and ADR-0005 (two-surface layout). This spec supersedes the README promises that describe the fixed-position bottom panel.

## Problem Statement

From the user's perspective, the current terminal panel gets in the way of working:

- The panel is a fixed-position overlay that **covers** conversation content instead of taking honest layout space, so expanding it always hides part of the conversation.
- The panel cannot be moved, tiled, or focused — height dragging is the only window management available.
- Collapsing the panel, refreshing the page, or switching conversations **kills every terminal session** — running shells (`vim`, `tail -f`) and scrollback are lost.
- There is no way to watch several servers at once; tabs force one-at-a-time viewing even for users who monitor 3–5 machines.
- On small screens the panel eats half the conversation area and offers no better path.

## Solution

Rework the plugin into two surfaces sharing one global world:

- **Dock**: an in-flow workbench above the composer that pushes conversation content up rather than covering it. Collapses to a slim bar; holds the tab strip and at most a two-way split. Follows the slot's hiding semantics (e.g. hidden during a question-card takeover) without killing sessions.
- **Focus View**: a single frame-wide surface covering the whole GUI for focused terminal work, isolated from the conversation, hosting the full Grid (up to four Tiles). Entered via `Ctrl+Shift+`` , the Dock toolbar, or a sidebar-foot entry button; exited with `Esc` or the same shortcut.
- **Host-owned global Terminal Sessions**: sessions live on the host independently of any UI surface; UI attaches/detaches freely; the host reclaims a session after 30 minutes without clients; reattached clients receive a scrollback replay. Sessions and Grid state are global across conversations — switching conversations never loses the world.
- **Grid with preset Layout Templates**: single / left-right / top-bottom / 2×2 / one-large-two-small, at most four Tiles. Users Pin sessions from the tab strip into Tiles; excess Tiles degrade back to the tab strip (without disconnecting) when the viewport is too narrow.

## User Stories

**Dock behavior**

1. As an SSH operator, I want the Dock to take real layout space above the composer, so that expanding it never covers the conversation I'm reading.
2. As an SSH operator, I want the Dock to collapse to a slim bar, so that it stays one shortcut away without stealing space.
3. As an SSH operator, I want my dragged Dock height remembered across reloads, so that the panel reopens the way I left it.
4. As an SSH operator, I want `Ctrl+`` to toggle the Dock as before, so that my muscle memory keeps working.
5. As an SSH operator, I want the Dock to hide when the input zone is taken over (e.g. an agent question card), so that I can focus on answering — without my sessions dying.
6. As an SSH operator, I want the tab strip, status dots, close buttons, and server drawer in the Dock to behave as they do today, so that nothing I rely on regresses.

**Focus View**

7. As an SSH operator, I want a full-screen Focus View, so that terminal work gets the whole window when I need to concentrate.
8. As an SSH operator, I want to enter the Focus View with `Ctrl+Shift+`` or a Dock toolbar button, and leave with `Esc`, so that moving between "watching" and "working" modes is instant.
9. As an SSH operator, I want the Focus View to offer the same toolbar capabilities as the Dock (new session, server drawer, theme cycle, template switch), so that I never have to exit it to manage servers.
10. As an SSH operator, I want the Focus View isolated from the conversation, so that nothing competes with the terminals for my attention.
11. As an SSH operator, I want a terminal button at the sidebar foot that opens the Focus View, so that terminals have a permanent home in the GUI even when the Dock is collapsed or hidden.

**Grid, Tiles, and Pinning**

12. As an SSH operator monitoring several machines, I want to pick a Layout Template (single, left-right, top-bottom, 2×2, one-large-two-small), so that I can see up to four terminals at once without manual fiddling.
13. As an SSH operator, I want to Pin a session from the tab strip into a Tile, so that exactly the machines I'm watching are on screen.
14. As an SSH operator, I want to swap a Tile's session back to the tab strip and pin a different one, so that my monitoring set can change on the fly.
15. As an SSH operator, I want to drag Tiles to reorder them, so that the terminal I care about most sits where my eyes land first.
16. As an SSH operator, I want Tiles beyond the viewport's capacity to fall back to the tab strip automatically, so that I never get unusable slivers of terminal — and I want those sessions to stay connected.
17. As an SSH operator, I want the Dock to offer at most a two-way split while the Focus View offers the full Grid, so that the Dock stays a lightweight "glance" surface.
18. As an SSH operator, I want my template choice and pin assignments to be the same in every conversation and in the Focus View, so that the layout I arrange is the layout I get everywhere.

**Session lifetime**

19. As an SSH operator, I want collapsing the Dock to leave my sessions running, so that `tail -f` keeps following while the panel is closed.
20. As an SSH operator, I want refreshing the page or switching conversations to reconnect me to my running sessions with their recent output intact, so that an accident never costs me a shell.
21. As an SSH operator, I want entering or leaving the Focus View to be a pure UI switch, so that my sessions are never interrupted by changing surfaces.
22. As an SSH operator, I want idle sessions with no viewers to be reclaimed after a timeout, so that forgotten connections don't pile up on the host.
23. As an SSH operator, I want closing a tab or Tile to still terminate that session explicitly, so that I keep final say over what stays alive.

**Cross-cutting**

24. As an SSH operator, I want the terminal theme cycle (follow GUI / dark / light) and its per-browser memory to keep working in both surfaces, so that readability is unchanged.
25. As an SSH operator, I want the Server Defaults settings card and the server drawer to work exactly as before, so that server management is unaffected by the rework.
26. As an SSH operator on a small screen, I want the Focus View to be the obvious path for serious terminal work, so that I'm not fighting a cramped Dock.

## Implementation Decisions

**Host — session registry (new module, ADR-0004)**

- A host-side registry owns all Terminal Sessions. A session's lifetime is independent of any client: it ends only on explicit close or after the idle timeout (30 minutes without attached clients).
- Clients attach and detach over the existing WebSocket channel. The wire protocol gains attach/detach semantics: a client connects by naming the session it wants (creating it on first attach); disconnecting detaches without killing. The last-client-disconnect kill switch is removed.
- The host keeps a bounded scrollback ring buffer per session. On attach, the client receives a replay snapshot before live frames resume.
- The registry reaps idle sessions in the background; reaping is logged and indistinguishable from an explicit close to any later attacher.
- Secrets handling (ADR-0001) is untouched: sessions remain in-memory; nothing is persisted across restarts.

**Host — global Grid state (new, small)**

- Grid state (active Layout Template + Tile→session pin assignments) lives on the host as a single global value, broadcast to all clients. This is what makes "one world, many viewfinders" hold across conversations and surfaces.
- Mutation verbs: set template, pin session to Tile, unpin Tile, reorder Tiles. All clients converge on the broadcast value.

**Client — Dock (reworked surface)**

- The Dock renders in-flow inside the existing `conversation.input.dock` slot registration (same id, order unchanged); the `position: fixed` overlay root is removed. Expanded it occupies honest layout height above the composer; collapsed it is the slim bar.
- The Dock inherits the slot's hiding semantics for free — no special-casing of composer takeovers.
- The Dock caps the Grid at two Tiles; template choices that exceed two Tiles render their overflow in the tab strip.
- Height dragging, height/open persistence, theme cycle, tab strip behavior, and the server drawer are preserved.

**Client — Focus View (new surface)**

- Registered in the frame-wide overlay seat (`shell.overlay`), root scope, one instance. Renders nothing while inactive; entering/exiting is instant because sessions and Grid state are already global.
- Hosts the full Grid (up to four Tiles), the tab strip, and a toolbar with parity to the Dock's (new session, server drawer, theme cycle, template switch). The server drawer is reused as-is.
- Keyboard: `Ctrl+Shift+`` toggles the Focus View; `Esc` exits it. These bindings are active app-wide while the plugin is loaded.

**Client — Sidebar entry (new, minimal)**

- One button registered in the sidebar-foot action seat opens the Focus View. It renders in both wide and rail sidebar modes. Nothing else is added to or replaced in the sidebar.

**Client — pure Grid module (new)**

- Template resolution, pin assignment, reordering, and width-based degradation live in a pure, DOM-free module (same posture as the existing shared terminal-theme module). Both surfaces consume it; tests drive it directly.
- Degradation rule: a Tile requires a minimum usable width; when the viewport can't supply it, the right-most/last-pinned Tiles degrade to the tab strip in order, sessions untouched.

**Deliberately unchanged**

- Server management (drawer, CRUD, connection testing), Secrets posture, Server Views, Server Defaults settings card, Terminal Theme system and its contrast guarantees, README features not listed here.

## Testing Decisions

What makes a good test here: drive the feature through its external boundary — the host WebSocket/HTTP protocol for session behavior, and the pure module's public functions for Grid behavior. No DOM assertions, no React rendering, no implementation internals.

- **Seam A — host integration suite (existing, extended).** The suite already runs the real host half against a real SSH daemon. Extend it to cover: attach/detach round-trips; session survival across client disconnect; scrollback replay on reattach; explicit close still terminating; idle reaping after the timeout (with an injected clock or shortened timeout). Prior art: the existing end-to-end connection/auth/latency tests in the same file.
- **Seam B — pure-module node script (new, modeled on the contrast-check script).** The Grid module is exercised directly: template→Tile geometry, pin/unpin/reorder semantics, degradation order at various viewport widths, Dock two-Tile capping. Prior art: the terminal-theme contrast checker, which tests a shared pure module without a browser.
- The React wiring of Dock / Focus View / sidebar button is **not** unit-tested, matching the repository's current posture (no browser test harness exists today and this spec does not introduce one).

## Out of Scope

- Floating/draggable desktop-style windows (architecturally possible later via the same overlay seat; explicitly deferred).
- tmux-style manual tiling or arbitrary pane resizing; Templates only.
- Grids larger than four Tiles (no 2×3).
- A standalone routed page (the DSH client has no router; the Focus View is the equivalent experience).
- Conversation access inside the Focus View.
- Per-conversation sessions or per-conversation Grid state.
- Persisting sessions or scrollback to disk across host restarts.
- Mobile/touch-specific interactions; small-screen strategy is "use the Focus View".
- Changes to server management, auth kinds, or the settings card.

## Further Notes

- The 30-minute idle timeout is a product default chosen during design; it's a constant, not a user setting, unless real use proves it wrong.
- The sidebar entry is deliberately a single button: the sidebar's browsing and settings seats are single and occupied, and replacing shipped UI there was rejected during design.
- Grid state on the host (rather than per-browser storage) was chosen because the Focus View is a root-scope surface and every conversation's Dock must see the same world; per-browser storage would drift between surfaces.
