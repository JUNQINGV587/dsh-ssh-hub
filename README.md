# dsh-ssh-hub

> Multi-server SSH terminal panel for the DeepSeek Harness (DSH) Web GUI.

Manage a list of SSH servers and open **multiple interactive terminals at once** — a lightweight, Wave Terminal-style SSH client built into your DSH conversation. Terminals live in one **Terminal Window** floating over the GUI: drag it anywhere, resize it, maximize it with a double-click, and arrange sessions into a recursive **split tree** — split left/right/top/bottom, drag blocks to swap or to open a new pane, all with live RGB-coded drop previews.

## Features

- 🪟 **Terminal Window** — a floating window over the whole GUI (opened with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd> or the SSH 终端 sidebar button): drag by the title bar (kept on screen), resize from the corner, double-click to maximize, <kbd>Esc</kbd> to exit maximized then close. Opening uses a subtle animation (disabled under `prefers-reduced-motion`); when the window loses focus only the frame dims — terminal output always stays readable
- 🌳 **Tabs of flexbox layout trees** — each tab is a Wave-style layout tree (rows and columns of blocks, auto-placed rightward with wrap). Switch tabs in the tab bar (Alt+1-9, F2 renames, Alt+t new); drag a block onto another for all 7 Wave drop targets (inline, out-of-line inner/outer, swap, green placeholders); drag block margins to resize
- 🔍 **Block magnify** — double-click a block's title bar (or Alt+m) to magnify it to fill the window; keep splitting inside it (the tree keeps the result); Alt+m / Esc restores
- 📋 **Unplaced session list** — sessions not currently in the tree keep running in a list panel; click to place one into the focused block
- ♻️ **Host-owned sessions** — closing the window, removing a block, refreshing the page, or switching conversations never kills your shells; they reattach with recent output replayed, and idle sessions are reclaimed after 30 minutes without viewers
- 🎹 **Wave-style configurable shortcuts** — Alt-based Wave preset (Alt+t new tab, Alt+w close block, Alt+Shift+w close tab, Alt+d / Alt+Shift+d split, Alt+m magnify, Ctrl+Shift+1-9 jump to block); every action is configurable in 设置 → 插件 → 插件配置 → DSH-SSH-HUB (validated, DSH-conflict warning, applied immediately)
- 🔑 **Four auth methods** per server: password, private key (with passphrase), SSH agent, or no-auth (local host keys)
- 🚀 **Connection testing** before saving a server (latency + auth check)
- 🎨 **Theme-aware terminals**: the terminal follows the DSH GUI light/dark theme (falling back to the OS `prefers-color-scheme` when the theme service is absent), with a toolbar cycle button to pin **跟随界面 / 深色 / 浅色** (auto / dark / light) per browser. Open terminals hot-swap in place. Both palettes are held to WCAG contrast floors (foreground/background ≥ 7:1, ANSI colors ≥ 4.5:1) enforced in `npm test`
- ⚙️ **Server Defaults settings card** (DSH ≥ 0.1.0-rc.7): set default ready timeout, keepalive interval, host-key verification, and terminal theme in 设置 → 插件 → 插件配置; servers that leave a field blank inherit the default (server field > Server Default > built-in constant)
- 🔒 **Secrets handled safely**: passwords and private keys are stored at rest only in the DSH home data dir (`0600`), are never returned by the API, and can be kept unchanged on edit
- 🧪 Full backend integration test suite against a real SSH daemon

## Requirements

- DeepSeek Harness (DSH) Web GUI (tested on `dsh` ≥ 0.1.0-rc.7). The **Server Defaults settings card** requires `0.1.0-rc.7+`; on older builds the panel works exactly as before, just without the settings card. The panel is **bind-address agnostic**: it works identically whether DSH listens on the default loopback `127.0.0.1:3080` or on `0.0.0.0` for LAN / reverse-proxy access — all requests are derived from the page origin, so no configuration is needed either way. See the security note below before exposing DSH on a non-loopback address.
- Node.js ≥ 20 (the DSH runtime provides this)
- The machines you connect to must accept SSH logins from the machine DSH runs on

