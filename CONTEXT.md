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

**Dock**:
The terminal workbench docked at the bottom of the conversation view, sitting in the layout flow above the composer — it pushes conversation content up rather than covering it. Rendered per conversation, but every Dock attaches to the same global Terminal Sessions and the same global Grid state. Holds the tab strip and at most a two-way split.
_Avoid_: panel, bottom panel (the old fixed-position overlay it replaces)

**Focus View**:
A frame-wide surface that covers the entire GUI for focused terminal work. Isolated from the conversation — no chat access inside it. Exactly one global instance. Hosts the full Grid; entered and exited via shortcut (Ctrl+Shift+`), the Dock toolbar button, or the Sidebar Entry — a small button at the sidebar foot (`sidebar.footer.action` seat) that opens the Focus View.
_Avoid_: fullscreen page, route, window

**Grid**:
The arrangement of Tiles showing multiple Terminal Sessions at once. Full Grid (up to four Tiles) lives in the Focus View; the Dock supports at most two Tiles.
_Avoid_: split view, layout (too loose)

**Tile**:
One cell of the Grid, the container for exactly one Terminal Session.
_Avoid_: pane, split

**Layout Template**:
A preset arrangement of Tiles the user picks and then assigns Terminal Sessions to. The shipped set is: single, left-right, top-bottom, 2×2, and one-large-two-small — at most four Tiles. Arbitrary manual splitting (tmux-style) is deliberately not supported.
_Avoid_: layout mode

**Pin**:
Assigning a Terminal Session to a Tile. Unpinned sessions live in the tab strip. When the viewport is too narrow to hold the current Template, excess Tiles degrade automatically: their sessions return to the tab strip without being disconnected.
_Avoid_: stick, lock, dock (that word is taken)

**Terminal Theme**:
The color scheme of the Terminal Area, in two variants `dark` and `light`. Each variant defines foreground, background, cursor, selection, and the full 16-color ANSI palette, with every palette color meeting a minimum contrast ratio against the background.
_Avoid_: color scheme, skin, palette (too loose — includes both variants and the contrast constraint)

**Terminal Area**:
Everything inside the terminal body of the panel: the xterm canvas, pane backgrounds, empty state, and error surface. The Terminal Area follows the Terminal Theme; the panel chrome (tab bar, toolbar, status dots, server drawer) always follows the DSH GUI theme.
_Avoid_: terminal body, canvas region

**Theme Override**:
The user's manual preference for the Terminal Theme: `auto` (ask the layer above: the `defaultTerminalTheme` Server Default, then the DSH GUI theme, falling back to `prefers-color-scheme`), `dark`, or `light`. Persisted per browser. A `dark`/`light` override takes precedence over the Server Default; `auto` defers to it. Applies to every open Terminal Session immediately.
_Avoid_: theme setting, mode switch
