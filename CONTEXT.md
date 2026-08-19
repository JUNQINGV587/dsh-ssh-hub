# dsh-ssh-hub

A DSH Web GUI plugin that lets the user manage named SSH targets and open multiple interactive SSH terminals in a bottom panel.

## Language

**Server**:
A named SSH target the user manages from the panel (host, port, username, auth method). The unit of persistence.
_Avoid_: host, machine, connection

**Auth Kind**:
How the plugin authenticates to a Server: `password`, `privateKey`, `agent`, or `none`.
_Avoid_: auth method, login type

**Secret**:
The credential material of a Server: password, private key (PEM content or file path), key passphrase. Secrets never leave the host process.
_Avoid_: credentials (too broad — usernames are not secrets)

**Server Config**:
The stored record of a Server, including its Secrets.
_Avoid_: server object, entry

**Server Defaults**:
The plugin-level settings document (settings namespace `ssh-hub`): default ready timeout, default keepalive interval, default host-key verification, default Terminal Theme. Connection tunables resolve as **Server field > Server Default > hardcoded constant**; a blank Server field inherits the Server Default. Seconds at the settings boundary, milliseconds inside.
_Avoid_: global defaults (too broad — they govern Server connection behavior only, not panel UI state)

**Server View**:
A Server Config with Secrets stripped, replaced by `hasPassword` / `hasPrivateKey` flags. The only representation clients ever receive.
_Avoid_: DTO, public server

**Terminal Session**:
One live SSH connection plus its shell channel, attached to a Server. Lives on the host independently of any UI surface — UI surfaces attach and detach freely without affecting it, and the host reclaims it only after an idle timeout. Global: shared across all conversations, not owned by any one of them.
_Avoid_: tab (a UI grouping of sessions), connection

**Terminal Window**:
The single floating window over the entire GUI that hosts the terminal surface (registered in `shell.overlay`, root scope). Draggable (viewport-clamped), resizable, double-click to maximize into the full frame — windowed and maximized are two viewports over the same Workspace. Opening uses a scale+fade animation; when the window loses focus only the frame dims, terminal content stays readable. Closed windows never affect sessions.
_Avoid_: panel, dock, drawer, bottom panel

**Workspace**:
The global split tree plus the set of Terminal Sessions. Exactly one workspace; the Terminal Window and its maximized state are viewports over it. Sessions not placed in the tree live in the unplaced list. The host owns the workspace state (served at `/ssh-hub/tree`, pushed over `/tree/events`).
_Avoid_: layout, window state (too loose)

**Block**:
One pane of the Workspace holding exactly one Terminal Session (or an empty slot). Blocks are arranged by recursive binary splits; a block can be split in four directions, its divider dragged, and its session dragged onto another block to swap (centre) or open a new pane (edge, RGB-coded direction preview).
_Avoid_: pane, tile, split, cell

**Split Tree**:
The recursive binary tree of Blocks: a Leaf holds one session (or is empty), a Split has a direction (`h` left/right, `v` top/bottom) and a draggable ratio. The wire schema for `/ssh-hub/tree`.
_Avoid_: grid, layout template, tiling

**Unplaced List**:
Sessions not currently in the Workspace (never placed, or removed from a Block). A session returns here when its Block is removed; it keeps running until the host reclaims it (ADR-0004).
_Avoid_: tab strip, session list (too generic)

**Sidebar Entry**:
A small button at the sidebar foot (`sidebar.footer.action` seat) that opens the Terminal Window. The only incremental sidebar seat.
_Avoid_: launcher, dock button

**Terminal Area**:
Everything inside the terminal body of the panel: the xterm canvas, pane backgrounds, empty state, and error surface. The Terminal Area follows the Terminal Theme; the panel chrome (tab bar, toolbar, status dots, server drawer) always follows the DSH GUI theme.
_Avoid_: terminal body, canvas region

**Theme Override**:
The user's manual preference for the Terminal Theme: `auto` (ask the layer above: the `defaultTerminalTheme` Server Default, then the DSH GUI theme, falling back to `prefers-color-scheme`), `dark`, or `light`. Persisted per browser. A `dark`/`light` override takes precedence over the Server Default; `auto` defers to it. Applies to every open Terminal Session immediately.
_Avoid_: theme setting, mode switch
