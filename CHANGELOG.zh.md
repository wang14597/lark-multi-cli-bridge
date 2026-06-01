# 变更日志

本项目所有重要变更均记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com)。

English: [CHANGELOG.md](CHANGELOG.md)

## [v0.5.1] - 2026-06-01

### 新增

- **卡片按钮回调处理**：点击流式卡片上的 ⏹ 按钮，现在会触发 `dispatcher.abort(chatId)` 并终止正在运行的任务。
- `src/lark/card-action.ts` — `parseCardActionEvent` + `CardActionEvent` 类型，支持防御性双形状解析（`open_chat_id` / `chat_id` 兜底）。
- `LarkWsClient` 在 `im.message.receive_v1` 之外新增注册 `card.action.trigger`，并发出类型化的 `'card-action'` 事件。
- Worker 监听 `'card-action'`，将 `cmd: 'stop'` 通过与入站消息相同的访问控制门后路由处理。

## [v0.4.0] - 2026-05-31

### 变更

- **流式卡片 UI 重写**，对齐 `feishu-claude-code-bridge` 的精美风格：无头部栏、`streaming_mode` 切换、可折叠思考面板 + 工具面板、底部状态栏、终态备注、停止按钮。

### 新增

- `src/lark/run-state.ts` — RunState 数据模型 + 变更辅助函数。
- `src/lark/tool-render.ts` — 工具面板渲染用的 `toolHeaderText`/`toolBodyMd`。
- `CardStreamer.onThinkingDelta`，为未来对接思考事件做准备。

### 内部实现

- 工具组在 3 个以上调用时自动折叠（每个飞书元素 ≤30 KB）。

## [v0.3.0] - 2026-05-31

### 新增

- **`lmcb init` 扫码创建应用流程**，通过 `@larksuiteoapi/node-sdk` 的 `registerApp` 实现。用户用飞书/Lark 移动端扫码，Lark 自动在其租户下创建内部应用并直接返回 `app_id`/`app_secret`。
- `qrcode-terminal` 依赖，用于在终端中渲染二维码。
- `src/auth/register-app.ts`，暴露 `scanRegisterApp()`。
- `lmcb bot add --tenant <lark|feishu>` 参数。

### 变更

- `lmcb init` 的应用创建方式默认为扫码；手动粘贴为选项 2。
- 文档更新以突出扫码创建流程。

## [v0.2.0] - 2026-05-31

### 新增

- `lmcb init` 交互式向导，用于首次配置。引导用户完成：选后端 → 命名 bot → 输入 app_id/secret → 写入 YAML，并可循环添加多个 bot。

## [v0.1.0] - 2026-05-31

首次发布。实现计划 M1-M5 全部完成。

### 新增

- 3 种适配器（Claude / Codex / Gemini），采用流式 `AdapterEvent` 接口。
- Supervisor + per-bot worker，含崩溃预算和指数退避。
- Unix socket JSON-RPC IPC（`lmcb start/stop/ps/restart/reload`）。
- 11 条斜杠命令（`/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`）。
- 访问控制，app owner 隐式拥有 admin 权限。
- macOS launchd 守护进程（`lmcb daemon install/uninstall/status`）。
- 流式卡片节流更新（500 ms / 50 字）。
- 抢占 + 500 ms 批处理（快速连发消息合并）。
- 通过 CLI 自身 session id 实现每个 chat 的对话续接。
- 附件下载（图片 + 文件），以 `[Attached <kind>: <abs path>]` 形式追加到 prompt。
- `bridge_context` / `quoted_message` / `interactive_card` 注入（兼容 `lark-channel-bridge` 约定）。
- E2E 测试脚手架。
- bots 目录热加载（500 ms 防抖）。
- 通过 Lark SDK 发现 app owner。
- README + quickstart + architecture + adapter-authoring + FAQ（中英双语）。
- MIT 许可证。
