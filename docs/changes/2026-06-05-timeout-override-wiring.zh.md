---
date: 2026-06-05
type: fix
slug: timeout-override-wiring
---

# /timeout 现在真的会改变空闲超时

**类型:** fix

## Motivation / 动机

`/timeout <seconds>` 回复 `timeout override accepted: …s (applies on next
run)`，但什么都没做：handler 从未持久化该值，且 `worker/index.ts` 构造
`Dispatcher` 时没传 `resolveIdleTimeoutMs`，导致 dispatcher 的 per-chat
覆盖钩子永远是 `undefined`。那句回复是误导性的——"applies on next run"
是假的。在盘点 slash 命令完整性时发现。

## What changed / 改了什么

把覆盖值在 per-`(chatId, botName)` session 槽上端到端接通：

- `ChatSession` 新增可选 `idleTimeoutMs?: number`。它对该槽覆盖 bot 配置的
  `idle_timeout_seconds`，并能在 `/new` 和 `/cd` 后存活（它是 chat 级偏好，
  不是 per-session-id 设置）。
- `SessionStore.setIdleTimeout(chatId, botName, ms | undefined)` 设置或清除；
  传 `undefined` 即清除（回落到 bot 默认）。`upsert` 现在保留已有覆盖值，除非
  patch 显式给了新值；`reset` / `setCwd` 通过已有的展开自然带过。
- `timeout` handler 持久化该值（chat 还没 session 时用 `upsert` 建槽），并诚实
  回复：`idle timeout for this chat set to <n>s (applies on next run)`。
- `worker/index.ts` 给 `Dispatcher` 传入 `resolveIdleTimeoutMs: (chatId) =>
  sessions.get(chatId, bot.name)?.idleTimeoutMs`——dispatcher 本就优先用覆盖值
  而非 `req.idleTimeoutMs`。

## Files touched / 涉及文件

- `src/session/types.ts` —— 新增 `ChatSession.idleTimeoutMs?`。
- `src/session/store.ts` —— 新增 `setIdleTimeout`；`upsert` 保留 `idleTimeoutMs`。
- `src/commands/handlers/timeout.ts` —— 持久化覆盖值（有槽 → `setIdleTimeout`；
  无槽 → 带 `idleTimeoutMs` 的 `upsert`）；诚实回复。
- `src/worker/index.ts` —— 给 `Dispatcher` 传 `resolveIdleTimeoutMs`。
- `tests/commands/timeout.test.ts` —— 新增：拒绝非法参数、在已有槽上持久化、
  无槽时建槽。
- `tests/session/store.test.ts` —— 新增：setIdleTimeout 持久化+重载、用
  `undefined` 清除、未初始化时抛错、reset/setCwd 后存活、upsert 保留已有覆盖值。

## Verification / 验证

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ —— 273 个测试通过（原 256）。新测试断言覆盖值以 ms 持久化、
  从磁盘重载、能在 `/new` 式 reset 和 `/cd` 式 setCwd 后存活，且 dispatcher
  钩子能读到它。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` 和 `docs/architecture.zh.md`
（§"State on disk" / "磁盘状态"）：`sessions.json` 那行现在标注了每个
`(chatId, botName)` 槽上可选的 `idleTimeoutMs`（即 `/timeout` 覆盖值）。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed
