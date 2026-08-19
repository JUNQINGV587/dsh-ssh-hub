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
The single floating window over the entire GUI that hosts the terminal surface (registered in `shell.overlay`, root scope). Draggable (viewport-clamped), resizable, double-click to maximize into the full frame. Inside: a tab strip (items), the item body (one full-window session or a side-by-side group), a sessions panel (right sidebar), and the server drawer. Opening uses a scale+fade animation; when the window loses focus only the frame dims, terminal content stays readable. Closed windows never affect sessions. Magnify and maximize both exit on Esc; Esc never closes the window itself.
_Avoid_: panel, dock, drawer, bottom panel

**Tab**:
An item that shows exactly one Terminal Session full-window, with its own name. The active Tab is remembered; closing a Tab removes the view only — the session keeps running on the host and returns to the unplaced list.
_Avoid_: pane, block (a Block is a pane inside a Workspace), page

**Workspace**:
An item that shows several Terminal Sessions side-by-side (a flat group with one orientation and one draggable divider between members). Members are created by merging Tabs, from the group picker, or by connecting a server "into the current item". A Workspace's ✕ dissolves it back into member Tabs (sessions stay in items).
_Avoid_: grid, layout template, tiling, split tree

**Block**:
One pane of a Workspace holding exactly one Terminal Session. Blocks show a small badge (status dot + name) and hover float actions (magnify, remove). Dragging dividers resizes the members; a member can be magnified to fill the window.
_Avoid_: pane, tile, split, cell

**Unplaced List**:
Sessions not currently in any Tab or Workspace (never placed, or removed from an item). A session returns here when its view is closed; it keeps running until the host reclaims it (ADR-0004). The sessions panel (right sidebar) is the global viewport: every session — placed or unplaced — with status, reclaim countdown, and place/kill actions.
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
