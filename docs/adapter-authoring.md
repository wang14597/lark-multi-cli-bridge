# Adding a New CLI Backend

中文版: [adapter-authoring.zh.md](adapter-authoring.zh.md)

To wire a 4th CLI, implement the `Adapter` interface in `src/adapters/types.ts`:

```ts
export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

## AdapterEvent variants

The `AdapterEvent` discriminated union has **7 variants**. Your adapter must emit at minimum `session-start`, `text-delta`, and `done`. The full set:

| Variant | Required | Description |
|---------|----------|-------------|
| `session-start` | Yes | CLI subprocess started; carry the session id |
| `text-delta` | Yes | Incremental assistant text chunk |
| `done` | Yes | CLI finished; include final text + token usage |
| `tool-call` | Optional | CLI invoked a tool (name + input) |
| `tool-result` | Optional | Tool returned a result |
| `thinking` | Optional | CLI is reasoning (triggers collapsible reasoning panel in the card) |
| `error` | Optional | Recoverable or fatal error from the CLI subprocess |

## Steps

1. **Extend the type union.** In `src/adapters/types.ts`, add your backend name to `BackendType`. In `src/config/schema.ts`, add a new schema `XBackendSchema` (mirroring `ClaudeBackendSchema`) and add it to the `BackendSchema` discriminated union.

2. **Create the adapter file.** `src/adapters/<name>.ts` should expose at minimum:
   - A pure-function parser for one line/chunk of CLI output (testable without a real subprocess).
   - A class `XAdapter implements Adapter` whose `run(ctx)` uses `spawnWithLifecycle` from `base.ts` to start the CLI subprocess and yield `AdapterEvent`s.
   - Required events: `session-start`, `text-delta`, `done`. Optional: `tool-call`, `tool-result`, `thinking`, `error`.

3. **Register in the registry.** Add a `case 'x': ...` branch to `buildAdapter` in `src/adapters/registry.ts`.

4. **Add fixtures and unit tests.** Fixtures must come from **real CLI output**, not handwritten JSON — the codex 0.130 schema change and the gemini agent-loop `tool_use` lines both went undetected initially because the fixtures were aspirational. Capture a real run with `scripts/record-cli-fixture.sh <backend> <name>` (writes to `tests/adapters/__fixtures__/<backend>/<name>.{jsonl,txt}`), then write `tests/adapters/<backend>.test.ts` that replays the fixture and asserts the expected `AdapterEvent` sequence.

5. **Update docs.** Add the backend to the README feature list and to the quickstart `bot add` examples.

## Tips

- Use the `signal` and `idleTimeoutMs` from `RunContext` to support `/stop` and idle teardown; `spawnWithLifecycle` already wires those for you.
- Respect `exactOptionalPropertyTypes` — never assign `undefined` to optional fields; use conditional spreads instead.
- Check `appendSystemPrompt` if the CLI supports a system-prompt prepend; we use it to inject the bridge convention text.
