# 快速开始

English: [quickstart.md](quickstart.md)

## 1. 前置条件

- **Node.js >= 20**（通过 `node --version` 确认）。
- **pnpm**（通过 `pnpm --version` 确认；未安装则运行 `npm i -g pnpm`）。
- **macOS** — 推荐首次配置（支持 launchd 守护进程）。Linux 支持前台运行；launchd 仅限 macOS。
- 有访问权限的 **真实 Lark / 飞书账号**。无需提前在开发者后台创建应用——`lmcb init` 向导通过扫码帮你完成。
- 至少一个 CLI 后端已安装且在 `$PATH` 中可用（如 `claude`、`codex` 或 `gemini`）。

## 2. 安装

```bash
git clone <this repo>
cd lark-multi-cli-bridge
pnpm install
pnpm build
```

构建后二进制文件在 `./bin/lmcb.mjs`，可直接用 `node ./bin/lmcb.mjs` 运行，也可全局链接：

```bash
npm link   # 把 `lmcb` 注册到全局
```

## 3. 添加第一个 bot — `lmcb init`

`lmcb init` 是个交互式向导，一次完成三件事：

1. 在你的飞书租户下**创建一个 PersonalAgent 应用**（扫码 60 秒，免开发者后台）
2. 把 bot 配置（`app_id` / `app_secret` / 后端 / cwd）写到 `~/.lark-multi-cli-bridge/bots/<name>.yaml`
3. 安装 **agent skills**（教 LLM bridge 的协议——强烈推荐，跳过会怎样见第 5 步）

```bash
node ./bin/lmcb.mjs init
# 或全局链接后：
lmcb init
```

启动后你会看到：

```
lmcb init — interactive bot setup
```

### 第 1 步 — 选后端

```
— Backend —
  1. claude
  2. codex
  3. gemini
Pick a backend (1/2/3 or name) [1]:
```

输入 `1` / `2` / `3` 或对应名字。直接回车默认是 `claude`。挑你本机已经装好的那个 CLI（`which claude` / `which codex` / `which gemini` 验证）。

### 第 2 步 — 命名 bot

```
Bot name [claude-bot]:
```

默认名是 `<backend>-bot`。回车接受，或输自定义名（必须是 `lowercase-kebab-case`，比如 `claude-prod-bot`）。同 chat 多 bot 协作时建议起有区分度的名字，比如 `claude-dev` + `codex-dev` 而不都叫 `*-bot`。

### 第 3 步 — 选创建应用的方式

```
— Provisioning method —
  1. Scan a QR code with Lark mobile app to auto-create a new app under your tenant (recommended)
  2. Paste an existing App ID + App Secret manually
Pick [1]:
```

#### 选项 1（推荐）— 扫码自动创建

直接回车（或输 `1`），终端依次发生：

```
Starting Lark scan-to-create flow...

Scan this QR code with the Lark mobile app to create a new internal-use application:

  █▀▀▀▀▀█ ▄▀▄▀█ █▀▀▀▀▀█
  █ ███ █ ▀█▄▀▄ █ ███ █
  █ ▀▀▀ █ █▀█▀▀ █ ▀▀▀ █
  ▀▀▀▀▀▀▀ █ █ █ ▀▀▀▀▀▀▀
  ...(二维码 ASCII art)...

QR code expires in about 5 minute(s).
You can also open this URL directly: https://...
```

接下来：
1. **手机打开飞书/Lark**，点右上角扫一扫，对准终端里的二维码。
2. 飞书会弹一个确认页：「lark-multi-cli-bridge 想为你创建一个 PersonalAgent 应用」。点确认。
3. Lark 后台**自动给你创建一个内部应用**——名字默认是 `lark-multi-cli-bridge`，绑定到你的租户，权限自动配齐（`im:message` / `im:resource` 等）、WebSocket 已开、`im.message.receive_v1` 事件已订阅。
4. 应用创建好的瞬间，凭证回到 lmcb，终端输出：

```
✓ App registered successfully.
  App ID:  cli_xxxxxxxxxxxxxxxx
  Secret:  abcd****
  Tenant:  lark

Bot "claude-bot" added.
```

**扫码失败怎么办？** 二维码可能过期（5 分钟），或者你扫了但飞书 app 没弹确认（网络偶发）。终端会问你：

```
Scan-to-create failed: <错误信息>
Retry scan (r) or switch to manual entry (m)? [r]:
```

`r` 重新出二维码；`m` 切到手动模式（见选项 2）。

#### 选项 2 — 手动粘贴已有应用

输 `2` 走手动路径。先选租户：

```
Tenant (lark/feishu) [lark]:
```

国际版用 `lark`、国内版用 `feishu`，决定后续 API 域名。然后终端打印你需要做什么：

```
To get an app_id / app_secret:
  1. Visit https://open.larksuite.com/app    （feishu 则是 https://open.feishu.cn/app）
  2. Create a "Custom App for Internal Use"
  3. Open the app, go to "Credentials & Basic Info" to see App ID + App Secret
  4. Under "Events & Callbacks" enable WebSocket and subscribe `im.message.receive_v1`
  5. Under "Permissions" grant `im:message`, `im:message:send_as_bot`, `im:resource`
  6. Publish a version of the app

Open the developer console in your browser now? [y/N]:
```

输 `y` 会自动打开浏览器到开发者后台。按上面 6 步配完应用，回到终端粘凭证：

```
App ID (cli_...): cli_aa9.....................
App Secret (hidden input): *********************
```

App Secret 是密文输入，敲下去屏幕只显示 `*`，避免被截屏泄漏。

什么时候用选项 2：扫码流程对你的租户被禁、想复用一个手工配过的应用、或在 CI/无显示终端环境跑 init。

### 第 4 步 — 写盘 + 决定是否继续加 bot

bot 配置写到 `~/.lark-multi-cli-bridge/bots/<name>.yaml`，权限 `chmod 600`（仅当前用户可读）。然后：

```
Add another bot? [y/N]:
```

- 输 `y` 回到第 1 步，再添加一个 bot——常见做法是把 `claude-bot` / `codex-bot` / `gemini-bot` 三个一次性加齐，后面拉到群里就能直接 A2A 协作。
- 输 `n`（或回车）走到第 5 步。

### 第 5 步 — 安装 agent skills（强烈推荐）

```
— Agent skills —
Install agent skills globally? (recommended)
  - lark-bridge-overlay: bridge-only conventions (injected blocks, card callbacks, OAuth)
  - lark-im, lark-shared: upstream lark-cli usage guides
Without these, your bot may echo bridge XML metadata to users or mishandle cards.
Install now? [Y/n]:
```

**这步是干什么的**：bridge 在跟 LLM 通信时会注入一些"bridge 专属"的 XML 块（`<bridge_context>` 描述当前 chat、`<quoted_message>` 表示用户引用回复的对象、`<interactive_card>` 表示用户引用的某个卡片等等）。LLM 如果不知道这些约定，可能：
- 把 XML 元数据照原样回复给用户（你会看到 bot 在群里输出一堆 `<chatId>...`）
- 不知道怎么用 `__claude_cb` 让卡片按钮回调到自己
- OAuth `lark-cli auth login` 的设备码流程操作错（device flow 必须前台阻塞）

`lark-bridge-overlay` 这个 skill 就是教 LLM 这些。配套装上游 `larksuite/cli` 的 `lark-im` / `lark-shared` 等域 skill，LLM 还会学到怎么正确调 `lark-cli` 发卡片、发图、查群成员。

**默认回车 = 安装**：

```
Running: bash /Users/.../scripts/install-skills.sh -g -y

✓ installed lark-bridge-overlay → ~/.claude/skills/
✓ installed lark-im → ~/.claude/skills/
✓ installed lark-shared → ~/.claude/skills/
...
```

会装到 `~/.claude/skills/`、`~/.agents/skills/`、`~/.codex/skills/`、`~/.gemini/skills/` 这几个 agent 目录（无所谓你跑哪个后端都生效）。

**跳过（输 `n`）**：终端会提示

```
Skipped. You can install later with: pnpm skills:install -g -y
```

之后想补装就在仓库目录跑：

