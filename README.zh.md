# dsh-ssh-hub

> DeepSeek Harness（DSH）Web GUI 的多服务器 SSH 终端面板插件。

集中管理一批 SSH 服务器，在 DSH 会话里**同时打开多个交互式终端**——相当于把轻量级多标签 SSH 客户端内建进 DSH。终端住在可自由拖动的 **终端浮窗**（shell.overlay）里，配合并排 **组合** 一次盯住多台服务器。

## 特性

- 🪟 **终端浮窗**：一个浮动在整个 GUI 之上的终端窗口（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd> 或左栏「SSH 终端」按钮打开）。拖标题栏移动（不会拖出屏幕）、右下角缩放、双击最大化、<kbd>Esc</kbd> 逐级退出放大/最大化（收起窗口请用 ✕）。打开有轻动画（尊重系统「减弱动态效果」）；窗口失焦时只淡化窗框——终端输出始终清晰可读
- 🗂️ **标签 = 会话**：一个标签页就是一个全窗口会话；标签栏切换（Alt+1-9，F2 重命名，Alt+t 新建）
- 🧱 **组合并排**：点「新建组合」勾选会话即并排；连新服务器可选「加入当前」直接并入当前组合；拖分隔线调比例；块可放大（Alt+m）占满窗口；组合的 ✕ 解散回各会话标签
- 📋 **会话面板**：窗口右上「会话」按钮打开全局会话视口——所有会话（含后台未放置的）照常运行，行内可放入当前组合 / 开新标签 / 终止（两次点击确认），并显示回收倒计时
- ♻️ **会话宿主化**：关闭窗口、移除视图、刷新页面、切换对话都不会杀掉你的 shell；重连回放近期输出、网络抖动自动重连；无查看者的会话默认 30 分钟后回收（可在设置卡调整）
- 🎹 **Wave 风格快捷键可配置**：Alt 系 Wave 预设（Alt+t 新标签、Alt+w 关闭聚焦块 / 组合内移除聚焦成员、Alt+Shift+w 关闭标签 / 组合内解散、组合内 Alt+1-9 聚焦成员、Alt+m 放大）；全部动作可在 设置 → 插件 → 插件配置 → DSH-SSH-HUB → 快捷键 修改（格式校验、DSH 冲突提示、即时生效）
- 🔑 **四种认证方式**：密码、私钥（支持 passphrase）、SSH Agent、无认证（本机免密）
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

1. 点左栏底部的 **SSH 终端**，或按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd> 打开终端浮窗（居中，记住位置与大小）。双击标题栏最大化，<kbd>Esc</kbd> 逐级退出放大/最大化（收起请用 ✕）；拖标题栏移动（不会拖出屏幕）、右下角手柄缩放。
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

3. **开会话**：点窗口标签栏的 **会话** 按钮，再点一台服务器——会话作为自己的标签页打开；也可在 **管理服务器** 抽屉里点/双击某行。
4. **同时盯多台**：点 **新建组合**，勾选会话即并排；连新服务器时选 **加入当前** 直接并入当前组合；拖分隔线调比例；悬停块可放大（Alt+m）占满窗口。组合的 ✕ 解散回各会话标签。
5. **没在盯的会话**：关标签只是移除视图——会话继续在宿主端运行（会有轻提示），并在 **会话** 面板里可见。在面板里可 **放入当前** / **新标签** 放回，或 **终止**（两次点击确认）；后台会话显示回收倒计时。
6. 输入命令、选择即复制、右键粘贴。终端主题：工具栏 **跟随界面 / 深色 / 浅色** 循环切换，按浏览器记忆，立即作用于所有终端。
7. **shell 不会死**：关闭窗口、移除视图、刷新页面、切换对话都只是 UI 脱离——会话在宿主端继续跑，重连回放近期输出、网络抖动自动重连。真正结束会话：在 **会话** 面板里 **终止**（或删除服务器）。无查看者的会话默认 30 分钟后回收，时长可在设置卡调整。
8. 快捷键可配置：设置 → 插件 → 插件配置 → DSH-SSH-HUB → 快捷键（开关窗口 / 最大化）。带格式校验、DSH 冲突提示（不阻止），保存即生效。
9. DSH ≥ 0.1.0-rc.7 时，同一张卡片可设置 **Server Defaults** 默认值——包括浏览器本地覆盖为「跟随界面」时使用的默认终端主题。卡片上的 **管理服务器…** 一键直达窗口的服务器抽屉。
10. 换新机器？在管理服务器对话框用 **导出配置** / **导入配置**。导出的 JSON **不含任何凭据**——导入后请逐台重新填写密码/密钥。导入一律新增条目，绝不覆盖现有服务器。

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

- **host 半**（`src/host/`）：cordis 插件（`inject: ['webServer']`），暴露 `/ssh-hub` REST API 与按会话注册的 WebSocket upgrade 路由；SSH 走 [`ssh2`](https://github.com/mscdex/ssh2)。Terminal Session **宿主化**：脱离任何客户端照常存活，携带滚动环形缓冲（重连回放），无查看者按回收时长回收（默认 30 分钟，可配置；`src/host/registry.ts`、`src/host/scrollback.ts`）。全局 **条目集合**（标签与平面组合）由 `/ssh-hub/workspace` 提供、`/workspace/events` 广播；会话死亡时宿主移除所有对应条目。
- **client 半**（`src/client/`）：预构建 React bundle；终端浮窗渲染进 `shell.overlay` 槽位（全框面、root scope），左栏入口注册在 `sidebar.footer.action`。平面组合（`src/shared/group.mjs`）与快捷键解析（`src/shared/keybind.mjs`）是纯 DOM-free 模块。终端模拟器用 [`@xterm/xterm`](https://github.com/xtermjs/xterm.js)。
- 数据流：`xterm → ws → ssh2 stream → 远端 shell`，输出原路返回。窗口态与最大化态可同时 attach 同一批会话（多客户端广播）。

### 集成测试

`tests/integration.mjs` 会启动一个 DSH 服务 mock（HTTP + WS）、挂载插件，并驱动一个**真实** SSH 会话（默认 `127.0.0.1:2222`，密钥认证）。可用 `SSH_TEST_HOST` / `SSH_TEST_PORT` / `SSH_TEST_KEY` 覆盖。测试 sshd 的 CI 就绪搭建脚本见 `scripts/setup-test-sshd.sh`。

`npm test` 会先跑 `scripts/check-contrast.mjs`（两套 Terminal Theme 的 WCAG 对比度门槛，见 `docs/adr/0002-adaptive-terminal-theme.md`）与 `scripts/check-splittree.mjs`（纯分屏树规则），再跑集成测试。

## License

MIT © JUNQINGV587
