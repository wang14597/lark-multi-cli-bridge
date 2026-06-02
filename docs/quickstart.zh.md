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

运行交互式向导：

```bash
node ./bin/lmcb.mjs init
# 或全局链接后：
lmcb init
```

向导流程如下：

**第 1 步 — 选后端**

```
? Backend (1=claude, 2=codex, 3=gemini): 1
```

**第 2 步 — 命名 bot**

```
? Bot name [claude-bot]:
```

按 Enter 接受默认名，或输入自定义名称。

**第 3 步 — 选择创建方式**

```
? Provisioning method (1=scan QR to create app, 2=paste app_id/secret): 1
```

选项 1（默认）— 扫码流程：
- 终端中显示二维码。
- 打开手机上的飞书/Lark 客户端，扫描二维码。
- Lark 在你的租户下自动创建内部应用。
- `app_id` 和 `app_secret` 直接返回给 lmcb，无需打开浏览器。

选项 2 — 手动粘贴：
- 按提示粘贴已有的 `app_id` 和 `app_secret`。

**第 4 步 — 确认**

凭证验证通过后，向导输出：

```
✓ App registered: app_id=cli_xxxxxxxx
```

然后将配置写入 `~/.lark-multi-cli-bridge/bots/<name>.yaml`（chmod 600）。

**第 5 步 — 继续添加 bot**

```
? Add another bot? (y/N):
```

输入 `y` 可返回第 1 步，在同一次向导中继续添加 codex 或 gemini bot。

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