```bash
pnpm skills:install -g -y                      # 默认装 overlay + lark-im + lark-shared 最小集
UPSTREAM_SKILLS='*' pnpm skills:install -g -y  # 装全部 26 个上游域（lark-base, lark-calendar, lark-doc, …）
```

也可以挑你需要的几个域：

```bash
UPSTREAM_SKILLS=lark-im,lark-base,lark-calendar pnpm skills:install -g -y
```

**已经装过了**：如果 lmcb 检测到 `lark-bridge-overlay` 已经在某个 agent 目录里，会自动跳过这步并打印：

```
Agent skills already installed (lark-bridge-overlay detected). Skipping.
```

### 完成

```
Done. Next steps:
  node ./bin/lmcb.mjs start --foreground   # for first-time debugging
  node ./bin/lmcb.mjs ps                   # see worker state
  In Lark, message the bot to see streaming reply.
```

## 4. 启动 supervisor

第一次调试，建议加 `--foreground` 以便查看实时日志：

```bash
lmcb start --foreground
```

输出类似：

```
[supervisor] Starting worker: claude-bot
[claude-bot] Worker ready
```

后台运行（静默）：

```bash
lmcb start
```

## 5. 在飞书中测试

1. 打开飞书，进入工作台的**内部应用**（或按名称搜索你的 bot）。
2. 与 bot 开启私聊。
3. 发送一条消息。你应该看到一张流式卡片，CLI 的回复会实时更新。
4. 发送 `/help` 查看所有斜杠命令。

## 6. 管理运行中的 bot

| 命令 | 作用 |
|------|------|
| `lmcb ps` | 列出 worker 及状态 |
| `lmcb restart <bot>` | 重启某个 worker |
| `lmcb stop` | 停止 supervisor（连带所有 worker） |
| `lmcb daemon status` | 查看 launchd 服务状态（macOS） |

**飞书聊天中的斜杠命令：**

| 斜杠命令 | 效果 |
|----------|------|
| `/help` | 列出所有斜杠命令 |
| `/new` | 开启新 session（重置对话上下文） |
| `/cd <path>` | 切换工作目录（保留 session） |
| `/ws <name>` | 切换命名工作区（重置 session） |
| `/status` | 显示当前 session 信息 |
| `/stop` | 取消正在运行的 CLI 命令 |
| `/timeout <secs>` | 覆盖此 session 的空闲超时时间 |
| `/access` | 查看或修改 bot 白名单（仅 admin） |
| `/sessions` | 列出所有活跃 session |
| `/reconnect` | 强制 WebSocket 重连 |
| `/doctor` | 输出 CLI 可用性和当前 session 状态 |

## 7. 设为守护进程（macOS）

让 supervisor 在登录时自动启动：

```bash
lmcb daemon install
```

查看状态：

```bash
lmcb daemon status
```

卸载守护进程：

```bash
lmcb daemon uninstall
```

升级代码后重新安装守护进程：

```bash
lmcb daemon uninstall && pnpm build && lmcb daemon install
```

## 8. 排错

**启动时出现 `99992402 field validation failed`**

无害。`fetchAppOwnerOpenId` 调用一个 SDK 接口，请求格式因 SDK 版本而异；lmcb 捕获错误后回退到无 owner 行为继续运行，bot 依然工作正常。完整 SDK 错误对象（含 `field_violations`）现在通过 pino 以 depth-10 序列化输出到 worker 日志——想看哪个字段失败，去 `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` 过滤 `src=lark-sdk` 即可。调用本身的修复是另一个待办。

**日志位置**

```
~/.lark-multi-cli-bridge/logs/supervisor.log
~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log
```

**worker 反复崩溃**

如果 3 分钟内崩溃 5 次，worker 会被自动禁用。修复根本原因（通常是 CLI 路径错误或凭证缺失）后运行：

```bash
lmcb restart <bot-name>
```

**重置后重新开始**

```bash
rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json
lmcb init
```

**为不同后端添加第二个 bot**

```bash
lmcb init
# 在向导中选择不同后端（如 codex）
```

或直接使用 CLI：

```bash
lmcb bot add codex-bot --app-id cli_yyy --app-secret hex_yyy --backend codex
lmcb restart codex-bot
```
