# dsh-multi-server

> Multi-server SSH terminal panel for the DeepSeek Harness (DSH) Web GUI.

Manage a list of SSH servers and open **multiple interactive terminals at once** in a bottom panel — like a lightweight web-based multi-tab SSH client built into your DSH conversation.

![panel](https://raw.githubusercontent.com/JUNQINGV587/dsh-multi-server/main/docs/screenshot.png)

## Features

- 🖥️ **Bottom terminal panel** in the DSH Web GUI, toggled with <kbd>Ctrl</kbd>+<kbd>`</kbd>
- 🔖 **Multiple tabs** — one SSH terminal per tab, switch freely, close with one click
- 🔑 **Four auth methods** per server: password, private key (with passphrase), SSH agent, or no-auth (local host keys)
- 🖱️ **Drag to resize** the panel height; height and open/closed state persist across reloads
- 🚀 **Connection testing** before saving a server (latency + auth check)
- 🔒 **Secrets handled safely**: passwords and private keys are stored at rest only in the DSH home data dir (`0600`), are never returned by the API, and can be kept unchanged on edit
- 🧪 Full backend integration test suite against a real SSH daemon

## Requirements

- DeepSeek Harness (DSH) Web GUI running locally (tested on `dsh` ≥ some 2026 build)
- Node.js ≥ 20 (the DSH runtime provides this)
- The machines you connect to must accept SSH logins from the machine DSH runs on

## Installation

```sh
dsh plugin --profile web add dsh-multi-server
```

or install from a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-multi-server
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
   | 连接超时 (Ready timeout) | Optional, default 15 s |
   | Keepalive 间隔 | Optional, default 30 s |

   Use **测试连接** (Test) to verify before saving.

3. Click **新会话** (New session) → pick a server → an SSH terminal opens in a new tab.
4. Type, select-to-copy, right-click-to-paste. Drag the top edge of the panel to resize it.

## Security notes

- Credentials are stored in `$DSH_HOME/plugin-data/multi-server/servers.json` (default `~/.dsh/…`), written with mode `0600`.
- The REST API never returns passwords or private keys — only `hasPassword` / `hasPrivateKey` flags.
- WebSocket terminals are same-origin gated: cross-origin pages cannot connect to a session.
- Connection attempts honor your server's host-key policy via `strictHostKey` (default off); turn it on for stricter verification.
- This is a **trusted-host plugin**: it runs arbitrary shell commands on the servers you configure, on behalf of whoever can reach the DSH web UI. Deploy DSH with proper access control.

## Development

```sh
npm install
npm run build      # bundles lib/index.js (host) + lib/client.js (client) + lib/client.css
npm test           # integration tests against a local test sshd (see tests/)
```

### How it works

- **Host half** (`src/host/`) is a cordis plugin (`inject: ['webServer']`) exposing a REST API under `/multi-server` plus per-session WebSocket upgrade routes. SSH is driven by [`ssh2`](https://github.com/mscdex/ssh2).
- **Client half** (`src/client/`) is a prebuilt React bundle rendered into the `conversation.input.dock` slot, using [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) for the terminal emulator.
- Session data flows: `xterm → ws → ssh2 stream → remote shell`, and back.

### Integration tests

`tests/integration.mjs` spins up a mock of the DSH server (HTTP + WS), applies the plugin, and drives a **real** SSH session against a test `sshd` (default `127.0.0.1:2222`, key auth). Override with `SSH_TEST_HOST`, `SSH_TEST_PORT`, `SSH_TEST_KEY`. See `scripts/setup-test-sshd.sh` for the CI-ready test daemon setup.

## License

MIT © JUNQINGV587
