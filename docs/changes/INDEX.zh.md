# 变更索引

按时间倒序排列的全部受追踪变更(最新在上),每个变更文档一行。约定见
[`CLAUDE.md`](../../CLAUDE.md)。

English: [INDEX.md](INDEX.md)

| 日期 | 类型 | 变更 | 摘要 |
|------|------|------|------|
| 2026-06-05 | fix | [card-action-routing-hardening](2026-06-05-card-action-routing-hardening.zh.md) | card-action-command-routing 的代码审查后续：卡片按钮改为经 `cmdToCommand` + `router.dispatchParsed` 承载**结构化** `{name, args}`（不再切词，含空白的工作空间名命中精确目标），点击失败时发尽力而为的 `⚠️ command failed: …` 回复（抽取为 `makeDispatchCommand`），而非静默死按钮。 |
| 2026-06-05 | fix | [card-action-command-routing](2026-06-05-card-action-command-routing.zh.md) | 卡片按钮 `new` / `status` / `help` / `ws.list` / `ws.use` / `ws.remove` 全是死的空操作——`makeCardActionHandler` 只实现了 `stop`。新增 `cmdToSlash` + 注入的 `dispatchCommand`，让点击走与键入命令相同的 `CommandRouter`；回复闭包抽成共享的 `makeReplies(chatId)`。 |
| 2026-06-05 | fix | [timeout-override-wiring](2026-06-05-timeout-override-wiring.zh.md) | `/timeout <seconds>` 只回执却从不生效——handler 没持久化，`Dispatcher` 构造时也没传 `resolveIdleTimeoutMs`。现持久化为 `ChatSession.idleTimeoutMs`（`/new` + `/cd` 后存活），经新增的 `SessionStore.setIdleTimeout`，dispatcher 按 chat 读取。 |
| 2026-06-04 | fix | [cwd-validation-and-spawn-cwd-error](2026-06-04-cwd-validation-and-spawn-cwd-error.zh.md) | `/cd` 和 `/new <path>` 落盘前先 stat 校验目标（不存在/非目录直接拒绝，不再写坏 session 拖垮聊天）；`spawnWithLifecycle` 在 cwd 不存在时报 `directory does not exist: …`，替代误导性的 `spawn <cmd> ENOENT`。`resolveCwd` 去重收敛到 `src/commands/cwd.ts`。 |
| 2026-06-03 | fix | [fix-daemon-supervisor-path](2026-06-03-fix-daemon-supervisor-path.zh.md) | 后台 `lmcb start` 按源码目录结构计算 supervisor 入口路径,在 tsup 压平的 `dist/` 里指向构建产物之外并静默失败。修正路径,spawn 前加存在性守卫 + 回归测试。 |
| 2026-06-03 | refactor | [base-sdk-options](2026-06-03-base-sdk-options.zh.md) | 抽取 `baseSdkOptions`，让 `createLarkClient` 和 `LarkWsClient` 共用一份 domain/loggerLevel/logger 的 SDK 构造三元组，不再各拷一份。 |
| 2026-06-03 | fix | [profile-provision-verify](2026-06-03-profile-provision-verify.zh.md) | `ensureLarkProfile` 在 `profile add` 后回读校验，profile 没落盘（并发配置写入 / `LARK_CHANNEL` 配置 home 分叉）时响亮报错，不再对丢写记 "provisioned"。 |
| 2026-06-03 | fix | [bot-self-open-id-resolution](2026-06-03-bot-self-open-id-resolution.zh.md) | `fetchBotSelfOpenId` 改走鉴权的 `client.request`（裸 `httpInstance` 不可能成功），`fetchAppOwnerOpenId` 补必填 `lang` 参数——群 @-mention 剥离和 app-owner 访问兜底真正生效。 |
| 2026-06-03 | fix | [ws-ping-timeout-watchdog](2026-06-03-ws-ping-timeout-watchdog.zh.md) | 启用 SDK 的 WS pong 看门狗（`wsConfig.pingTimeout: 3`）+ warn 级重连日志；半开连接现在会自动重连，卡片按钮不再死于"目标回调服务当前未在线"。 |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.zh.md) | 建立"每次变更随附文档"的约定 + `CLAUDE.md`;把 `architecture.md` 版本标注刷新到 v0.7.1。 |
