# dsh-multi-server

> DeepSeek Harness（DSH）Web GUI 的多服务器 SSH 终端面板插件。

集中管理一批 SSH 服务器，在底部面板里**同时打开多个交互式终端**——相当于把轻量级多标签 SSH 客户端内建进 DSH 会话。

![panel](https://raw.githubusercontent.com/JUNQINGV587/dsh-multi-server/main/docs/screenshot.png)

## 特性

- 🖥️ **底部终端面板**：在 DSH Web GUI 底部，用 <kbd>Ctrl</kbd>+<kbd>`</kbd> 开关
- 🔖 **多标签**：每台服务器一个终端标签，随意切换、一键关闭
- 🔑 **四种认证方式**：密码、私钥（支持 passphrase）、SSH Agent、无认证（本机免密）
- 🖱️ **拖拽调高**：面板高度可拖拽，高度与开合状态刷新后保留
- 🚀 **连接测试**：保存服务器前可先测试（连通性 + 认证 + 延迟）
- 🔒 **密钥安全处理**：密码与私钥仅落盘于 DSH 数据目录（`0600` 权限），API 永不回传明文；编辑时留空则保留原值
- 🧪 完整后端集成测试（对接真实 SSH 服务端）

## 环境要求

- DSH Web GUI 在本机运行（在 2026 版 dsh 上测试通过）
- Node.js ≥ 20（DSH 运行时自带）
- 目标服务器需允许 DSH 所在机器通过 SSH 登录

## 安装

```sh
dsh plugin --profile web add dsh-multi-server
```

或从本地源码安装：

```sh
dsh plugin --profile web add /path/to/dsh-multi-server
```

安装后重启 DSH、刷新浏览器，即可使用终端面板。

## 使用方法

1. 按 <kbd>Ctrl</kbd>+<kbd>`</kbd> 打开会话底部的终端面板。
2. 点 **管理服务器** → **添加服务器**，填写：

   | 字段 | 说明 |
   | --- | --- |
   | 名称 | 显示名，如 `prod-db-1` |
   | 主机 | IP 或域名 |
   | 端口 | SSH 端口，默认 `22` |
   | 用户名 | SSH 登录用户 |
   | 认证方式 | `password` / `privateKey` / `SSH Agent` / `none` |
   | 密码 / 私钥 | 密钥字段；编辑时留空 = 保留原值 |
   | 远程初始目录 | 可选，登录后进入的远程目录 |
   | 连接超时 | 可选，默认 15 秒 |
   | Keepalive 间隔 | 可选，默认 30 秒 |

   保存前可点 **测试连接** 验证。

3. 点 **新会话** → 选择服务器 → 在新标签中打开 SSH 终端。
4. 输入命令、选择即复制、右键粘贴；拖动面板顶边调整高度。

## 安全说明

- 凭据存储在 `$DSH_HOME/plugin-data/multi-server/servers.json`（默认 `~/.dsh/…`），文件权限 `0600`。
- REST API 永不返回密码或私钥，只返回 `hasPassword` / `hasPrivateKey` 标记。
- 终端 WebSocket 做了同源校验：跨源页面无法连接会话。
- 连接遵循服务器的 host key 策略（`strictHostKey` 默认关闭，需要更严格校验可开启）。
- 这是**受信插件**：它会在你配置的服务器上执行任意 shell 命令。请确保 DSH Web 的访问受控。

## 开发

```sh
npm install
npm run build      # 产出 lib/index.js（host）+ lib/client.js（client）+ lib/client.css
npm test           # 集成测试（对接本地测试 sshd，见 tests/）
```

### 工作原理

- **host 半**（`src/host/`）：cordis 插件（`inject: ['webServer']`），暴露 `/multi-server` REST API 与按会话注册的 WebSocket upgrade 路由；SSH 走 [`ssh2`](https://github.com/mscdex/ssh2)。
- **client 半**（`src/client/`）：预构建 React bundle，注入 `conversation.input.dock` 槽位，终端模拟器用 [`@xterm/xterm`](https://github.com/xtermjs/xterm.js)。
- 数据流：`xterm → ws → ssh2 stream → 远端 shell`，输出原路返回。

### 集成测试

`tests/integration.mjs` 会启动一个 DSH 服务 mock（HTTP + WS）、挂载插件，并驱动一个**真实** SSH 会话（默认 `127.0.0.1:2222`，密钥认证）。可用 `SSH_TEST_HOST` / `SSH_TEST_PORT` / `SSH_TEST_KEY` 覆盖。测试 sshd 的 CI 就绪搭建脚本见 `scripts/setup-test-sshd.sh`。

## License

MIT © JUNQINGV587
