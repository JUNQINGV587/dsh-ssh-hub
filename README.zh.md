# dsh-ssh-hub

> DeepSeek Harness（DSH）Web GUI 的多服务器 SSH 终端面板插件。

集中管理一批 SSH 服务器，在底部面板里**同时打开多个交互式终端**——相当于把轻量级多标签 SSH 客户端内建进 DSH 会话。


## 特性

- 🖥️ **底部终端面板**：在 DSH Web GUI 底部，用 <kbd>Ctrl</kbd>+<kbd>`</kbd> 开关
- 🔖 **多标签**：每台服务器一个终端标签，随意切换、一键关闭
- 🔑 **四种认证方式**：密码、私钥（支持 passphrase）、SSH Agent、无认证（本机免密）
- 🖱️ **拖拽调高**：面板高度可拖拽，高度与开合状态刷新后保留
- 🚀 **连接测试**：保存服务器前可先测试（连通性 + 认证 + 延迟）
- 🎨 **主题自适应终端**：终端跟随 DSH GUI 的浅色/深色主题（主题服务缺失时回退到系统 `prefers-color-scheme`）；工具栏循环按钮可固定 **跟随界面 / 深色 / 浅色**（按浏览器记忆）。已打开的终端原地热切换。两套调色板均满足 WCAG 对比度门槛（前景/背景 ≥ 7:1，ANSI 色 ≥ 4.5:1），由 `npm test` 强制校验
- ⚙️ **Server Defaults 设置卡片**（DSH ≥ 0.1.0-rc.7）：在 设置 → 插件 → 插件配置 中设置默认连接超时、Keepalive 间隔、主机密钥校验与终端主题；字段留空的服务器继承默认值（服务器设置 > Server Default > 内置常量）
- 🔒 **密钥安全处理**：密码与私钥仅落盘于 DSH 数据目录（`0600` 权限），API 永不回传明文；编辑时留空则保留原值
- 🧪 完整后端集成测试（对接真实 SSH 服务端）

## 环境要求

- DSH Web GUI 在本机运行（在 dsh ≥ 0.1.0-rc.7 上测试通过）。**Server Defaults 设置卡片**需要 `0.1.0-rc.7+`；旧版本上面板功能完全不变，只是没有设置卡片
- Node.js ≥ 20（DSH 运行时自带）
- 目标服务器需允许 DSH 所在机器通过 SSH 登录

## 安装

从 GitHub 仓库安装（推荐）：

```sh
dsh plugin --profile web add github:JUNQINGV587/dsh-ssh-hub
```

> Git 源安装会现场构建包，而 pnpm 默认拦截构建脚本。若安装时报
> "Ignored build scripts" 错误，把 pnpm 打印的构建 key 加到 profile 的
> `pnpm-workspace.yaml` 的 `allowBuilds` 下，再重新执行安装。

或从 npm 安装（发布后可用）：

```sh
dsh plugin --profile web add dsh-ssh-hub
```

或从本地源码安装：

```sh
dsh plugin --profile web add /path/to/dsh-ssh-hub
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
   | 连接超时 | 可选，单位秒；留空 = 继承全局默认（默认 15 秒） |
   | Keepalive 间隔 | 可选，单位秒，`0` 为禁用；留空 = 继承全局默认（默认 30 秒） |
   | 严格主机密钥校验 | 继承全局默认 / 开启 / 关闭；开启要求 known-hosts 条目 |

   保存前可点 **测试连接** 验证。

3. 点 **新会话** → 选择服务器 → 在新标签中打开 SSH 终端。
4. 输入命令、选择即复制、右键粘贴；拖动面板顶边调整高度。
5. 终端默认跟随界面外观。想让终端单独换肤？点工具栏的 **跟随界面 / 深色 / 浅色** 按钮循环切换；选择按浏览器记忆，并立即作用于所有已打开的终端。
6. DSH ≥ 0.1.0-rc.7 时，可在 **设置 → 插件 → 插件配置 → SSH 服务器默认值** 设置留空字段所继承的默认值——包括浏览器本地覆盖为「跟随界面」时使用的默认终端主题。卡片上的 **管理服务器…** 一键直达底部面板的服务器管理。
7. 换新机器？在管理服务器对话框用 **导出配置** / **导入配置**。导出的 JSON **不含任何凭据**——导入后请逐台重新填写密码/密钥。导入一律新增条目，绝不覆盖现有服务器。

## 安全说明

- 凭据以**明文**存储在 `$DSH_HOME/plugin-data/ssh-hub/servers.json`（默认 `~/.dsh/…`），文件权限 `0600`。**文件权限是唯一防线**——不要把这个文件提交、同步或备份到任何不能接受明文凭据的地方。机器密钥加密曾被考虑并否决：同用户进程反正能读到密钥（见 `docs/adr/0001-credential-security-posture.md`）。
- 切换服务器的认证方式会**从磁盘删除**上一认证方式的凭据（如切到 `SSH Agent` 会清除已存密码）。
- REST API 永不返回密码或私钥，只返回 `hasPassword` / `hasPrivateKey` 标记；导出文件同理。
- 终端 WebSocket 做了同源校验：跨源页面无法连接会话。
- 连接遵循服务器的 host key 策略（`strictHostKey` 默认关闭，或按你设置的 Server Default；需要更严格校验可开启）。
- 这是**受信插件**：它会在你配置的服务器上执行任意 shell 命令。请确保 DSH Web 的访问受控。

## 开发

```sh
npm install
npm run build      # 产出 lib/index.js（host）+ lib/client.js（client）+ lib/client.css
npm test           # 集成测试（对接本地测试 sshd，见 tests/）
```

### 工作原理

- **host 半**（`src/host/`）：cordis 插件（`inject: ['webServer']`），暴露 `/ssh-hub` REST API 与按会话注册的 WebSocket upgrade 路由；SSH 走 [`ssh2`](https://github.com/mscdex/ssh2)。
- **client 半**（`src/client/`）：预构建 React bundle，注入 `conversation.input.dock` 槽位，终端模拟器用 [`@xterm/xterm`](https://github.com/xtermjs/xterm.js)。
- 数据流：`xterm → ws → ssh2 stream → 远端 shell`，输出原路返回。

### 集成测试

`tests/integration.mjs` 会启动一个 DSH 服务 mock（HTTP + WS）、挂载插件，并驱动一个**真实** SSH 会话（默认 `127.0.0.1:2222`，密钥认证）。可用 `SSH_TEST_HOST` / `SSH_TEST_PORT` / `SSH_TEST_KEY` 覆盖。测试 sshd 的 CI 就绪搭建脚本见 `scripts/setup-test-sshd.sh`。

`npm test` 会先跑 `scripts/check-contrast.mjs`：两套 Terminal Theme（深/浅）按 WCAG 对比度门槛校验（见 `docs/adr/0002-adaptive-terminal-theme.md`）。

## License

MIT © JUNQINGV587
