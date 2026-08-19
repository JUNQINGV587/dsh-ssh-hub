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
The single floating window over the entire GUI that hosts the terminal surface (registered in `shell.overlay`, root scope). Draggable (viewport-clamped), resizable, double-click to maximize into the full frame. Inside: a Wave-style Tab bar, a Workspace switcher at its left, and the Block grid. Opening uses a scale+fade animation; when the window loses focus only the frame dims, terminal content stays readable. Closed windows never affect sessions.
_Avoid_: panel, dock, drawer, bottom panel

**Workspace**:
A named, iconed, colored set of Tabs — a layout template. A workspace never owns sessions: block leaves reference them, and the global Unplaced List is the single source of truth. Switching workspaces, closing Tabs, or deleting a Workspace keeps every session running in the list. The host owns the collection (served at `/ssh-hub/workspace`, pushed over `/workspace/events`); workspaces are memory-resident, not saved to disk.
_Avoid_: layout, window state (too loose)

**Tab**:
One split tree of Blocks inside a Workspace, with its own name. The active Tab is remembered per Workspace. Closing a Tab returns its sessions to the Unplaced List; creating a Tab makes a single empty Block.
_Avoid_: pane, block (a Block is inside a Tab), page

**Block**:
One pane of the layout holding exactly one Terminal Session (or an empty slot). Blocks live in same-direction lists inside a Tab's layout tree; dragging a block onto another offers 7 Wave drop targets (inline before/after, out-of-line inner/outer, swap) shown as green placeholders; margins resize blocks.
_Avoid_: pane, tile, split, cell

**Layout Tree**:
The flexbox n-tree inside one Tab: a node is a Block or an ordered same-direction list; levels alternate row/column; node sizes are unitless and their sibling ratio decides displacement. New sessions auto-place into the first row (wrapping after five); removing a block compresses depth. A Block can be magnified to fill the window (a subtree view whose edits write back at its path).
_Avoid_: grid, layout template, tiling, split tree

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
