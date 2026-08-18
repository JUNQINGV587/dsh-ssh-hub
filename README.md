# dsh-ssh-hub

> Multi-server SSH terminal panel for the DeepSeek Harness (DSH) Web GUI.

Manage a list of SSH servers and open **multiple interactive terminals at once** in a bottom panel — like a lightweight web-based multi-tab SSH client built into your DSH conversation.


## Features

- 🖥️ **Bottom terminal panel** in the DSH Web GUI, toggled with <kbd>Ctrl</kbd>+<kbd>`</kbd>
- 🔖 **Multiple tabs** — one SSH terminal per tab, switch freely, close with one click
- 🔑 **Four auth methods** per server: password, private key (with passphrase), SSH agent, or no-auth (local host keys)
- 🖱️ **Drag to resize** the panel height; height and open/closed state persist across reloads
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

1. Press <kbd>Ctrl</kbd>+<kbd>`</kbd> to open the terminal panel at the bottom of the conversation.
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

3. Click **新会话** (New session) → pick a server → an SSH terminal opens in a new tab.
4. Type, select-to-copy, right-click-to-paste. Drag the top edge of the panel to resize it.
5. The terminal follows the GUI appearance. Want a different look for the terminal only? Click the **跟随界面 / 深色 / 浅色** button in the panel toolbar to cycle the theme; your choice is remembered per browser and applies to every open terminal instantly.
6. On DSH ≥ 0.1.0-rc.7, open **设置 → 插件 → 插件配置 → SSH 服务器默认值** to set the defaults blank server fields inherit — including a default terminal theme used when a browser's override is **跟随界面**. The card's **管理服务器…** link jumps straight to the panel's server drawer.
7. Moving to a new machine? Use **导出配置** (Export) / **导入配置** (Import) in the manage-servers dialog. The exported JSON contains **no secrets** — re-enter passwords/keys after importing. Import always adds entries as new servers and never overwrites existing ones.

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
```

### How it works

- **Host half** (`src/host/`) is a cordis plugin (`inject: ['webServer']`) exposing a REST API under `/ssh-hub` plus per-session WebSocket upgrade routes. SSH is driven by [`ssh2`](https://github.com/mscdex/ssh2).
- **Client half** (`src/client/`) is a prebuilt React bundle rendered into the `conversation.input.dock` slot, using [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) for the terminal emulator.
- Session data flows: `xterm → ws → ssh2 stream → remote shell`, and back.

### Integration tests

`tests/integration.mjs` spins up a mock of the DSH server (HTTP + WS), applies the plugin, and drives a **real** SSH session against a test `sshd` (default `127.0.0.1:2222`, key auth). Override with `SSH_TEST_HOST`, `SSH_TEST_PORT`, `SSH_TEST_KEY`. See `scripts/setup-test-sshd.sh` for the CI-ready test daemon setup.

`npm test` runs `scripts/check-contrast.mjs` first: both Terminal Theme variants (dark/light) are validated against the WCAG contrast floors (see `docs/adr/0002-adaptive-terminal-theme.md`).

## License

MIT © JUNQINGV587
