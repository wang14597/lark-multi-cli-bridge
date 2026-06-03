# 变更索引

按时间倒序排列的全部受追踪变更(最新在上),每个变更文档一行。约定见
[`CLAUDE.md`](../../CLAUDE.md)。

English: [INDEX.md](INDEX.md)

| 日期 | 类型 | 变更 | 摘要 |
|------|------|------|------|
| 2026-06-03 | fix | [fix-daemon-supervisor-path](2026-06-03-fix-daemon-supervisor-path.zh.md) | 后台 `lmcb start` 按源码目录结构计算 supervisor 入口路径,在 tsup 压平的 `dist/` 里指向构建产物之外并静默失败。修正路径,spawn 前加存在性守卫 + 回归测试。 |
| 2026-06-03 | refactor | [base-sdk-options](2026-06-03-base-sdk-options.zh.md) | 抽取 `baseSdkOptions`，让 `createLarkClient` 和 `LarkWsClient` 共用一份 domain/loggerLevel/logger 的 SDK 构造三元组，不再各拷一份。 |
| 2026-06-03 | fix | [profile-provision-verify](2026-06-03-profile-provision-verify.zh.md) | `ensureLarkProfile` 在 `profile add` 后回读校验，profile 没落盘（并发配置写入 / `LARK_CHANNEL` 配置 home 分叉）时响亮报错，不再对丢写记 "provisioned"。 |
| 2026-06-03 | fix | [bot-self-open-id-resolution](2026-06-03-bot-self-open-id-resolution.zh.md) | `fetchBotSelfOpenId` 改走鉴权的 `client.request`（裸 `httpInstance` 不可能成功），`fetchAppOwnerOpenId` 补必填 `lang` 参数——群 @-mention 剥离和 app-owner 访问兜底真正生效。 |
| 2026-06-03 | fix | [ws-ping-timeout-watchdog](2026-06-03-ws-ping-timeout-watchdog.zh.md) | 启用 SDK 的 WS pong 看门狗（`wsConfig.pingTimeout: 3`）+ warn 级重连日志；半开连接现在会自动重连，卡片按钮不再死于"目标回调服务当前未在线"。 |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.zh.md) | 建立"每次变更随附文档"的约定 + `CLAUDE.md`;把 `architecture.md` 版本标注刷新到 v0.7.1。 |
