---
date: 2026-06-03
type: fix
slug: bot-self-open-id-resolution
---

# 修复每次 worker 启动都失败的 bot self open_id / app owner 解析

**类型:** fix

## Motivation / 动机

每次 worker 启动都有两个静默失败：

1. `bot self open_id NOT resolved; group @-mention will not strip prefix` ——
   `fetchBotSelfOpenId` 通过 SDK 的**裸 `httpInstance`** 调
   `GET /open-apis/bot/v3/info`，它既没有鉴权拦截器也没有 domain baseURL，
   相对路径请求必然抛错；helper 把异常吞掉返回 `undefined`。群聊里
   @-mention 前缀因此从未被剥离。
2. 日志里 `GET /application/v6/applications/<app_id>` 报 400 ——
   `fetchAppOwnerOpenId` 漏传了**必填的 `lang` 查询参数**
   （`field_violations: [{field: "lang", description: "lang is required"}]`），
   访问控制里的 app-owner 兜底也就从未解析成功。

两者都已用真实 bot 凭证对线上 API 复现验证：带鉴权调 `bot/v3/info` 正常
返回 open_id；application API 补上 `lang` 后成功（owner id 在
`owner.owner_id` 字段，`creator_id` 恒有值可兜底）。

## What changed / 改了什么

- `fetchBotSelfOpenId` 改走 `client.request({method, url})` —— SDK 的鉴权
  路径，自动注入 tenant token 并拼接 domain。响应解析（裸 `bot` /
  包裹的 `data.bot`）不变。
- `fetchAppOwnerOpenId` 补传 `params: { lang: 'zh_cn' }`，并按
  `owner.open_id → owner.owner_id → app.creator_id` 兜底（跳过空字符串），
  与真实 payload 形状一致。

## Files touched / 涉及文件

- `src/lark/client.ts` —— 两个 helper 按上述重写，注释说明裸
  `httpInstance` 为何不可能成功、`lang` 为何必填。
- `tests/lark/client.test.ts` —— 新增测试文件（TDD，先红后绿）：断言走
  鉴权的 `client.request` 且 method/url 正确、包裹形状可解析、`lang` 参数
  恒发送、`creator_id` 兜底生效、API 出错时两个 helper 返回 `undefined`。

## Verification / 验证

- 新测试先对旧实现跑红（4 个红），修复后全绿。
- `pnpm typecheck` 通过；`pnpm test` 39 个文件 / 239 个用例全部通过。
- 修复前的线上复现：用 bot 的 tenant token 裸调 `bot/v3/info` 能拿到
  `open_id`；application API 不带 `lang` 报 400、带上成功（2026-06-03 的
  worker 日志每次启动都有该 400）。

## Architecture impact / 架构影响

无。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: 见分支 `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[未发布]` → 修复
