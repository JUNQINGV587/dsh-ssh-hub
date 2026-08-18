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

**Server View**:
A Server Config with Secrets stripped, replaced by `hasPassword` / `hasPrivateKey` flags. The only representation clients ever receive.
_Avoid_: DTO, public server

**Terminal Session**:
One live SSH connection plus its shell channel, attached to a Server. Ephemeral — never persisted.
_Avoid_: tab (a UI grouping of sessions), connection

**Terminal Theme**:
The color scheme of the Terminal Area, in two variants `dark` and `light`. Each variant defines foreground, background, cursor, selection, and the full 16-color ANSI palette, with every palette color meeting a minimum contrast ratio against the background.
_Avoid_: color scheme, skin, palette (too loose — includes both variants and the contrast constraint)

**Terminal Area**:
Everything inside the terminal body of the panel: the xterm canvas, pane backgrounds, empty state, and error surface. The Terminal Area follows the Terminal Theme; the panel chrome (tab bar, toolbar, status dots, server drawer) always follows the DSH GUI theme.
_Avoid_: terminal body, canvas region

**Theme Override**:
The user's manual preference for the Terminal Theme: `auto` (follow the DSH GUI theme, falling back to `prefers-color-scheme`), `dark`, or `light`. Persisted per browser. Applies to every open Terminal Session immediately.
_Avoid_: theme setting, mode switch