## Installation

From the GitHub repository (recommended):

```sh
dsh plugin --profile web add github:JUNQINGV587/dsh-ssh-hub
```

> Git-hosted installs build the package on the spot, and pnpm blocks build
> scripts by default. If the add fails with an "Ignored build scripts" error,
> add the build key pnpm printed under `allowBuilds` in the profile's
> `pnpm-workspace.yaml`, then re-run the add.

or from npm, once published:

```sh
dsh plugin --profile web add dsh-ssh-hub
```

or install from a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-ssh-hub
```

Restart DSH afterwards, refresh the browser, and the terminal panel is available.

## Usage

1. Click **SSH 终端** at the sidebar foot, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd> — the Terminal Window opens (centred, remembered position/size). Double-click its title bar to maximize; <kbd>Esc</kbd> exits magnify/maximize one level (closing the window is the explicit ✕). Drag the title bar to move (it stays on screen), the corner handle to resize.
2. Click **管理服务器** (Manage servers) → **添加服务器** (Add server) and fill in:

   | Field | Description |
   | --- | --- |
   | 名称 (Name) | Display name, e.g. `prod-db-1` |
   | 主机 (Host) | IP or hostname |
   | 端口 (Port) | SSH port, default `22` |
   | 用户名 (Username) | SSH login user |
   | 认证方式 (Auth) | `password` / `privateKey` / `SSH Agent` / `none` |
   | 密码 / 私钥 | Secret — left blank on edit keeps the stored one |
   | 远程初始目录 (Cwd) | Optional initial working directory on the remote |
   | 连接超时 (Ready timeout) | Optional, in seconds; blank = inherit the Server Default (default 15 s) |
   | Keepalive 间隔 | Optional, in seconds, `0` disables; blank = inherit the Server Default (default 30 s) |
   | 严格主机密钥校验 (Strict host key) | Inherit / on / off; on requires a known-hosts entry |

   Use **测试连接** (Test) to verify before saving.

3. **Open a session**: click the **会话** (Sessions) button in the window's tab bar and click a server — a session opens as its own tab. Or use **管理服务器** (Manage servers) → click/double-click a row.
4. **Watch several at once**: click the **新建组合** (New group) button, tick the sessions, and they open side-by-side. Or drag a tab onto another tab to merge them into a group, and onto a group's tab to append a member. Connect more servers with **加入当前** (Join current) to append them to the active group; drag the dividers to resize; magnify a member (hover it, or <kbd>Alt</kbd>+<kbd>m</kbd>) to fill the window. Drag members within a group to reorder them (before/after/swap); drag one out onto the tab strip to make it its own tab again. A group's ✕ dissolves it back into its member tabs.
5. **Sessions you're not watching**: closing a tab removes the view only — the session keeps running on the host (a toast reminds you) and appears in the **会话** (Sessions) panel. From there you can place it back (**放入当前** into the active item, or **新标签** as its own tab) or terminate it (**终止**, two clicks to confirm). A detached session shows its reclaim countdown in the panel.
6. Type, select-to-copy, right-click-to-paste. Theme: the toolbar **跟随界面 / 深色 / 浅色** button cycles the terminal theme; remembered per browser, applied to every open terminal instantly.
7. **Your shells survive**: closing the window, removing a view, refreshing the page, or switching conversations detaches the UI but the sessions keep running on the host, reattaching with recent output replayed. A brief network blip reconnects automatically. Closing a session for good: **终止** it in the 会话 (Sessions) panel (or delete the server). Sessions with no viewers are reclaimed after 30 minutes by default — the window is configurable in the settings card (会话回收时长).
8. Shortcuts are configurable: 设置 → 插件 → 插件配置 → DSH-SSH-HUB → 快捷键 (toggle window, maximize). Values are validated, DSH conflicts warn (not blocked), and changes apply immediately.
9. On DSH ≥ 0.1.0-rc.7, the same card also sets the **Server Defaults** blank server fields inherit — including a default terminal theme used when a browser's override is **跟随界面**. The card's **管理服务器…** link jumps straight to the window's server drawer.
10. Moving to a new machine? Use **导出配置** (Export) / **导入配置** (Import) in the manage-servers dialog. The exported JSON contains **no secrets** — re-enter passwords/keys after importing. Import always adds entries as new servers and never overwrites existing ones.

## Security notes

- Credentials are stored **in plaintext** in `$DSH_HOME/plugin-data/ssh-hub/servers.json` (default `~/.dsh/…`), written with mode `0600`. **File permissions are the only line of defense** — do not commit, sync, or back up this file anywhere plaintext credentials would be unacceptable. Machine-key encryption was considered and rejected: a process running as your user could read the key anyway (see `docs/adr/0001-credential-security-posture.md`).
- Switching a server's auth method **deletes the credentials of the previous method** from disk (e.g. switching to `SSH Agent` wipes the stored password).
- The REST API never returns passwords or private keys — only `hasPassword` / `hasPrivateKey` flags. The export file follows the same rule.
- WebSocket terminals are same-origin gated: cross-origin pages cannot connect to a session.
- Connection attempts honor your server's host-key policy via `strictHostKey` (default off, or the Server Default you set); turn it on for stricter verification.
- This is a **trusted-host plugin**: it runs arbitrary shell commands on the servers you configure, on behalf of whoever can reach the DSH web UI. Deploy DSH with proper access control.
- **Binding DSH to `0.0.0.0` (or any non-loopback address) exposes this panel to your network.** The DSH webserver has no authentication by design, and the same-origin gate deliberately allows requests without an `Origin` header (non-browser clients) — so anyone who can reach the port (e.g. via a LAN IP) can list your configured servers (host/port/username) and open SSH terminals. If you need remote access, put DSH behind an authenticating reverse proxy or restrict the port at the firewall; do not rely on the same-origin gate as an access control.

## Development

```sh
npm install
npm run build      # bundles lib/index.js (host) + lib/client.js (client) + lib/client.css
npm test           # integration tests against a local test sshd (see tests/)

