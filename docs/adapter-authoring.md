# Adding a New CLI Backend

To wire a 4th CLI, implement the `Adapter` interface in `src/adapters/types.ts`:

```ts
export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

## Steps

1. **Extend the type union.** In `src/adapters/types.ts`, add your backend name to `BackendType`. In `src/config/schema.ts`, add a new schema for `XBackendSchema` (mirroring `ClaudeBackendSchema`) and add it to the `BackendSchema` discriminated union.

2. **Create the adapter file.** `src/adapters/<name>.ts` should expose at minimum:
   - A pure-function parser for one line/chunk of CLI output (testable without a real subprocess).
   - A class `XAdapter implements Adapter` whose `run(ctx)` uses `spawnWithLifecycle` from `base.ts` to start the CLI subprocess and yield `AdapterEvent`s.
   - Required events: `session-start`, `text-delta`, `done`. Optional: `tool-call`, `tool-result`, `thinking`, `error`.

3. **Register in the registry.** Add a `case 'x': ...` branch to `buildAdapter` in `src/adapters/registry.ts`.

4. **Add fixtures and unit tests.** Place curated CLI output samples under `tests/adapters/__fixtures__/<name>/` and add `tests/adapters/<name>.test.ts` that asserts your parser emits the expected `AdapterEvent` sequence.

5. **Update docs.** Add the backend to the README feature list and to the quickstart `bot add` examples.

## Tips

- Use the `signal` and `idleTimeoutMs` from `RunContext` to support `/stop` and idle teardown; `spawnWithLifecycle` already wires those for you.
- Respect `exactOptionalPropertyTypes` — never assign `undefined` to optional fields; use conditional spreads instead.
- Lookup `appendSystemPrompt` if the CLI supports a system-prompt prepend; we use it to inject the bridge convention text.
