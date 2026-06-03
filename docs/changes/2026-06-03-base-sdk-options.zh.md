---
date: 2026-06-03
type: refactor
slug: base-sdk-options
---

# 抽取 baseSdkOptions 消除 Lark SDK 构造的重复

**类型:** refactor

## Motivation / 动机

`createLarkClient`（`src/lark/client.ts`）和 `LarkWsClient.start()` 里的
`Lark.WSClient` 构造（`src/lark/ws.ts`）各自拷了一份完全相同的三行 SDK
选项：

```ts
domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
loggerLevel: Lark.LoggerLevel.warn,
...(opts.logger ? { logger: opts.logger } : {}),
```

PR review（WS 看门狗那个 PR）时发现。将来改任何共享开关——调 logger 级
别、加新的公共选项——都得改两处、容易漂移。behavior-preserving 清理。

## What changed / 改了什么

新增 `src/lark/sdk-options.ts`，导出 `baseSdkOptions(opts)`，返回共享的
`{ domain, loggerLevel, logger? }` 三元组。`createLarkClient` 和
`LarkWsClient.start()` 改为 `...baseSdkOptions(opts)`，各自只再补自己的
`appId`/`appSecret` 和传输层专有选项（WSClient 保留它的
`wsConfig.pingTimeout` / `handshakeTimeoutMs` / 重连钩子）。行为不变。

## Files touched / 涉及文件

- `src/lark/sdk-options.ts` —— 新增：`baseSdkOptions` + `BaseSdkOpts` 类型。
- `src/lark/client.ts` —— 引入并展开 `baseSdkOptions`；删掉本地的
  `domain`/`loggerLevel`/logger 三行。
- `src/lark/ws.ts` —— 同样展开；看门狗/重连选项不变。
- `tests/lark/sdk-options.test.ts` —— 新增（TDD，先红）：domain 映射
  （feishu → Feishu，lark/默认 → Lark）、loggerLevel 恒为 warn、logger 仅
  在传入时包含。

## Verification / 验证

- `tests/lark/sdk-options.test.ts` 先写先跑红（模块不存在），实现后转绿。
- `pnpm typecheck` 通过；`pnpm test` 40 个文件 / 243 个用例全过。
- `pnpm lint` 涉及文件干净。
- 行为不变：既有的 client/ws 测试（mock SDK 并断言构造参数）原样通过。

## Architecture impact / 架构影响

无。`docs/architecture.md` 把 `lark/` 描述为 "Lark SDK 封装"，并未逐一列举
文件；新增一个小的内部 helper 模块不改变模块职责、拓扑、事件契约、IPC 或
落盘状态。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: 见分支 `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[未发布]` → 变更