# after bumping + committing a version, keep package.json / tag / release in sync:
npm version minor --no-git-tag-version && git commit -am "chore: bump version"
scripts/release.sh # tags HEAD, pushes, and creates the GitHub release
```

### How it works

- **Host half** (`src/host/`) is a cordis plugin (`inject: ['webServer']`) exposing a REST API under `/ssh-hub` plus per-session WebSocket upgrade routes. SSH is driven by [`ssh2`](https://github.com/mscdex/ssh2). Terminal Sessions are **host-owned**: they survive any client detaching, keep a bounded scrollback ring (replayed on reattach), and are reclaimed after an idle window without viewers (default 30 min, configurable — `src/host/registry.ts`, `src/host/scrollback.ts`). The global **item collection** (tabs and flat groups) is served at `/ssh-hub/workspace` and broadcast over `/workspace/events`; dead-session items are dropped everywhere by the host.
- **Client half** (`src/client/`) is a prebuilt React bundle: the Terminal Window renders in the `shell.overlay` slot (frame-wide, root scope), and a sidebar entry in `sidebar.footer.action` opens it. The flat groups (`src/shared/group.mjs`) and keybinding parsing (`src/shared/keybind.mjs`) are pure DOM-free modules. Terminals use [`@xterm/xterm`](https://github.com/xtermjs/xterm.js).
- Session data flows: `xterm → ws → ssh2 stream → remote shell`, and back. Windowed and maximized states attach to the same sessions (multi-client broadcast).

### Integration tests

`tests/integration.mjs` spins up a mock of the DSH server (HTTP + WS), applies the plugin, and drives a **real** SSH session against a test `sshd` (default `127.0.0.1:2222`, key auth). Override with `SSH_TEST_HOST`, `SSH_TEST_PORT`, `SSH_TEST_KEY`. See `scripts/setup-test-sshd.sh` for the CI-ready test daemon setup.

`npm test` runs `scripts/check-contrast.mjs` and `scripts/check-splittree.mjs` first (Terminal Theme contrast floors — see `docs/adr/0002-adaptive-terminal-theme.md` — and the pure split-tree rules), then the integration suite.

## License

MIT © JUNQINGV587
