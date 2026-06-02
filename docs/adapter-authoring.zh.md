# 添加新的 CLI 后端

English: [adapter-authoring.md](adapter-authoring.md)

要接入第 4 种 CLI，需在 `src/adapters/types.ts` 中实现 `Adapter` 接口：

```ts
export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

## AdapterEvent 变体

`AdapterEvent` 判别联合类型共有 **7 个变体**。你的适配器至少必须发出 `session-start`、`text-delta` 和 `done`。完整列表：

| 变体 | 必须 | 说明 |
|------|------|------|
| `session-start` | 是 | CLI 子进程启动；携带 session id |
| `text-delta` | 是 | 增量助手文本块 |
| `done` | 是 | CLI 完成；包含最终文本 + token 用量 |
| `tool-call` | 可选 | CLI 调用了工具（名称 + 输入） |
| `tool-result` | 可选 | 工具返回了结果 |
| `thinking` | 可选 | CLI 正在推理（触发卡片中的可折叠思考面板） |
| `error` | 可选 | CLI 子进程产生的可恢复或致命错误 |

## 步骤

1. **扩展类型联合。** 在 `src/adapters/types.ts` 中，把你的后端名称加入 `BackendType`。在 `src/config/schema.ts` 中，新增 `XBackendSchema`（参照 `ClaudeBackendSchema`）并加入 `BackendSchema` 判别联合。

2. **创建适配器文件。** `src/adapters/<name>.ts` 至少需要：
   - 一个用于解析 CLI 单行/单块输出的纯函数解析器（不依赖真实子进程，便于单测）。
   - 一个 `XAdapter implements Adapter` 类，其 `run(ctx)` 使用 `base.ts` 中的 `spawnWithLifecycle` 启动 CLI 子进程并 yield `AdapterEvent`。
   - 必需事件：`session-start`、`text-delta`、`done`。可选：`tool-call`、`tool-result`、`thinking`、`error`。

3. **在注册表中注册。** 在 `src/adapters/registry.ts` 的 `buildAdapter` 中添加 `case 'x': ...` 分支。

4. **添加 fixture 和单元测试。** Fixture 必须来自**真实 CLI 输出**，不要手写 JSON——codex 0.130 schema 变化和 gemini agent-loop 的 `tool_use` 行能逃过测试就是因为最初的 fixture 是想象出来的。用 `scripts/record-cli-fixture.sh <backend> <name>` 录制真实输出（写入 `tests/adapters/__fixtures__/<backend>/<name>.{jsonl,txt}`），然后写 `tests/adapters/<backend>.test.ts` 回放 fixture 并断言期望的 `AdapterEvent` 序列。

5. **更新文档。** 在 README 的功能列表和快速开始的 `bot add` 示例中加入新后端。

## 提示

- 使用 `RunContext` 中的 `signal` 和 `idleTimeoutMs` 支持 `/stop` 和空闲超时；`spawnWithLifecycle` 已为你处理好这些。
- 遵守 `exactOptionalPropertyTypes`——不要把 `undefined` 赋值给可选字段；使用条件展开代替。
- 如果 CLI 支持系统提示词前置，可查看 `appendSystemPrompt`；我们用它注入 bridge 约定文本。
