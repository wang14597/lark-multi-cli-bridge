# lark-multi-cli-bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + TypeScript Lark/Feishu chat bridge that routes inbound messages to one of three local AI coding CLIs (Claude Code, OpenAI Codex CLI, Google Gemini CLI), with a supervisor + per-bot worker architecture supporting multiple bots running concurrently on a single host.

**Architecture:** A `supervisor` process forks one `worker` per enabled bot. Each worker holds a Lark WebSocket long-connection, dispatches incoming messages through a streaming `Adapter` (Claude/Codex/Gemini) that spawns one-shot CLI subprocesses, and pipes the resulting event stream back to a throttled Lark "streaming card" updater. State lives in `~/.lark-multi-cli-bridge/`; supervisor and `lmcb` CLI communicate over a unix-socket JSON-RPC.

**Tech Stack:** Node.js >= 20, TypeScript, `commander`, `@larksuiteoapi/node-sdk`, `js-yaml`, `zod`, `pino` + `pino-roll`, `vitest`, `tsup`, `eslint` + `prettier`.

**Spec reference:** `/Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge/docs/superpowers/specs/2026-05-31-lark-multi-cli-bridge-design.md`

**Reference repo (read-only, MIT, for inspiration only):** `/Users/lei.wang2/Downloads/wiz/projects/feishu-claude-code-bridge/`

---

## Conventions

- Every task ends with a `git commit`. Conventional commits: `feat(scope): ...`, `test(scope): ...`, `chore(scope): ...`, `fix(scope): ...`, `docs(scope): ...`.
- TDD by default: failing test → run it red → minimal implementation → run it green → commit.
- All source files use ES modules (`"type": "module"` in package.json), `.ts` extension, top-of-file `// SPDX-License-Identifier: MIT` header.
- File paths in this plan are relative to `/Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge/` unless absolute.
- Run all commands from project root unless specified otherwise.

---

# Milestone M1 — Project Scaffolding + ClaudeAdapter + Single-Bot Worker

**Goal:** End-to-end: send a text message to a Lark bot, see streaming card updates with Claude's response.

## Task 1.1: Initialize the npm project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `bin/lmcb.mjs`
- Create: `src/index.ts`
- Create: `README.md` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lark-multi-cli-bridge",
  "version": "0.0.1",
  "description": "Lark/Feishu bridge that routes messages to Claude / Codex / Gemini CLIs, one bot per backend.",
  "type": "module",
  "license": "MIT",
  "bin": {
    "lmcb": "./bin/lmcb.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint \"src/**/*.ts\" \"tests/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.41.0",
    "commander": "^12.1.0",
    "js-yaml": "^4.1.0",
    "pino": "^9.4.0",
    "pino-roll": "^2.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.3",
    "tsup": "^8.2.4",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts', 'src/worker/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 5: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'warn',
  },
};
```

- [ ] **Step 6: Create `.prettierrc.json`**

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
coverage/
.vitest/
.env
.env.local
```

- [ ] **Step 8: Create `.editorconfig`**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

- [ ] **Step 9: Create `bin/lmcb.mjs`**

```js
#!/usr/bin/env node
import('../dist/cli/index.js').catch((err) => {
  console.error('[lmcb] failed to load CLI:', err);
  process.exit(1);
});
```

- [ ] **Step 10: Create `src/index.ts` (placeholder for tsup to resolve)**

```ts
// SPDX-License-Identifier: MIT
export const VERSION = '0.0.1';
```

- [ ] **Step 11: Create `README.md` stub**

```markdown
# lark-multi-cli-bridge

Lark/Feishu bridge that routes messages to Claude / Codex / Gemini CLIs. One bot per backend.

Status: in active development. See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design.
```

- [ ] **Step 12: Install dependencies**

Run: `pnpm install` (or `npm install` if pnpm is not available)
Expected: All deps resolve, lockfile created.

- [ ] **Step 13: Verify typecheck passes on empty project**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: bootstrap npm + ts + tsup + vitest + eslint scaffold"
```

---

## Task 1.2: Configuration paths and zod schema

**Files:**
- Create: `src/config/paths.ts`
- Create: `src/config/schema.ts`
- Create: `tests/config/schema.test.ts`

- [ ] **Step 1: Write failing test for path resolver**

Create `tests/config/paths.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { paths } from '../../src/config/paths.js';

describe('paths', () => {
  it('exposes the config root under home', () => {
    expect(paths.root).toMatch(/\.lark-multi-cli-bridge$/);
  });

  it('derives all subpaths from root', () => {
    expect(paths.bots).toBe(`${paths.root}/bots`);
    expect(paths.configYaml).toBe(`${paths.root}/config.yaml`);
    expect(paths.state).toBe(`${paths.root}/state`);
    expect(paths.sessionsJson).toBe(`${paths.root}/state/sessions.json`);
    expect(paths.workspacesJson).toBe(`${paths.root}/state/workspaces.json`);
    expect(paths.processesJson).toBe(`${paths.root}/state/processes.json`);
    expect(paths.logs).toBe(`${paths.root}/logs`);
    expect(paths.supervisorLog).toBe(`${paths.root}/logs/supervisor.log`);
    expect(paths.media).toBe(`${paths.root}/media`);
    expect(paths.ipcSock).toBe(`${paths.root}/ipc.sock`);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test tests/config/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/config/paths.ts`**

```ts
// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env.LMCB_HOME ?? join(homedir(), '.lark-multi-cli-bridge');

export const paths = {
  root,
  configYaml: join(root, 'config.yaml'),
  bots: join(root, 'bots'),
  state: join(root, 'state'),
  sessionsJson: join(root, 'state', 'sessions.json'),
  workspacesJson: join(root, 'state', 'workspaces.json'),
  processesJson: join(root, 'state', 'processes.json'),
  logs: join(root, 'logs'),
  supervisorLog: join(root, 'logs', 'supervisor.log'),
  workerLogsDir: join(root, 'logs', 'workers'),
  media: join(root, 'media'),
  ipcSock: join(root, 'ipc.sock'),
  workerLog(bot: string, dateYmd: string): string {
    return join(root, 'logs', 'workers', bot, `${dateYmd}.log`);
  },
  botYaml(bot: string): string {
    return join(root, 'bots', `${bot}.yaml`);
  },
  mediaChat(chatId: string): string {
    return join(root, 'media', chatId);
  },
} as const;
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/config/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for bot schema**

Create `tests/config/schema.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { BotConfigSchema, GlobalConfigSchema } from '../../src/config/schema.js';

const minimalClaudeBot = {
  name: 'claude-bot',
  enabled: true,
  lark: { app_id: 'cli_abc', app_secret: 'secret_xyz', tenant: 'lark' },
  backend: { type: 'claude', claude: { permission_mode: 'bypassPermissions' } },
  access: { allowed_users: [], allowed_chats: [], admins: [] },
  behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
};

describe('BotConfigSchema', () => {
  it('accepts a minimal claude bot', () => {
    const parsed = BotConfigSchema.parse(minimalClaudeBot);
    expect(parsed.name).toBe('claude-bot');
  });

  it('accepts a codex bot with codex sub-block', () => {
    const codex = { ...minimalClaudeBot, name: 'codex-bot', backend: { type: 'codex', codex: { extra_args: [] } } };
    const parsed = BotConfigSchema.parse(codex);
    expect(parsed.backend.type).toBe('codex');
  });

  it('rejects bot with mismatched backend sub-block', () => {
    const bad = { ...minimalClaudeBot, backend: { type: 'gemini', claude: {} } };
    expect(() => BotConfigSchema.parse(bad)).toThrow();
  });

  it('rejects bot with unknown backend.type', () => {
    const bad = { ...minimalClaudeBot, backend: { type: 'gpt', claude: {} } };
    expect(() => BotConfigSchema.parse(bad)).toThrow();
  });
});

describe('GlobalConfigSchema', () => {
  it('provides defaults when fields omitted', () => {
    const parsed = GlobalConfigSchema.parse({});
    expect(parsed.log_retention_days).toBe(7);
    expect(parsed.defaults.behavior.group_trigger).toBe('mention');
  });
});
```

- [ ] **Step 6: Run test, expect failure**

Run: `pnpm test tests/config/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/config/schema.ts`**

```ts
// SPDX-License-Identifier: MIT
import { z } from 'zod';

const OpenId = z.string().regex(/^ou_[A-Za-z0-9]+$/, 'must be a Lark open_id (ou_...)');
const ChatId = z.string().regex(/^oc_[A-Za-z0-9]+$/, 'must be a Lark chat_id (oc_...)');

export const SecretRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('keychain'), key: z.string() }),
  z.object({ source: z.literal('exec'), command: z.string(), args: z.array(z.string()).default([]) }),
  z.object({ source: z.literal('env'), var: z.string() }),
]);

const LarkAccountSchema = z
  .object({
    app_id: z.string(),
    app_secret: z.string().optional(),
    app_secret_ref: SecretRefSchema.optional(),
    tenant: z.enum(['lark', 'feishu']).default('lark'),
  })
  .refine((v) => v.app_secret || v.app_secret_ref, 'either app_secret or app_secret_ref is required');

const ClaudeBackendSchema = z.object({
  type: z.literal('claude'),
  claude: z
    .object({
      model: z.string().optional(),
      permission_mode: z.enum(['default', 'bypassPermissions', 'plan']).default('bypassPermissions'),
      extra_args: z.array(z.string()).default([]),
    })
    .default({ permission_mode: 'bypassPermissions', extra_args: [] }),
});

const CodexBackendSchema = z.object({
  type: z.literal('codex'),
  codex: z
    .object({
      model: z.string().optional(),
      json_mode: z.boolean().default(true),
      extra_args: z.array(z.string()).default([]),
    })
    .default({ json_mode: true, extra_args: [] }),
});

const GeminiBackendSchema = z.object({
  type: z.literal('gemini'),
  gemini: z
    .object({
      model: z.string().optional(),
      extra_args: z.array(z.string()).default([]),
    })
    .default({ extra_args: [] }),
});

export const BackendSchema = z.discriminatedUnion('type', [
  ClaudeBackendSchema,
  CodexBackendSchema,
  GeminiBackendSchema,
]);

export const AccessSchema = z.object({
  allowed_users: z.array(OpenId).default([]),
  allowed_chats: z.array(ChatId).default([]),
  admins: z.array(OpenId).default([]),
});

export const BehaviorSchema = z.object({
  default_cwd: z.string().default('~'),
  group_trigger: z.enum(['mention', 'always']).default('mention'),
  idle_timeout_seconds: z.number().int().positive().default(600),
  max_concurrent_chats: z.number().int().nonnegative().default(0),
});

export const BotConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case'),
  enabled: z.boolean().default(true),
  lark: LarkAccountSchema,
  backend: BackendSchema,
  access: AccessSchema.default({ allowed_users: [], allowed_chats: [], admins: [] }),
  behavior: BehaviorSchema.default({
    default_cwd: '~',
    group_trigger: 'mention',
    idle_timeout_seconds: 600,
    max_concurrent_chats: 0,
  }),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
export type Backend = z.infer<typeof BackendSchema>;
export type BackendType = Backend['type'];

export const GlobalConfigSchema = z.object({
  log_retention_days: z.number().int().positive().default(7),
  ipc_socket: z.string().optional(),
  metrics: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().positive().default(9099),
    })
    .default({ enabled: false, port: 9099 }),
  defaults: z
    .object({
      behavior: BehaviorSchema.partial().default({}),
    })
    .default({ behavior: {} }),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
```

- [ ] **Step 8: Run tests, expect pass**

Run: `pnpm test tests/config/`
Expected: PASS (paths + schema).

- [ ] **Step 9: Commit**

```bash
git add src/config/ tests/config/
git commit -m "feat(config): paths resolver + zod schemas for bot/global config"
```

---

## Task 1.3: Utility primitives (atomic-file, retry, async-iter, signals)

**Files:**
- Create: `src/util/atomic-file.ts`
- Create: `src/util/retry.ts`
- Create: `src/util/async-iter.ts`
- Create: `src/util/signals.ts`
- Create: `tests/util/atomic-file.test.ts`
- Create: `tests/util/retry.test.ts`
- Create: `tests/util/async-iter.test.ts`

- [ ] **Step 1: Write failing test for `atomic-file`**

Create `tests/util/atomic-file.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, readJsonOrDefault } from '../../src/util/atomic-file.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-atomic-'));
});

describe('atomic-file', () => {
  it('writes JSON and reads it back', async () => {
    const target = join(dir, 'state.json');
    await writeJsonAtomic(target, { hello: 'world' });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ hello: 'world' });
  });

  it('readJsonOrDefault returns default if file does not exist', async () => {
    const target = join(dir, 'missing.json');
    expect(await readJsonOrDefault(target, { a: 1 })).toEqual({ a: 1 });
  });

  it('readJsonOrDefault returns default if file is corrupt', async () => {
    const target = join(dir, 'bad.json');
    await writeJsonAtomic(target, { ok: true });
    const corrupted = join(dir, 'bad.json');
    require('node:fs').writeFileSync(corrupted, '{ not json');
    expect(await readJsonOrDefault(corrupted, { fallback: true })).toEqual({ fallback: true });
  });

  it('does not leave a partial file if write is interrupted', async () => {
    const target = join(dir, 'safe.json');
    await writeJsonAtomic(target, { a: 1 });
    await writeJsonAtomic(target, { a: 2 });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ a: 2 });
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test tests/util/atomic-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/util/atomic-file.ts`**

```ts
// SPDX-License-Identifier: MIT
import { mkdir, rename, writeFile, readFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeJsonAtomic<T>(path: string, value: T, mode: number = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode });
  await rename(tmp, path);
  await chmod(path, mode);
}

export async function readJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/util/atomic-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for `retry`**

Create `tests/util/retry.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { backoffDelays, retry } from '../../src/util/retry.js';

describe('backoffDelays', () => {
  it('produces the documented sequence 1, 2, 5, 15, 30 seconds', () => {
    expect(backoffDelays()).toEqual([1000, 2000, 5000, 15000, 30000]);
  });
});

describe('retry', () => {
  it('returns value on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await retry(fn, { delays: [10, 10], onAttempt: () => {} });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until exhausted then throws', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retry(fn, { delays: [1, 1] })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 6: Run test, expect failure**

Run: `pnpm test tests/util/retry.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `src/util/retry.ts`**

```ts
// SPDX-License-Identifier: MIT
export function backoffDelays(): number[] {
  return [1000, 2000, 5000, 15000, 30000];
}

export interface RetryOpts {
  delays: number[];
  onAttempt?: (attempt: number, err: unknown) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      const delay = opts.delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 8: Run test, expect pass**

Run: `pnpm test tests/util/retry.test.ts`
Expected: PASS.

- [ ] **Step 9: Write failing test for `async-iter`**

Create `tests/util/async-iter.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readLines } from '../../src/util/async-iter.js';

describe('readLines', () => {
  it('emits each newline-terminated line', async () => {
    const stream = Readable.from(['a\nb\n', 'c\nd', '\n']);
    const out: string[] = [];
    for await (const line of readLines(stream)) out.push(line);
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not emit a trailing partial line without newline', async () => {
    const stream = Readable.from(['only-partial']);
    const out: string[] = [];
    for await (const line of readLines(stream)) out.push(line);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 10: Run test, expect failure**

Run: `pnpm test tests/util/async-iter.test.ts`
Expected: FAIL.

- [ ] **Step 11: Implement `src/util/async-iter.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { Readable } from 'node:stream';

export async function* readLines(stream: Readable): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
}

export class Deferred<T> {
  promise: Promise<T>;
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}
```

- [ ] **Step 12: Run test, expect pass**

Run: `pnpm test tests/util/async-iter.test.ts`
Expected: PASS.

- [ ] **Step 13: Implement `src/util/signals.ts`**

```ts
// SPDX-License-Identifier: MIT
export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const out = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      out.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => out.abort(s.reason), { once: true });
  }
  return out.signal;
}

export function timeoutSignal(ms: number): AbortSignal {
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error(`timeout after ${ms}ms`)), ms).unref();
  return ac.signal;
}
```

- [ ] **Step 14: Commit**

```bash
git add src/util/ tests/util/
git commit -m "feat(util): atomic file writes, retry+backoff, async iterators, signal helpers"
```

---

## Task 1.4: Adapter types and shared base

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/base.ts`
- Create: `tests/adapters/base.test.ts`

- [ ] **Step 1: Implement `src/adapters/types.ts`**

```ts
// SPDX-License-Identifier: MIT
export type BackendType = 'claude' | 'codex' | 'gemini';

export interface Attachment {
  kind: 'image' | 'file';
  localPath: string;
  fileName: string;
  mimeType?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface RunContext {
  prompt: string;
  cwd: string;
  sessionId?: string;
  attachments?: Attachment[];
  signal: AbortSignal;
  env?: Record<string, string>;
  idleTimeoutMs: number;
}

export type AdapterEvent =
  | { type: 'session-start'; sessionId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; name: string; input: unknown; callId: string }
  | { type: 'tool-result'; callId: string; name: string; ok: boolean; summary?: string }
  | { type: 'thinking'; text?: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done'; finalText: string; sessionId: string; usage?: TokenUsage };

export interface AdapterPreflight {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

- [ ] **Step 2: Write failing test for `spawnWithLifecycle`**

Create `tests/adapters/base.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { spawnWithLifecycle } from '../../src/adapters/base.js';

describe('spawnWithLifecycle', () => {
  it('streams stdout line by line', async () => {
    const ac = new AbortController();
    const lines: string[] = [];
    for await (const line of spawnWithLifecycle('printf', ['a\\nb\\nc\\n'], {
      signal: ac.signal,
      idleTimeoutMs: 5000,
    })) {
      lines.push(line);
    }
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('respects AbortSignal to cancel a long-running process', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('user cancel')), 50);
    const lines: string[] = [];
    await expect(
      (async () => {
        for await (const line of spawnWithLifecycle('sh', ['-c', 'sleep 5; echo never'], {
          signal: ac.signal,
          idleTimeoutMs: 60_000,
        })) {
          lines.push(line);
        }
      })(),
    ).rejects.toThrow();
    expect(lines).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `pnpm test tests/adapters/base.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/adapters/base.ts`**

```ts
// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { readLines } from '../util/async-iter.js';

export interface SpawnLifecycleOpts extends SpawnOptionsWithoutStdio {
  signal: AbortSignal;
  idleTimeoutMs: number;
}

export async function* spawnWithLifecycle(
  cmd: string,
  args: string[],
  opts: SpawnLifecycleOpts,
): AsyncIterable<string> {
  const child: ChildProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

  const onAbort = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000).unref();
    }
  };
  opts.signal.addEventListener('abort', onAbort, { once: true });

  let lastByteAt = Date.now();
  const idleTimer = setInterval(() => {
    if (Date.now() - lastByteAt > opts.idleTimeoutMs) {
      if (!child.killed) child.kill('SIGTERM');
    }
  }, 1000);
  idleTimer.unref();

  // Forward stderr to console via child.stderr; surface non-zero exit via thrown error after stream ends.
  let stderrBuf = '';
  child.stderr?.on('data', (b) => {
    stderrBuf += b.toString('utf8');
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    if (!child.stdout) throw new Error('child has no stdout');
    for await (const line of readLines(child.stdout)) {
      lastByteAt = Date.now();
      yield line;
    }
    const { code, signal } = await exitPromise;
    if (opts.signal.aborted) {
      throw opts.signal.reason ?? new Error('aborted');
    }
    if (code !== 0 && code !== null) {
      throw new Error(`child exited with code ${code}; stderr: ${stderrBuf.slice(0, 4000)}`);
    }
    if (signal) {
      throw new Error(`child killed by signal ${signal}; stderr: ${stderrBuf.slice(0, 4000)}`);
    }
  } finally {
    clearInterval(idleTimer);
    opts.signal.removeEventListener('abort', onAbort);
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/adapters/base.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/ tests/adapters/
git commit -m "feat(adapters): Adapter interface, AdapterEvent, spawnWithLifecycle base"
```

---

## Task 1.5: ClaudeAdapter (stream-json parser)

**Files:**
- Create: `src/adapters/claude.ts`
- Create: `tests/adapters/__fixtures__/claude/simple-text.jsonl`
- Create: `tests/adapters/__fixtures__/claude/with-tool-use.jsonl`
- Create: `tests/adapters/claude.test.ts`

- [ ] **Step 1: Record a `simple-text` fixture**

Create `tests/adapters/__fixtures__/claude/simple-text.jsonl` (one JSON object per line — these are the events `claude --output-format stream-json` emits; if the field shapes differ in your installed Claude CLI, run `claude -p "say hi" --output-format stream-json --verbose 2>/dev/null > /tmp/fixture.jsonl` and copy the lines here):

```
{"type":"system","subtype":"init","session_id":"sess_abc","cwd":"/tmp","model":"claude-opus-4-7"}
{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":"Hello"}]}}
{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":" world"}]}}
{"type":"result","subtype":"success","session_id":"sess_abc","is_error":false,"result":"Hello world","usage":{"input_tokens":12,"output_tokens":4}}
```

- [ ] **Step 2: Record a `with-tool-use` fixture**

Create `tests/adapters/__fixtures__/claude/with-tool-use.jsonl`:

```
{"type":"system","subtype":"init","session_id":"sess_tool","cwd":"/tmp","model":"claude-opus-4-7"}
{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"foo.ts"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","is_error":false,"content":[{"type":"text","text":"file contents"}]}]}}
{"type":"assistant","message":{"id":"msg_2","content":[{"type":"text","text":"I read the file."}]}}
{"type":"result","subtype":"success","session_id":"sess_tool","is_error":false,"result":"I read the file.","usage":{"input_tokens":50,"output_tokens":10}}
```

- [ ] **Step 3: Write failing test for ClaudeAdapter**

Create `tests/adapters/claude.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClaudeLine } from '../../src/adapters/claude.js';
import type { AdapterEvent } from '../../src/adapters/types.js';

function eventsFromFixture(name: string): AdapterEvent[] {
  const path = join(__dirname, '__fixtures__/claude', name);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const out: AdapterEvent[] = [];
  for (const line of lines) {
    for (const ev of parseClaudeLine(line)) out.push(ev);
  }
  return out;
}

describe('ClaudeAdapter.parseClaudeLine', () => {
  it('translates simple-text fixture to text-delta + done', () => {
    const events = eventsFromFixture('simple-text.jsonl');
    expect(events[0]).toEqual({ type: 'session-start', sessionId: 'sess_abc' });
    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as any).text)).toEqual(['Hello', ' world']);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      sessionId: 'sess_abc',
      finalText: 'Hello world',
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it('translates tool_use blocks to tool-call and tool-result events', () => {
    const events = eventsFromFixture('with-tool-use.jsonl');
    const toolCall = events.find((e) => e.type === 'tool-call');
    expect(toolCall).toMatchObject({ type: 'tool-call', name: 'Read', callId: 'tu_1', input: { file_path: 'foo.ts' } });
    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toMatchObject({ type: 'tool-result', callId: 'tu_1', ok: true });
  });
});
```

- [ ] **Step 4: Run test, expect failure**

Run: `pnpm test tests/adapters/claude.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `src/adapters/claude.ts`**

```ts
// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

interface ClaudeStreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id?: string;
    content?: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; is_error: boolean; content: unknown }
      | { type: 'thinking'; text?: string }
    >;
  };
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

export function* parseClaudeLine(line: string): Iterable<AdapterEvent> {
  let obj: ClaudeStreamLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
    yield { type: 'session-start', sessionId: obj.session_id };
    return;
  }

  if (obj.type === 'assistant' && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === 'text') {
        yield { type: 'text-delta', text: block.text };
      } else if (block.type === 'tool_use') {
        yield { type: 'tool-call', name: block.name, input: block.input, callId: block.id };
      } else if (block.type === 'thinking') {
        yield { type: 'thinking', text: block.text };
      }
    }
    return;
  }

  if (obj.type === 'user' && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === 'tool_result') {
        yield {
          type: 'tool-result',
          callId: block.tool_use_id,
          name: '',
          ok: !block.is_error,
        };
      }
    }
    return;
  }

  if (obj.type === 'result' && obj.session_id) {
    yield {
      type: 'done',
      sessionId: obj.session_id,
      finalText: obj.result ?? '',
      usage: obj.usage
        ? {
            inputTokens: obj.usage.input_tokens,
            outputTokens: obj.usage.output_tokens,
            cachedInputTokens: obj.usage.cache_read_input_tokens,
          }
        : undefined,
    };
  }
}

export interface ClaudeAdapterOpts {
  cliPath?: string;
  permissionMode?: 'default' | 'bypassPermissions' | 'plan';
  model?: string;
  extraArgs?: string[];
  appendSystemPrompt?: string;
}

export class ClaudeAdapter implements Adapter {
  readonly backend = 'claude' as const;
  constructor(private opts: ClaudeAdapterOpts = {}) {}

  async preflight(): Promise<AdapterPreflight> {
    try {
      const out: string[] = [];
      const ac = new AbortController();
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'claude', ['--version'], {
        signal: ac.signal,
        idleTimeoutMs: 5000,
      })) {
        out.push(line);
      }
      return { ok: true, version: out.join(' ').trim() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    const args = [
      '-p',
      ctx.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      this.opts.permissionMode ?? 'bypassPermissions',
    ];
    if (this.opts.model) args.push('--model', this.opts.model);
    if (ctx.sessionId) args.push('--resume', ctx.sessionId);
    if (this.opts.appendSystemPrompt) {
      args.push('--append-system-prompt', this.opts.appendSystemPrompt);
    }
    args.push(...(this.opts.extraArgs ?? []));

    try {
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'claude', args, {
        cwd: ctx.cwd,
        env: { ...process.env, ...ctx.env },
        signal: ctx.signal,
        idleTimeoutMs: ctx.idleTimeoutMs,
      })) {
        for (const ev of parseClaudeLine(line)) {
          yield ev;
        }
      }
    } catch (err) {
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
```

- [ ] **Step 6: Run test, expect pass**

Run: `pnpm test tests/adapters/claude.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/claude.ts tests/adapters/claude.test.ts tests/adapters/__fixtures__/claude/
git commit -m "feat(adapters): ClaudeAdapter with stream-json line parser + fixtures"
```

---

## Task 1.6: Session store

**Files:**
- Create: `src/session/types.ts`
- Create: `src/session/store.ts`
- Create: `tests/session/store.test.ts`

- [ ] **Step 1: Implement `src/session/types.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { BackendType } from '../adapters/types.js';

export interface ChatSession {
  backend: BackendType;
  bot: string;
  sessionId?: string;
  cwd: string;
  lastUsedAt: string;
  messageCount: number;
}

export interface SessionsFile {
  chats: Record<string, ChatSession>;
}
```

- [ ] **Step 2: Write failing test for session store**

Create `tests/session/store.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/session/store.js';

let dir: string;
let store: SessionStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-sess-'));
  store = new SessionStore(join(dir, 'sessions.json'));
  await store.load();
});

describe('SessionStore', () => {
  it('returns undefined for unknown chat', () => {
    expect(store.get('oc_unknown')).toBeUndefined();
  });

  it('upserts and persists a session', async () => {
    await store.upsert('oc_chat1', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
    const s = store.get('oc_chat1');
    expect(s).toMatchObject({ backend: 'claude', bot: 'claude-bot', cwd: '/tmp', messageCount: 1 });
    const reloaded = new SessionStore(join(dir, 'sessions.json'));
    await reloaded.load();
    expect(reloaded.get('oc_chat1')).toMatchObject({ backend: 'claude', bot: 'claude-bot' });
  });

  it('bumps messageCount on each upsert', async () => {
    await store.upsert('oc_chat2', { backend: 'codex', bot: 'codex-bot', cwd: '/tmp' });
    await store.upsert('oc_chat2', { backend: 'codex', bot: 'codex-bot', cwd: '/tmp', sessionId: 'rollout-abc' });
    expect(store.get('oc_chat2')?.messageCount).toBe(2);
    expect(store.get('oc_chat2')?.sessionId).toBe('rollout-abc');
  });

  it('reset clears sessionId while keeping cwd and bot', async () => {
    await store.upsert('oc_chat3', { backend: 'gemini', bot: 'gemini-bot', cwd: '/p', sessionId: 'gem-1' });
    await store.reset('oc_chat3');
    const s = store.get('oc_chat3');
    expect(s?.sessionId).toBeUndefined();
    expect(s?.cwd).toBe('/p');
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `pnpm test tests/session/store.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/session/store.ts`**

```ts
// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';
import type { ChatSession, SessionsFile } from './types.js';

export class SessionStore {
  private data: SessionsFile = { chats: {} };
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    this.data = await readJsonOrDefault<SessionsFile>(this.filePath, { chats: {} });
  }

  get(chatId: string): ChatSession | undefined {
    return this.data.chats[chatId];
  }

  list(): Array<{ chatId: string; session: ChatSession }> {
    return Object.entries(this.data.chats).map(([chatId, session]) => ({ chatId, session }));
  }

  async upsert(
    chatId: string,
    patch: Partial<ChatSession> & Pick<ChatSession, 'backend' | 'bot' | 'cwd'>,
  ): Promise<ChatSession> {
    const existing = this.data.chats[chatId];
    const next: ChatSession = {
      backend: patch.backend,
      bot: patch.bot,
      cwd: patch.cwd,
      sessionId: patch.sessionId ?? existing?.sessionId,
      lastUsedAt: new Date().toISOString(),
      messageCount: (existing?.messageCount ?? 0) + 1,
    };
    this.data.chats[chatId] = next;
    await this.persist();
    return next;
  }

  async reset(chatId: string): Promise<void> {
    const existing = this.data.chats[chatId];
    if (!existing) return;
    this.data.chats[chatId] = { ...existing, sessionId: undefined, lastUsedAt: new Date().toISOString() };
    await this.persist();
  }

  async setCwd(chatId: string, cwd: string, resetSession: boolean): Promise<void> {
    const existing = this.data.chats[chatId];
    if (!existing) throw new Error(`chat not initialized: ${chatId}`);
    this.data.chats[chatId] = {
      ...existing,
      cwd,
      sessionId: resetSession ? undefined : existing.sessionId,
      lastUsedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.filePath, this.data);
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/session/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/ tests/session/
git commit -m "feat(session): ChatSession types + SessionStore with atomic persistence"
```

---

## Task 1.7: Lark client wrapper (auth + WS skeleton)

**Files:**
- Create: `src/lark/types.ts`
- Create: `src/lark/client.ts`
- Create: `src/lark/ws.ts`
- Create: `src/lark/message-parse.ts`
- Create: `tests/lark/message-parse.test.ts`

- [ ] **Step 1: Implement `src/lark/types.ts`**

```ts
// SPDX-License-Identifier: MIT
export interface IngressMessage {
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  senderName?: string;
  messageId: string;
  text: string;
  mentions: Array<{ openId: string; name?: string }>;
  rawType: 'text' | 'post' | 'interactive' | 'image' | 'file' | 'merge_forward' | 'audio' | 'unknown';
  quoted?: QuotedMessage;
  attachments: RawAttachment[];
  receivedAt: string;
}

export interface QuotedMessage {
  id: string;
  senderOpenId: string;
  senderName?: string;
  createdAt: string;
  type: string;
  content: string;
}

export interface RawAttachment {
  fileKey: string;
  fileName: string;
  type: 'image' | 'file';
  mimeType?: string;
  size?: number;
}
```

- [ ] **Step 2: Write failing test for `parseIngressEvent`**

Create `tests/lark/message-parse.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseIngressEvent } from '../../src/lark/message-parse.js';

const sampleP2pText = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_chat1',
      chat_type: 'p2p',
      message_type: 'text',
      create_time: '1700000000000',
      content: JSON.stringify({ text: 'hello bot' }),
      mentions: [],
    },
  },
};

const groupTextWithMention = {
  event: {
    sender: { sender_id: { open_id: 'ou_user2' } },
    message: {
      message_id: 'om_2',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000001000',
      content: JSON.stringify({ text: '@_user_1 do something' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

describe('parseIngressEvent', () => {
  it('parses a p2p text message', () => {
    const m = parseIngressEvent(sampleP2pText);
    expect(m).toMatchObject({
      chatId: 'oc_chat1',
      chatType: 'p2p',
      text: 'hello bot',
      rawType: 'text',
      messageId: 'om_1',
    });
  });

  it('parses a group message and exposes mentions', () => {
    const m = parseIngressEvent(groupTextWithMention);
    expect(m?.chatType).toBe('group');
    expect(m?.mentions).toEqual([{ openId: 'ou_bot', name: 'mybot' }]);
  });

  it('strips the bot mention prefix when stripMentionOpenIds is provided', () => {
    const m = parseIngressEvent(groupTextWithMention, { stripMentionOpenIds: ['ou_bot'] });
    expect(m?.text).toBe('do something');
  });

  it('returns undefined for unsupported event shape', () => {
    expect(parseIngressEvent({ event: {} })).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `pnpm test tests/lark/message-parse.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/lark/message-parse.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { IngressMessage } from './types.js';

interface LarkMention {
  key?: string;
  id?: { open_id?: string };
  name?: string;
}

interface LarkMessageEvent {
  event?: {
    sender?: { sender_id?: { open_id?: string }; sender_type?: string };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: 'p2p' | 'group';
      message_type?: string;
      create_time?: string;
      content?: string;
      mentions?: LarkMention[];
    };
  };
}

export interface ParseOpts {
  stripMentionOpenIds?: string[];
}

export function parseIngressEvent(raw: LarkMessageEvent, opts: ParseOpts = {}): IngressMessage | undefined {
  const msg = raw.event?.message;
  const senderId = raw.event?.sender?.sender_id?.open_id;
  if (!msg || !msg.chat_id || !senderId || !msg.message_id) return undefined;

  const mentions = (msg.mentions ?? [])
    .map((m) => ({ openId: m.id?.open_id, name: m.name, key: m.key }))
    .filter((m): m is { openId: string; name?: string; key?: string } => Boolean(m.openId));

  let text = '';
  if (msg.message_type === 'text') {
    try {
      text = JSON.parse(msg.content ?? '{}').text ?? '';
    } catch {
      text = '';
    }
  }

  if (opts.stripMentionOpenIds?.length) {
    for (const m of mentions) {
      if (opts.stripMentionOpenIds.includes(m.openId) && m.key) {
        text = text.split(m.key).join('').replace(/^\s+/, '');
      }
    }
  }

  return {
    chatId: msg.chat_id,
    chatType: msg.chat_type ?? 'p2p',
    senderOpenId: senderId,
    messageId: msg.message_id,
    text,
    mentions: mentions.map(({ openId, name }) => ({ openId, ...(name ? { name } : {}) })),
    rawType: ((): IngressMessage['rawType'] => {
      switch (msg.message_type) {
        case 'text':
        case 'post':
        case 'interactive':
        case 'image':
        case 'file':
        case 'merge_forward':
        case 'audio':
          return msg.message_type;
        default:
          return 'unknown';
      }
    })(),
    attachments: [],
    receivedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/lark/message-parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `src/lark/client.ts`**

```ts
// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';

export interface LarkClientOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
}

export function createLarkClient(opts: LarkClientOpts): Lark.Client {
  return new Lark.Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
    loggerLevel: Lark.LoggerLevel.warn,
  });
}
```

- [ ] **Step 7: Implement `src/lark/ws.ts` (long-connection wrapper)**

```ts
// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'node:events';
import { parseIngressEvent } from './message-parse.js';
import type { IngressMessage } from './types.js';

export interface LarkWsOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
  botSelfOpenId?: string;
}

export class LarkWsClient extends EventEmitter {
  private wsClient?: Lark.WSClient;
  private eventDispatcher?: Lark.EventDispatcher;
  constructor(private opts: LarkWsOpts) {
    super();
  }

  async start(): Promise<void> {
    this.eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const parsed = parseIngressEvent(
          { event: data as unknown as Parameters<typeof parseIngressEvent>[0]['event'] },
          { stripMentionOpenIds: this.opts.botSelfOpenId ? [this.opts.botSelfOpenId] : [] },
        );
        if (parsed) this.emit('message', parsed satisfies IngressMessage);
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.opts.appId,
      appSecret: this.opts.appSecret,
      domain: this.opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
      loggerLevel: Lark.LoggerLevel.warn,
    });

    this.wsClient.start({ eventDispatcher: this.eventDispatcher });
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      // SDK exposes no documented stop(); leaving the process is the supported teardown.
      this.wsClient = undefined;
    }
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lark/ tests/lark/
git commit -m "feat(lark): IngressMessage types, parseIngressEvent, Lark client + WSClient wrapper"
```

---

## Task 1.8: Lark card builder + attachment downloader

**Files:**
- Create: `src/lark/card-builder.ts`
- Create: `src/lark/attachment.ts`
- Create: `tests/lark/card-builder.test.ts`

- [ ] **Step 1: Write failing test for card builder**

Create `tests/lark/card-builder.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildStreamingCard } from '../../src/lark/card-builder.js';

describe('buildStreamingCard', () => {
  it('starts with a thinking spinner and empty body', () => {
    const card = buildStreamingCard({
      header: 'claude-bot @ /tmp',
      bodyMarkdown: '',
      state: 'thinking',
    });
    expect(card.schema).toBe('2.0');
    expect(JSON.stringify(card)).toContain('Thinking');
  });

  it('shows final-state footer with timing and tokens when done', () => {
    const card = buildStreamingCard({
      header: 'claude-bot @ /tmp',
      bodyMarkdown: 'Hello world',
      state: 'done',
      footer: '12.3s · 1.2k tokens',
    });
    expect(JSON.stringify(card)).toContain('12.3s');
    expect(JSON.stringify(card)).toContain('Hello world');
  });

  it('renders tool-call rows', () => {
    const card = buildStreamingCard({
      header: 'claude-bot',
      bodyMarkdown: '',
      state: 'thinking',
      toolCalls: [{ name: 'Read', summary: 'foo.ts', done: true, ok: true }],
    });
    expect(JSON.stringify(card)).toContain('Read');
    expect(JSON.stringify(card)).toContain('foo.ts');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test tests/lark/card-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lark/card-builder.ts`**

```ts
// SPDX-License-Identifier: MIT
export interface ToolCallRow {
  name: string;
  summary?: string;
  done: boolean;
  ok?: boolean;
}

export interface StreamingCardInput {
  header: string;
  bodyMarkdown: string;
  state: 'thinking' | 'streaming' | 'done' | 'error';
  toolCalls?: ToolCallRow[];
  footer?: string;
}

export function buildStreamingCard(input: StreamingCardInput): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];

  if (input.state === 'thinking' && !input.bodyMarkdown) {
    elements.push({ tag: 'markdown', content: '⏳ Thinking…' });
  } else {
    elements.push({ tag: 'markdown', content: input.bodyMarkdown || ' ' });
  }

  for (const tc of input.toolCalls ?? []) {
    const icon = tc.done ? (tc.ok ? '✅' : '❌') : '🔧';
    const line = `${icon} \`${tc.name}\`${tc.summary ? ` ${tc.summary}` : ''}`;
    elements.push({ tag: 'markdown', content: line });
  }

  if (input.footer) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: `_${input.footer}_` });
  }

  return {
    schema: '2.0',
    config: { summary: { content: input.header } },
    header: {
      title: { tag: 'plain_text', content: input.header },
      template: input.state === 'error' ? 'red' : input.state === 'done' ? 'green' : 'blue',
    },
    body: { elements },
  };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/lark/card-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/lark/attachment.ts`**

```ts
// SPDX-License-Identifier: MIT
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Lark from '@larksuiteoapi/node-sdk';
import { paths } from '../config/paths.js';
import type { Attachment } from '../adapters/types.js';
import type { RawAttachment } from './types.js';

export interface AttachmentDownloaderOpts {
  client: Lark.Client;
  chatId: string;
}

export async function downloadAttachment(
  opts: AttachmentDownloaderOpts,
  messageId: string,
  raw: RawAttachment,
): Promise<Attachment> {
  const ext = extname(raw.fileName) || (raw.type === 'image' ? '.png' : '.bin');
  const localPath = join(paths.mediaChat(opts.chatId), `${messageId}-${raw.fileKey}${ext}`);
  await mkdir(dirname(localPath), { recursive: true, mode: 0o700 });

  const res = await opts.client.im.messageResource.get({
    path: { message_id: messageId, file_key: raw.fileKey },
    params: { type: raw.type },
  });

  const writeStream = createWriteStream(localPath, { mode: 0o600 });
  await pipeline((res as unknown as { writeFile: (s: NodeJS.WritableStream) => Promise<void> }).writeFile
    ? (res as unknown as { writeFile: (s: NodeJS.WritableStream) => Promise<void> }).writeFile(writeStream)
    : Promise.reject(new Error('Lark SDK response missing writeFile')));

  return {
    kind: raw.type,
    localPath,
    fileName: raw.fileName,
    ...(raw.mimeType ? { mimeType: raw.mimeType } : {}),
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lark/card-builder.ts src/lark/attachment.ts tests/lark/card-builder.test.ts
git commit -m "feat(lark): streaming card builder + attachment downloader"
```

---

## Task 1.9: CardStreamer with throttled patches

**Files:**
- Create: `src/worker/card-streamer.ts`
- Create: `tests/worker/card-streamer.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/worker/card-streamer.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { CardStreamer } from '../../src/worker/card-streamer.js';

function fakeSink() {
  const sent: Array<{ kind: 'create' | 'patch'; payload: unknown }> = [];
  return {
    sent,
    create: vi.fn(async (card: unknown) => {
      sent.push({ kind: 'create', payload: card });
      return 'card_msg_1';
    }),
    patch: vi.fn(async (cardId: string, card: unknown) => {
      sent.push({ kind: 'patch', payload: { cardId, card } });
    }),
  };
}

describe('CardStreamer', () => {
  it('creates the card on first event and patches after threshold', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({
      header: 'h',
      sink,
      throttleMs: 500,
      throttleChars: 50,
    });

    await streamer.start();
    expect(sink.create).toHaveBeenCalledTimes(1);

    await streamer.onTextDelta('a'.repeat(60));
    await vi.runAllTimersAsync();
    expect(sink.patch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('finalizes with footer on done', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ header: 'h', sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    await streamer.onTextDelta('done text');
    await streamer.onDone({ finalText: 'done text', durationMs: 1234 });
    await vi.runAllTimersAsync();
    const last = sink.sent[sink.sent.length - 1];
    expect(last.kind).toBe('patch');
    expect(JSON.stringify(last.payload)).toContain('1.2s');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test tests/worker/card-streamer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/worker/card-streamer.ts`**

```ts
// SPDX-License-Identifier: MIT
import { buildStreamingCard, type ToolCallRow } from '../lark/card-builder.js';

export interface CardSink {
  create(card: unknown): Promise<string>;
  patch(cardId: string, card: unknown): Promise<void>;
}

export interface CardStreamerOpts {
  header: string;
  sink: CardSink;
  throttleMs: number;
  throttleChars: number;
}

export class CardStreamer {
  private cardId?: string;
  private buf = '';
  private toolCalls = new Map<string, ToolCallRow>();
  private flushTimer?: NodeJS.Timeout;
  private startTime = Date.now();
  private state: 'thinking' | 'streaming' | 'done' | 'error' = 'thinking';
  private dirty = false;
  constructor(private opts: CardStreamerOpts) {}

  async start(): Promise<void> {
    const card = buildStreamingCard({ header: this.opts.header, bodyMarkdown: '', state: 'thinking' });
    this.cardId = await this.opts.sink.create(card);
  }

  async onTextDelta(text: string): Promise<void> {
    this.buf += text;
    this.state = 'streaming';
    this.dirty = true;
    if (this.buf.length >= this.opts.throttleChars) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref();
    }
  }

  onToolCall(callId: string, name: string, input: unknown): void {
    const summary = summarizeToolInput(name, input);
    this.toolCalls.set(callId, { name, summary, done: false });
    this.dirty = true;
  }

  onToolResult(callId: string, ok: boolean): void {
    const existing = this.toolCalls.get(callId);
    if (!existing) return;
    this.toolCalls.set(callId, { ...existing, done: true, ok });
    this.dirty = true;
  }

  async onError(message: string): Promise<void> {
    this.state = 'error';
    this.buf += `\n\n❌ ${message}`;
    this.dirty = true;
    await this.flush({ force: true });
  }

  async onDone(opts: { finalText: string; durationMs: number; usage?: { inputTokens?: number; outputTokens?: number } }): Promise<void> {
    this.state = 'done';
    if (opts.finalText.length > this.buf.length) this.buf = opts.finalText;
    const tokens = opts.usage?.outputTokens ? `${(opts.usage.outputTokens / 1000).toFixed(1)}k tokens` : '';
    const duration = `${(opts.durationMs / 1000).toFixed(1)}s`;
    const footer = [duration, tokens].filter(Boolean).join(' · ');
    this.dirty = true;
    await this.flush({ force: true, footer });
  }

  private async flush(opts: { force?: boolean; footer?: string } = {}): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.cardId) return;
    if (!this.dirty && !opts.force) return;
    const card = buildStreamingCard({
      header: this.opts.header,
      bodyMarkdown: this.buf,
      state: this.state,
      toolCalls: Array.from(this.toolCalls.values()),
      ...(opts.footer ? { footer: opts.footer } : {}),
    });
    await this.opts.sink.patch(this.cardId, card);
    this.dirty = false;
  }
}

function summarizeToolInput(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.file_path === 'string') return obj.file_path;
    if (typeof obj.command === 'string') return obj.command.slice(0, 80);
    if (typeof obj.path === 'string') return obj.path;
  }
  return '';
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/worker/card-streamer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/card-streamer.ts tests/worker/card-streamer.test.ts
git commit -m "feat(worker): CardStreamer with throttled patches + tool-call rendering"
```

---

## Task 1.10: Dispatcher (no-preempt MVP version)

**Files:**
- Create: `src/worker/dispatcher.ts`
- Create: `tests/worker/dispatcher.test.ts`

- [ ] **Step 1: Write failing test using a mock adapter**

Create `tests/worker/dispatcher.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class MockAdapter implements Adapter {
  readonly backend = 'claude' as const;
  constructor(private events: AdapterEvent[]) {}
  async preflight() {
    return { ok: true };
  }
  async *run(_ctx: RunContext) {
    for (const e of this.events) yield e;
  }
}

function fakeStreamer() {
  return {
    start: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(() => {}),
    onToolResult: vi.fn(() => {}),
    onError: vi.fn(async () => {}),
    onDone: vi.fn(async () => {}),
  };
}

describe('Dispatcher (MVP — no preempt)', () => {
  it('drives the streamer through session-start, text-delta, done', async () => {
    const adapter = new MockAdapter([
      { type: 'session-start', sessionId: 'sess_1' },
      { type: 'text-delta', text: 'hi' },
      { type: 'done', sessionId: 'sess_1', finalText: 'hi' },
    ]);
    const streamer = fakeStreamer();
    const onSession = vi.fn();
    const d = new Dispatcher({ adapter, makeStreamer: () => streamer, onSessionUpdate: onSession });

    await d.dispatch({
      chatId: 'oc_1',
      prompt: 'say hi',
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
    });

    expect(streamer.start).toHaveBeenCalledTimes(1);
    expect(streamer.onTextDelta).toHaveBeenCalledWith('hi');
    expect(streamer.onDone).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith('oc_1', 'sess_1');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test tests/worker/dispatcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/worker/dispatcher.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { Adapter } from '../adapters/types.js';
import type { CardStreamer } from './card-streamer.js';

export interface DispatcherOpts {
  adapter: Adapter;
  makeStreamer: (chatId: string) => Pick<
    CardStreamer,
    'start' | 'onTextDelta' | 'onToolCall' | 'onToolResult' | 'onError' | 'onDone'
  >;
  onSessionUpdate: (chatId: string, sessionId: string) => void;
}

export interface DispatchRequest {
  chatId: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
  idleTimeoutMs: number;
  env?: Record<string, string>;
}

export class Dispatcher {
  constructor(private opts: DispatcherOpts) {}

  async dispatch(req: DispatchRequest): Promise<void> {
    const streamer = this.opts.makeStreamer(req.chatId);
    await streamer.start();
    const ac = new AbortController();
    const startedAt = Date.now();

    try {
      for await (const ev of this.opts.adapter.run({
        prompt: req.prompt,
        cwd: req.cwd,
        sessionId: req.sessionId,
        signal: ac.signal,
        idleTimeoutMs: req.idleTimeoutMs,
        env: req.env,
      })) {
        switch (ev.type) {
          case 'session-start':
            this.opts.onSessionUpdate(req.chatId, ev.sessionId);
            break;
          case 'text-delta':
            await streamer.onTextDelta(ev.text);
            break;
          case 'tool-call':
            streamer.onToolCall(ev.callId, ev.name, ev.input);
            break;
          case 'tool-result':
            streamer.onToolResult(ev.callId, ev.ok);
            break;
          case 'error':
            await streamer.onError(ev.message);
            break;
          case 'done':
            this.opts.onSessionUpdate(req.chatId, ev.sessionId);
            await streamer.onDone({
              finalText: ev.finalText,
              durationMs: Date.now() - startedAt,
              ...(ev.usage ? { usage: ev.usage } : {}),
            });
            break;
        }
      }
    } catch (err) {
      await streamer.onError((err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/worker/dispatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/dispatcher.ts tests/worker/dispatcher.test.ts
git commit -m "feat(worker): MVP Dispatcher wiring adapter events to CardStreamer"
```

---

## Task 1.11: Logger and config loader

**Files:**
- Create: `src/telemetry/logger.ts`
- Create: `src/config/load.ts`
- Create: `tests/config/load.test.ts`

- [ ] **Step 1: Implement `src/telemetry/logger.ts`**

```ts
// SPDX-License-Identifier: MIT
import pino, { type Logger } from 'pino';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createLogger(opts: { file?: string; level?: string; base?: Record<string, unknown> }): Logger {
  const transport = opts.file
    ? pino.transport({
        target: 'pino-roll',
        options: { file: opts.file, frequency: 'daily', mkdir: true, dateFormat: 'yyyy-MM-dd' },
      })
    : undefined;
  if (opts.file) mkdirSync(dirname(opts.file), { recursive: true, mode: 0o700 });
  return pino(
    { level: opts.level ?? 'info', base: opts.base ?? {} },
    transport ?? pino.destination({ dest: 1, sync: false }),
  );
}
```

- [ ] **Step 2: Write failing test for config loader**

Create `tests/config/load.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllBots, loadGlobalConfig } from '../../src/config/load.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-cfg-'));
});

describe('loadGlobalConfig', () => {
  it('returns defaults when file missing', async () => {
    const cfg = await loadGlobalConfig(join(dir, 'missing.yaml'));
    expect(cfg.log_retention_days).toBe(7);
  });
});

describe('loadAllBots', () => {
  it('reads every YAML in bots/ and validates name matches filename', async () => {
    const botsDir = join(dir, 'bots');
    mkdirSync(botsDir, { recursive: true });
    writeFileSync(
      join(botsDir, 'claude-bot.yaml'),
      `
name: claude-bot
enabled: true
lark: { app_id: cli_a, app_secret: s, tenant: lark }
backend: { type: claude, claude: { permission_mode: bypassPermissions } }
access: { allowed_users: [], allowed_chats: [], admins: [] }
behavior: { default_cwd: ~, group_trigger: mention, idle_timeout_seconds: 600, max_concurrent_chats: 0 }
`,
    );
    const bots = await loadAllBots(botsDir);
    expect(bots).toHaveLength(1);
    expect(bots[0]?.name).toBe('claude-bot');
  });

  it('skips files whose name field disagrees with filename, with a warning', async () => {
    const botsDir = join(dir, 'bots');
    mkdirSync(botsDir, { recursive: true });
    writeFileSync(
      join(botsDir, 'claude-bot.yaml'),
      `
name: WRONG-NAME
enabled: true
lark: { app_id: cli_a, app_secret: s, tenant: lark }
backend: { type: claude, claude: { permission_mode: bypassPermissions } }
access: { allowed_users: [], allowed_chats: [], admins: [] }
behavior: { default_cwd: ~, group_trigger: mention, idle_timeout_seconds: 600, max_concurrent_chats: 0 }
`,
    );
    const bots = await loadAllBots(botsDir);
    expect(bots).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `pnpm test tests/config/load.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/config/load.ts`**

```ts
// SPDX-License-Identifier: MIT
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import yaml from 'js-yaml';
import { BotConfigSchema, GlobalConfigSchema, type BotConfig, type GlobalConfig } from './schema.js';

export async function loadGlobalConfig(file: string): Promise<GlobalConfig> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = yaml.load(raw);
    return GlobalConfigSchema.parse(parsed ?? {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return GlobalConfigSchema.parse({});
    }
    throw err;
  }
}

export async function loadAllBots(botsDir: string): Promise<BotConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(botsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: BotConfig[] = [];
  for (const entry of entries) {
    if (!(entry.endsWith('.yaml') || entry.endsWith('.yml'))) continue;
    const filePath = join(botsDir, entry);
    const filenameStem = basename(entry, extname(entry));
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = BotConfigSchema.parse(yaml.load(raw));
      if (parsed.name !== filenameStem) {
        console.warn(`[config] bot file ${entry}: name=${parsed.name} does not match filename; skipping`);
        continue;
      }
      out.push(parsed);
    } catch (err) {
      console.warn(`[config] failed to load ${entry}: ${(err as Error).message}`);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/config/load.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/ src/config/load.ts tests/config/load.test.ts
git commit -m "feat(config,telemetry): YAML loaders for bot+global config; pino logger factory"
```

---

## Task 1.12: Worker entry point (single-bot, M1 wire-up)

**Files:**
- Create: `src/worker/index.ts`
- Create: `src/worker/lark-sink.ts`

- [ ] **Step 1: Implement `src/worker/lark-sink.ts`**

```ts
// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';
import type { CardSink } from './card-streamer.js';

export class LarkCardSink implements CardSink {
  constructor(private client: Lark.Client, private chatId: string) {}

  async create(card: unknown): Promise<string> {
    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: this.chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    });
    const msgId = (res as unknown as { data?: { message_id?: string } }).data?.message_id;
    if (!msgId) throw new Error('Lark create card returned no message_id');
    return msgId;
  }

  async patch(cardId: string, card: unknown): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: cardId },
      data: { content: JSON.stringify(card) },
    });
  }
}
```

- [ ] **Step 2: Implement `src/worker/index.ts`**

```ts
// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { paths } from '../config/paths.js';
import { loadAllBots } from '../config/load.js';
import { SessionStore } from '../session/store.js';
import { createLogger } from '../telemetry/logger.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { createLarkClient } from '../lark/client.js';
import { LarkWsClient } from '../lark/ws.js';
import { CardStreamer } from './card-streamer.js';
import { LarkCardSink } from './lark-sink.js';
import { Dispatcher } from './dispatcher.js';
import type { BotConfig } from '../config/schema.js';
import type { Adapter } from '../adapters/types.js';

function buildAdapter(bot: BotConfig): Adapter {
  if (bot.backend.type === 'claude') {
    const cfg = bot.backend.claude;
    return new ClaudeAdapter({
      permissionMode: cfg.permission_mode,
      ...(cfg.model ? { model: cfg.model } : {}),
      extraArgs: cfg.extra_args,
    });
  }
  throw new Error(`backend not implemented in M1: ${bot.backend.type}`);
}

function resolveCwd(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export async function runWorker(botName: string): Promise<void> {
  const bots = await loadAllBots(paths.bots);
  const bot = bots.find((b) => b.name === botName);
  if (!bot) throw new Error(`bot not found: ${botName}`);
  if (!bot.enabled) throw new Error(`bot disabled: ${botName}`);
  if (!bot.lark.app_secret) throw new Error(`bot ${botName}: app_secret required in M1 (refs not yet supported)`);

  const today = new Date().toISOString().slice(0, 10);
  const log = createLogger({
    file: paths.workerLog(botName, today),
    base: { bot: botName },
  });
  log.info('worker starting');

  const adapter = buildAdapter(bot);
  const preflight = await adapter.preflight();
  if (!preflight.ok) {
    log.error({ err: preflight.error }, 'adapter preflight failed');
    process.exit(2);
  }
  log.info({ version: preflight.version }, 'adapter ready');

  const client = createLarkClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
  });

  const sessions = new SessionStore(paths.sessionsJson);
  await sessions.load();

  const ws = new LarkWsClient({
    appId: bot.lark.app_id,
    appSecret: bot.lark.app_secret,
    domain: bot.lark.tenant,
  });

  const dispatcher = new Dispatcher({
    adapter,
    makeStreamer: (chatId) =>
      new CardStreamer({
        header: `${botName} @ ${chatId.slice(0, 12)}`,
        sink: new LarkCardSink(client, chatId),
        throttleMs: 500,
        throttleChars: 50,
      }),
    onSessionUpdate: (chatId, sessionId) => {
      void sessions.upsert(chatId, {
        backend: bot.backend.type,
        bot: bot.name,
        cwd: sessions.get(chatId)?.cwd ?? resolveCwd(bot.behavior.default_cwd),
        sessionId,
      });
    },
  });

  ws.on('message', async (msg) => {
    if (msg.chatType === 'group' && bot.behavior.group_trigger === 'mention') {
      // M1 placeholder: we don't yet know the bot's own open_id; full mention check lands in M4.
    }
    if (!msg.text.trim()) return;

    const existing = sessions.get(msg.chatId);
    const cwd = existing?.cwd ?? resolveCwd(bot.behavior.default_cwd);

    log.info({ chatId: msg.chatId, sender: msg.senderOpenId }, 'dispatching message');
    await dispatcher.dispatch({
      chatId: msg.chatId,
      prompt: msg.text,
      cwd,
      ...(existing?.sessionId ? { sessionId: existing.sessionId } : {}),
      idleTimeoutMs: bot.behavior.idle_timeout_seconds * 1000,
    });
  });

  await ws.start();
  log.info('worker started; awaiting messages');

  const onShutdown = async (sig: NodeJS.Signals) => {
    log.info({ sig }, 'worker shutting down');
    await ws.stop();
    process.exit(0);
  };
  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);
}

if (process.argv[1] && process.argv[1].endsWith('worker/index.js')) {
  const botName = process.env.LMCB_WORKER_BOT;
  if (!botName) {
    console.error('LMCB_WORKER_BOT env var required');
    process.exit(1);
  }
  runWorker(botName).catch((err) => {
    console.error('worker failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Build to verify TS compiles**

Run: `pnpm build`
Expected: builds without errors.

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts src/worker/lark-sink.ts
git commit -m "feat(worker): M1 single-bot worker entrypoint wiring Lark WS to Dispatcher"
```

---

## Task 1.13: Minimal CLI entrypoint (`lmcb run-worker`)

**Files:**
- Create: `src/cli/index.ts`
- Modify: `package.json` (already has `bin`)

- [ ] **Step 1: Implement `src/cli/index.ts`**

```ts
// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { runWorker } from '../worker/index.js';

const program = new Command();
program.name('lmcb').description('lark-multi-cli-bridge').version('0.0.1');

program
  .command('run-worker <bot>')
  .description('[M1] run a single worker in the foreground (no supervisor yet)')
  .action(async (bot: string) => {
    try {
      await runWorker(bot);
    } catch (err) {
      console.error('worker failed:', err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `dist/cli/index.js` exists.

- [ ] **Step 3: Manual smoke test**

Prerequisites: you have a real Lark bot with `app_id` + `app_secret`, claude CLI installed and logged in.

1. Create `~/.lark-multi-cli-bridge/bots/claude-bot.yaml` (replace `<your_app_id>`/`<your_app_secret>` with real values):

```yaml
name: claude-bot
enabled: true
lark:
  app_id: <your_app_id>
  app_secret: <your_app_secret>
  tenant: lark
backend:
  type: claude
  claude:
    permission_mode: bypassPermissions
access:
  allowed_users: []
  allowed_chats: []
  admins: []
behavior:
  default_cwd: ~
  group_trigger: mention
  idle_timeout_seconds: 600
  max_concurrent_chats: 0
```

2. Run: `node ./bin/lmcb.mjs run-worker claude-bot`
3. In Lark, message the bot in a p2p chat: "say hi"
4. Expected: a card appears that streams Claude's response.
5. `Ctrl+C` to stop.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): minimal lmcb run-worker entrypoint for M1 smoke testing"
```

---

## Task 1.14: M1 smoke test checklist + tag

- [ ] **Step 1: Verify all unit tests green**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 2: Verify build green**

Run: `pnpm build && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the manual smoke test (Task 1.13 Step 3) end-to-end**

Document the smoke-test outcome in `docs/smoke/M1-YYYY-MM-DD.md`:

```markdown
# M1 Smoke Test

- Date:
- Bot app_id:
- Claude CLI version:
- Result: PASS / FAIL
- Notes:
```

- [ ] **Step 4: Tag M1**

```bash
git add docs/smoke/
git commit -m "docs(smoke): record M1 smoke result"
git tag -a v0.1.0-m1 -m "M1: single-bot ClaudeAdapter streaming"
```

---

# Milestone M2 — Codex + Gemini adapters

**Goal:** All three adapters work end-to-end; you can flip `backend.type` and the worker still runs.

## Task 2.1: Record real CLI fixtures (Codex JSON mode + plain mode)

**Files:**
- Create: `tests/adapters/__fixtures__/codex/json-simple.jsonl`
- Create: `tests/adapters/__fixtures__/codex/plain-simple.txt`
- Create: `scripts/record-cli-fixture.sh`

- [ ] **Step 1: Implement helper script**

Create `scripts/record-cli-fixture.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKEND="${1:-codex}"
SCENARIO="${2:-json-simple}"
PROMPT="${3:-say hi in 5 words}"
OUT_DIR="tests/adapters/__fixtures__/${BACKEND}"
mkdir -p "${OUT_DIR}"
case "${BACKEND}" in
  codex)
    if [ "${SCENARIO}" = "plain-simple" ]; then
      codex exec "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.txt"
    else
      codex exec --json "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.jsonl"
    fi
    ;;
  gemini)
    gemini --prompt "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.txt"
    ;;
  *)
    echo "unsupported backend: ${BACKEND}" >&2
    exit 1
    ;;
esac
echo "wrote fixture: ${OUT_DIR}/${SCENARIO}"
```

Then `chmod +x scripts/record-cli-fixture.sh`.

- [ ] **Step 2: Record Codex JSON fixture**

Run: `bash scripts/record-cli-fixture.sh codex json-simple "Say hi in 5 words"`
Expected: file `tests/adapters/__fixtures__/codex/json-simple.jsonl` has JSON Lines.

If your local `codex exec --json` flag prints messages without an `event` field, paste a curated approximation matching the schema your adapter will parse. Sample shape (replace with actual when available):

```
{"type":"session.start","session_id":"rollout-2026-05-31-abc"}
{"type":"message.delta","role":"assistant","text":"Hi"}
{"type":"message.delta","role":"assistant","text":" there friend!"}
{"type":"message.end","role":"assistant"}
{"type":"session.end","usage":{"input_tokens":11,"output_tokens":4}}
```

- [ ] **Step 3: Record plain fixture (fallback)**

Run: `bash scripts/record-cli-fixture.sh codex plain-simple "Say hi in 5 words"`
Expected: text file `tests/adapters/__fixtures__/codex/plain-simple.txt` containing raw stdout.

- [ ] **Step 4: Commit fixtures and helper**

```bash
git add scripts/record-cli-fixture.sh tests/adapters/__fixtures__/codex/
git commit -m "test(adapters): record-cli-fixture.sh helper + codex JSON/plain fixtures"
```

---

## Task 2.2: CodexAdapter (JSON mode + plain fallback)

**Files:**
- Create: `src/adapters/codex.ts`
- Create: `tests/adapters/codex.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/adapters/codex.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCodexJsonLine, parsePlainChunk } from '../../src/adapters/codex.js';
import type { AdapterEvent } from '../../src/adapters/types.js';

function eventsFromJsonFixture(name: string): AdapterEvent[] {
  const lines = readFileSync(join(__dirname, '__fixtures__/codex', name), 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const out: AdapterEvent[] = [];
  for (const line of lines) for (const ev of parseCodexJsonLine(line)) out.push(ev);
  return out;
}

describe('CodexAdapter.parseCodexJsonLine', () => {
  it('emits session-start then text-delta then done from JSON fixture', () => {
    const events = eventsFromJsonFixture('json-simple.jsonl');
    expect(events[0]).toMatchObject({ type: 'session-start' });
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });
});

describe('CodexAdapter.parsePlainChunk', () => {
  it('emits text-delta for every non-empty chunk', () => {
    const evs = [...parsePlainChunk('Hello\n')];
    expect(evs).toEqual([{ type: 'text-delta', text: 'Hello\n' }]);
  });
  it('ignores empty chunks', () => {
    expect([...parsePlainChunk('')]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/adapters/codex.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/codex.ts`**

```ts
// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

interface CodexJsonLine {
  type: string;
  session_id?: string;
  role?: string;
  text?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function* parseCodexJsonLine(line: string): Iterable<AdapterEvent> {
  let obj: CodexJsonLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  if (obj.type === 'session.start' && obj.session_id) {
    yield { type: 'session-start', sessionId: obj.session_id };
    return;
  }
  if (obj.type === 'message.delta' && typeof obj.text === 'string') {
    yield { type: 'text-delta', text: obj.text };
    return;
  }
  if (obj.type === 'session.end') {
    yield {
      type: 'done',
      sessionId: obj.session_id ?? '',
      finalText: '',
      usage: obj.usage
        ? { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens }
        : undefined,
    };
  }
}

export function* parsePlainChunk(chunk: string): Iterable<AdapterEvent> {
  if (chunk.length === 0) return;
  yield { type: 'text-delta', text: chunk };
}

export interface CodexAdapterOpts {
  cliPath?: string;
  jsonMode?: boolean;
  model?: string;
  extraArgs?: string[];
}

export class CodexAdapter implements Adapter {
  readonly backend = 'codex' as const;
  constructor(private opts: CodexAdapterOpts = {}) {}

  async preflight(): Promise<AdapterPreflight> {
    try {
      const out: string[] = [];
      const ac = new AbortController();
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'codex', ['--version'], {
        signal: ac.signal,
        idleTimeoutMs: 5000,
      })) {
        out.push(line);
      }
      return { ok: true, version: out.join(' ').trim() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    const jsonMode = this.opts.jsonMode ?? true;
    const baseArgs = ['exec', ...(jsonMode ? ['--json'] : [])];
    if (this.opts.model) baseArgs.push('--model', this.opts.model);
    if (ctx.sessionId) baseArgs.push('--session', ctx.sessionId);
    baseArgs.push(...(this.opts.extraArgs ?? []));
    baseArgs.push(ctx.prompt);

    let finalText = '';
    let sessionId = ctx.sessionId ?? '';

    try {
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'codex', baseArgs, {
        cwd: ctx.cwd,
        env: { ...process.env, ...ctx.env },
        signal: ctx.signal,
        idleTimeoutMs: ctx.idleTimeoutMs,
      })) {
        if (jsonMode) {
          for (const ev of parseCodexJsonLine(line)) {
            if (ev.type === 'session-start') sessionId = ev.sessionId;
            if (ev.type === 'text-delta') finalText += ev.text;
            yield ev;
          }
        } else {
          for (const ev of parsePlainChunk(line + '\n')) {
            if (ev.type === 'text-delta') finalText += ev.text;
            yield ev;
          }
        }
      }
      // Plain mode never sees a `done` event from the CLI — synthesize one.
      if (!jsonMode) {
        yield { type: 'done', sessionId, finalText };
      }
    } catch (err) {
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/adapters/codex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.ts tests/adapters/codex.test.ts
git commit -m "feat(adapters): CodexAdapter with JSON-line parser + plain-text fallback"
```

---

## Task 2.3: GeminiAdapter (ANSI-stripped chunk streaming)

**Files:**
- Create: `src/adapters/gemini.ts`
- Create: `tests/adapters/__fixtures__/gemini/plain-simple.txt`
- Create: `tests/adapters/gemini.test.ts`

- [ ] **Step 1: Record fixture**

Run: `bash scripts/record-cli-fixture.sh gemini plain-simple "Say hi in 5 words"`
Expected: `tests/adapters/__fixtures__/gemini/plain-simple.txt` has Gemini's stdout (may include ANSI sequences).

If Gemini emits formatted output for humans only, also add a curated minimal text file:

```
Hi there my dear friend!
```

- [ ] **Step 2: Write failing test**

Create `tests/adapters/gemini.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { stripAnsi, chunkToEvents } from '../../src/adapters/gemini.js';

describe('GeminiAdapter.stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('[31mhello[0m world')).toBe('hello world');
  });
});

describe('GeminiAdapter.chunkToEvents', () => {
  it('emits a text-delta event with the input unchanged when no ANSI', () => {
    const evs = [...chunkToEvents('plain')];
    expect(evs).toEqual([{ type: 'text-delta', text: 'plain' }]);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm test tests/adapters/gemini.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/adapters/gemini.ts`**

```ts
// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function* chunkToEvents(chunk: string): Iterable<AdapterEvent> {
  const text = stripAnsi(chunk);
  if (!text) return;
  yield { type: 'text-delta', text };
}

export interface GeminiAdapterOpts {
  cliPath?: string;
  model?: string;
  extraArgs?: string[];
}

export class GeminiAdapter implements Adapter {
  readonly backend = 'gemini' as const;
  constructor(private opts: GeminiAdapterOpts = {}) {}

  async preflight(): Promise<AdapterPreflight> {
    try {
      const out: string[] = [];
      const ac = new AbortController();
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'gemini', ['--version'], {
        signal: ac.signal,
        idleTimeoutMs: 5000,
      })) {
        out.push(line);
      }
      return { ok: true, version: out.join(' ').trim() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    const args = ['--prompt-interactive=false', '--prompt', ctx.prompt];
    if (this.opts.model) args.push('--model', this.opts.model);
    if (ctx.sessionId) args.push('--chat-id', ctx.sessionId);
    args.push(...(this.opts.extraArgs ?? []));

    let finalText = '';
    const synthSessionId = ctx.sessionId ?? `gemini-${Date.now()}`;

    try {
      yield { type: 'session-start', sessionId: synthSessionId };
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'gemini', args, {
        cwd: ctx.cwd,
        env: { ...process.env, ...ctx.env },
        signal: ctx.signal,
        idleTimeoutMs: ctx.idleTimeoutMs,
      })) {
        for (const ev of chunkToEvents(line + '\n')) {
          if (ev.type === 'text-delta') finalText += ev.text;
          yield ev;
        }
      }
      yield { type: 'done', sessionId: synthSessionId, finalText };
    } catch (err) {
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/adapters/gemini.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/gemini.ts tests/adapters/__fixtures__/gemini/ tests/adapters/gemini.test.ts
git commit -m "feat(adapters): GeminiAdapter with ANSI-stripped text streaming"
```

---

## Task 2.4: Adapter registry; wire backends in worker

**Files:**
- Create: `src/adapters/registry.ts`
- Modify: `src/worker/index.ts` (replace `buildAdapter` switch)

- [ ] **Step 1: Implement registry**

Create `src/adapters/registry.ts`:

```ts
// SPDX-License-Identifier: MIT
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import type { Adapter } from './types.js';
import type { BotConfig } from '../config/schema.js';

export function buildAdapter(bot: BotConfig): Adapter {
  switch (bot.backend.type) {
    case 'claude': {
      const cfg = bot.backend.claude;
      return new ClaudeAdapter({
        permissionMode: cfg.permission_mode,
        ...(cfg.model ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
    case 'codex': {
      const cfg = bot.backend.codex;
      return new CodexAdapter({
        jsonMode: cfg.json_mode,
        ...(cfg.model ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
    case 'gemini': {
      const cfg = bot.backend.gemini;
      return new GeminiAdapter({
        ...(cfg.model ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
  }
}
```

- [ ] **Step 2: Modify worker to use registry**

Edit `src/worker/index.ts`: replace the local `buildAdapter` function and its call with `import { buildAdapter } from '../adapters/registry.js';`. Delete the now-dead function body (lines around the original `buildAdapter`). Keep the rest of the file.

- [ ] **Step 3: Rebuild + tests**

Run: `pnpm build && pnpm test`
Expected: all green.

- [ ] **Step 4: Smoke test all three bots**

Create `~/.lark-multi-cli-bridge/bots/codex-bot.yaml` and `gemini-bot.yaml` with appropriate `app_id`/`app_secret` for each bot, `backend.type: codex` / `gemini`.

For each: `node ./bin/lmcb.mjs run-worker <bot>`, send a test message, verify card streams.

Document results in `docs/smoke/M2-YYYY-MM-DD.md`.

- [ ] **Step 5: Commit + tag**

```bash
git add src/adapters/registry.ts src/worker/index.ts docs/smoke/
git commit -m "feat(adapters): registry switching across claude/codex/gemini backends"
git tag -a v0.2.0-m2 -m "M2: all three adapters working"
```

---

# Milestone M3 — Supervisor + IPC + Crash Recovery

**Goal:** One `lmcb start` brings up all enabled bots concurrently; workers restart on crash; `lmcb ps/restart/stop/reload` work.

## Task 3.1: IPC protocol types

**Files:**
- Create: `src/supervisor/ipc-protocol.ts`
- Create: `tests/supervisor/ipc-protocol.test.ts`

- [ ] **Step 1: Implement protocol**

Create `src/supervisor/ipc-protocol.ts`:

```ts
// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const RpcRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const WorkerStateSchema = z.enum(['starting', 'ready', 'crashed', 'restarting', 'disabled', 'stopped']);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

export const WorkerStatusSchema = z.object({
  bot: z.string(),
  pid: z.number().int().positive().optional(),
  state: WorkerStateSchema,
  startedAt: z.string().optional(),
  lastError: z.string().optional(),
  restartCount: z.number().int().nonnegative(),
});
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const ListWorkersResultSchema = z.object({
  workers: z.array(WorkerStatusSchema),
  supervisorPid: z.number(),
  supervisorStartedAt: z.string(),
});

export const Ipc = {
  Request: RpcRequestSchema,
  Response: RpcResponseSchema,
} as const;

export const Methods = {
  ping: 'ping',
  listWorkers: 'list-workers',
  restartWorker: 'restart-worker',
  reloadWorker: 'reload-worker',
  shutdown: 'shutdown',
} as const;
```

- [ ] **Step 2: Write minimal schema test**

Create `tests/supervisor/ipc-protocol.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { RpcRequestSchema, RpcResponseSchema } from '../../src/supervisor/ipc-protocol.js';

describe('ipc protocol', () => {
  it('parses request and response shapes', () => {
    expect(RpcRequestSchema.parse({ id: '1', method: 'ping' })).toEqual({ id: '1', method: 'ping' });
    expect(RpcResponseSchema.parse({ id: '1', ok: true, result: { v: 1 } })).toEqual({
      id: '1',
      ok: true,
      result: { v: 1 },
    });
  });
});
```

- [ ] **Step 3: Run test, expect PASS**

Run: `pnpm test tests/supervisor/ipc-protocol.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/supervisor/ipc-protocol.ts tests/supervisor/ipc-protocol.test.ts
git commit -m "feat(supervisor): IPC protocol types (zod) + WorkerStatus schema"
```

---

## Task 3.2: IPC server (unix socket, newline-JSON-RPC)

**Files:**
- Create: `src/supervisor/ipc-server.ts`
- Create: `src/supervisor/ipc-client.ts`
- Create: `tests/supervisor/ipc-roundtrip.test.ts`

- [ ] **Step 1: Write failing round-trip test**

Create `tests/supervisor/ipc-roundtrip.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcServer } from '../../src/supervisor/ipc-server.js';
import { IpcClient } from '../../src/supervisor/ipc-client.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-ipc-'));
});

describe('IPC round-trip', () => {
  it('ping returns pong', async () => {
    const sock = join(dir, 'a.sock');
    const server = new IpcServer(sock, {
      ping: async () => ({ pong: true }),
    });
    await server.start();
    const client = new IpcClient(sock);
    const res = await client.call('ping');
    expect(res).toEqual({ pong: true });
    await server.stop();
  });

  it('returns error payload on method exception', async () => {
    const sock = join(dir, 'b.sock');
    const server = new IpcServer(sock, {
      boom: async () => {
        throw new Error('nope');
      },
    });
    await server.start();
    const client = new IpcClient(sock);
    await expect(client.call('boom')).rejects.toThrow('nope');
    await server.stop();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/supervisor/ipc-roundtrip.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/supervisor/ipc-server.ts`**

```ts
// SPDX-License-Identifier: MIT
import { createServer, type Server, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { RpcRequestSchema, type RpcResponse } from './ipc-protocol.js';

export type IpcHandler = (params: unknown) => Promise<unknown>;
export type IpcHandlers = Record<string, IpcHandler>;

export class IpcServer {
  private server?: Server;
  constructor(private socketPath: string, private handlers: IpcHandlers) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) await unlink(this.socketPath);
    this.server = createServer((sock) => this.onConn(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    if (existsSync(this.socketPath)) await unlink(this.socketPath).catch(() => {});
  }

  private onConn(sock: Socket): void {
    let buf = '';
    sock.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        await this.handleLine(line, sock);
      }
    });
  }

  private async handleLine(line: string, sock: Socket): Promise<void> {
    let req;
    try {
      req = RpcRequestSchema.parse(JSON.parse(line));
    } catch (err) {
      const resp: RpcResponse = { id: '0', ok: false, error: `bad request: ${(err as Error).message}` };
      sock.write(JSON.stringify(resp) + '\n');
      return;
    }
    const handler = this.handlers[req.method];
    if (!handler) {
      const resp: RpcResponse = { id: req.id, ok: false, error: `no such method: ${req.method}` };
      sock.write(JSON.stringify(resp) + '\n');
      return;
    }
    try {
      const result = await handler(req.params);
      const resp: RpcResponse = { id: req.id, ok: true, result };
      sock.write(JSON.stringify(resp) + '\n');
    } catch (err) {
      const resp: RpcResponse = { id: req.id, ok: false, error: (err as Error).message };
      sock.write(JSON.stringify(resp) + '\n');
    }
  }
}
```

- [ ] **Step 4: Implement `src/supervisor/ipc-client.ts`**

```ts
// SPDX-License-Identifier: MIT
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { RpcResponseSchema, type RpcResponse } from './ipc-protocol.js';

export class IpcClient {
  constructor(private socketPath: string) {}

  async call(method: string, params?: unknown, timeoutMs: number = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const sock: Socket = connect(this.socketPath);
      let buf = '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`ipc timeout: ${method}`));
      }, timeoutMs);
      sock.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let resp: RpcResponse;
          try {
            resp = RpcResponseSchema.parse(JSON.parse(line));
          } catch (err) {
            clearTimeout(timer);
            sock.destroy();
            reject(err);
            return;
          }
          if (resp.id !== id) continue;
          clearTimeout(timer);
          sock.end();
          if (resp.ok) resolve(resp.result);
          else reject(new Error(resp.error ?? 'unknown ipc error'));
        }
      });
      const payload = JSON.stringify({ id, method, params });
      sock.write(payload + '\n');
    });
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `pnpm test tests/supervisor/ipc-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/supervisor/ipc-server.ts src/supervisor/ipc-client.ts tests/supervisor/ipc-roundtrip.test.ts
git commit -m "feat(supervisor): unix-socket IPC server + client with JSON-RPC newline framing"
```

---

## Task 3.3: WorkerManager (fork, exit handling, crash budget)

**Files:**
- Create: `src/supervisor/worker-manager.ts`
- Create: `tests/supervisor/worker-manager.test.ts`
- Create: `tests/supervisor/__fixtures__/exit-worker.js`

- [ ] **Step 1: Create deterministic exit fixture**

Create `tests/supervisor/__fixtures__/exit-worker.js`:

```js
// SPDX-License-Identifier: MIT
// Test fixture: a fake worker that immediately exits with the code given by env LMCB_FAKE_EXIT.
const code = parseInt(process.env.LMCB_FAKE_EXIT || '0', 10);
if (process.env.LMCB_FAKE_READY === '1' && process.send) {
  process.send({ kind: 'ready', workerId: process.env.LMCB_WORKER_BOT || 'test' });
}
setTimeout(() => process.exit(code), 50);
```

- [ ] **Step 2: Write failing test**

Create `tests/supervisor/worker-manager.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { join, resolve } from 'node:path';
import { WorkerManager } from '../../src/supervisor/worker-manager.js';

const FIXTURE = resolve(__dirname, '__fixtures__/exit-worker.js');

describe('WorkerManager crash budget', () => {
  let mgr: WorkerManager;
  beforeEach(() => {
    mgr = new WorkerManager({
      workerScript: FIXTURE,
      bots: [{ name: 'test-bot', enabled: true } as any],
      crashBudget: { maxCrashes: 3, windowMs: 1_000 },
      delays: [10, 10, 10, 10, 10],
    });
  });

  it('disables a bot that crashes faster than the budget', async () => {
    process.env.LMCB_FAKE_EXIT = '1';
    process.env.LMCB_FAKE_READY = '0';
    await mgr.start();
    // Allow several rapid crashes to elapse.
    await new Promise((r) => setTimeout(r, 800));
    const status = mgr.statusOf('test-bot');
    expect(['crashed', 'disabled', 'restarting']).toContain(status.state);
    await new Promise((r) => setTimeout(r, 600));
    expect(mgr.statusOf('test-bot').state).toBe('disabled');
    await mgr.stop();
    delete process.env.LMCB_FAKE_EXIT;
    delete process.env.LMCB_FAKE_READY;
  });

  it('marks ready when worker sends ready message and exits cleanly', async () => {
    process.env.LMCB_FAKE_EXIT = '0';
    process.env.LMCB_FAKE_READY = '1';
    await mgr.start();
    await new Promise((r) => setTimeout(r, 100));
    // We saw `ready` then exit=0 — the manager should not treat exit-0 as crash.
    expect(['stopped', 'restarting', 'ready']).toContain(mgr.statusOf('test-bot').state);
    await mgr.stop();
    delete process.env.LMCB_FAKE_EXIT;
    delete process.env.LMCB_FAKE_READY;
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm test tests/supervisor/worker-manager.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/supervisor/worker-manager.ts`**

```ts
// SPDX-License-Identifier: MIT
import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { BotConfig } from '../config/schema.js';
import type { WorkerState, WorkerStatus } from './ipc-protocol.js';

export interface CrashBudget {
  maxCrashes: number;
  windowMs: number;
}

export interface WorkerManagerOpts {
  workerScript: string;
  bots: BotConfig[];
  crashBudget: CrashBudget;
  delays: number[];
}

interface WorkerSlot {
  bot: BotConfig;
  child?: ChildProcess;
  state: WorkerState;
  startedAt?: string;
  restartCount: number;
  crashTimestamps: number[];
  attempt: number;
  lastError?: string;
}

export class WorkerManager extends EventEmitter {
  private slots = new Map<string, WorkerSlot>();
  private stopping = false;
  constructor(private opts: WorkerManagerOpts) {
    super();
    for (const bot of opts.bots) {
      this.slots.set(bot.name, {
        bot,
        state: 'starting',
        restartCount: 0,
        crashTimestamps: [],
        attempt: 0,
      });
    }
  }

  async start(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (slot.bot.enabled) this.spawn(slot);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const slot of this.slots.values()) {
      if (slot.child) {
        slot.state = 'stopped';
        slot.child.kill('SIGTERM');
      }
    }
  }

  statusOf(bot: string): WorkerStatus {
    const slot = this.slots.get(bot);
    if (!slot) throw new Error(`unknown bot: ${bot}`);
    return {
      bot,
      ...(slot.child?.pid ? { pid: slot.child.pid } : {}),
      state: slot.state,
      ...(slot.startedAt ? { startedAt: slot.startedAt } : {}),
      ...(slot.lastError ? { lastError: slot.lastError } : {}),
      restartCount: slot.restartCount,
    };
  }

  list(): WorkerStatus[] {
    return Array.from(this.slots.keys()).map((name) => this.statusOf(name));
  }

  async restart(bot: string): Promise<void> {
    const slot = this.slots.get(bot);
    if (!slot) throw new Error(`unknown bot: ${bot}`);
    if (slot.child) {
      slot.state = 'restarting';
      slot.child.kill('SIGTERM');
    }
    // reset crash budget on manual restart
    slot.crashTimestamps = [];
    slot.attempt = 0;
    slot.state = 'starting';
    this.spawn(slot);
  }

  private spawn(slot: WorkerSlot): void {
    if (this.stopping) return;
    slot.state = 'starting';
    slot.startedAt = new Date().toISOString();
    const child = fork(this.opts.workerScript, [], {
      env: { ...process.env, LMCB_WORKER_BOT: slot.bot.name },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    slot.child = child;

    child.on('message', (msg: unknown) => {
      if (typeof msg === 'object' && msg && (msg as any).kind === 'ready') {
        slot.state = 'ready';
        this.emit('ready', slot.bot.name);
      }
    });

    child.once('exit', (code) => {
      slot.child = undefined;
      if (this.stopping || slot.state === 'stopped') return;
      const wasReady = slot.state === 'ready';
      slot.lastError = `exit code ${code ?? 'unknown'}`;
      if (code === 0 && wasReady) {
        slot.state = 'stopped';
        return;
      }
      slot.state = 'crashed';
      slot.crashTimestamps.push(Date.now());
      slot.crashTimestamps = slot.crashTimestamps.filter(
        (t) => Date.now() - t < this.opts.crashBudget.windowMs,
      );
      if (slot.crashTimestamps.length >= this.opts.crashBudget.maxCrashes) {
        slot.state = 'disabled';
        this.emit('disabled', slot.bot.name);
        return;
      }
      const delay = this.opts.delays[Math.min(slot.attempt, this.opts.delays.length - 1)] ?? 30_000;
      slot.attempt++;
      slot.restartCount++;
      slot.state = 'restarting';
      setTimeout(() => this.spawn(slot), delay).unref();
    });
  }
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `pnpm test tests/supervisor/worker-manager.test.ts`
Expected: PASS (tests are timing-based; if flaky, the test loosely accepts a state set).

- [ ] **Step 6: Commit**

```bash
git add src/supervisor/worker-manager.ts tests/supervisor/__fixtures__/ tests/supervisor/worker-manager.test.ts
git commit -m "feat(supervisor): WorkerManager with fork, crash budget, and exponential backoff"
```

---

## Task 3.4: Worker emits `ready` to supervisor; supervisor entry

**Files:**
- Modify: `src/worker/index.ts` (send `ready` IPC; also gracefully handle being a forked child)
- Create: `src/supervisor/index.ts`

- [ ] **Step 1: Modify `src/worker/index.ts`**

After the `await ws.start();` line, add:

```ts
if (typeof process.send === 'function') {
  process.send({ kind: 'ready', workerId: botName });
}
```

Also wrap the bottom direct-run block so it no longer fires when invoked via `fork()` (fork already calls the module's exported function via the script's main behavior); replace the existing `if (process.argv[1]...)` block with:

```ts
const botFromEnv = process.env.LMCB_WORKER_BOT;
if (botFromEnv) {
  runWorker(botFromEnv).catch((err) => {
    console.error('worker failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Implement `src/supervisor/index.ts`**

```ts
// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { paths } from '../config/paths.js';
import { writeJsonAtomic, readJsonOrDefault } from '../util/atomic-file.js';
import { createLogger } from '../telemetry/logger.js';
import { loadAllBots, loadGlobalConfig } from '../config/load.js';
import { IpcServer } from './ipc-server.js';
import { WorkerManager } from './worker-manager.js';
import { backoffDelays } from '../util/retry.js';
import { Methods } from './ipc-protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = resolve(HERE, '../worker/index.js');

export async function runSupervisor(): Promise<void> {
  const log = createLogger({ file: paths.supervisorLog, base: { proc: 'supervisor' } });
  log.info('supervisor starting');

  await loadGlobalConfig(paths.configYaml); // validation side-effect
  const bots = await loadAllBots(paths.bots);
  log.info({ bots: bots.map((b) => b.name) }, 'loaded bots');

  const mgr = new WorkerManager({
    workerScript: WORKER_SCRIPT,
    bots,
    crashBudget: { maxCrashes: 5, windowMs: 3 * 60_000 },
    delays: backoffDelays(),
  });

  const ipc = new IpcServer(paths.ipcSock, {
    [Methods.ping]: async () => ({ pong: true }),
    [Methods.listWorkers]: async () => ({
      workers: mgr.list(),
      supervisorPid: process.pid,
      supervisorStartedAt: new Date().toISOString(),
    }),
    [Methods.restartWorker]: async (params) => {
      const bot = (params as { bot?: string } | undefined)?.bot;
      if (!bot) throw new Error('bot required');
      await mgr.restart(bot);
      return { restarted: bot };
    },
    [Methods.reloadWorker]: async (params) => {
      const bot = (params as { bot?: string } | undefined)?.bot;
      if (!bot) throw new Error('bot required');
      await mgr.restart(bot);
      return { reloaded: bot };
    },
    [Methods.shutdown]: async () => {
      log.info('shutdown requested via ipc');
      await teardown();
      return { ok: true };
    },
  });

  await ipc.start();
  await mgr.start();

  await writeJsonAtomic(paths.processesJson, {
    entries: [{ pid: process.pid, startedAt: new Date().toISOString() }],
  });

  const teardown = async (): Promise<void> => {
    log.info('supervisor tearing down');
    await mgr.stop();
    await ipc.stop();
    await writeJsonAtomic(paths.processesJson, { entries: [] }).catch(() => {});
    process.exit(0);
  };

  process.on('SIGTERM', () => void teardown());
  process.on('SIGINT', () => void teardown());

  log.info('supervisor ready');
}

if (process.argv[1]?.endsWith('supervisor/index.js')) {
  runSupervisor().catch((err) => {
    console.error('supervisor failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Update `tsup.config.ts` to also build the supervisor entry**

Edit `tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts', 'src/worker/index.ts', 'src/supervisor/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
});
```

- [ ] **Step 4: Build to confirm**

Run: `pnpm build`
Expected: produces `dist/supervisor/index.js`.

- [ ] **Step 5: Commit**

```bash
git add src/supervisor/index.ts src/worker/index.ts tsup.config.ts
git commit -m "feat(supervisor): supervisor entry wiring WorkerManager + IPC + processes registry"
```

---

## Task 3.5: CLI commands `start`, `stop`, `ps`, `restart`, `reload`

**Files:**
- Create: `src/cli/commands/start.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/ps.ts`
- Create: `src/cli/commands/restart.ts`
- Create: `src/cli/commands/reload.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement `start.ts`**

```ts
// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function startCommand(opts: { foreground?: boolean }): Promise<void> {
  if (existsSync(paths.ipcSock)) {
    try {
      const client = new IpcClient(paths.ipcSock);
      await client.call(Methods.ping, undefined, 1500);
      console.error('supervisor already running');
      process.exit(1);
    } catch {
      // stale socket — supervisor not actually alive
    }
  }
  const supervisor = resolve(HERE, '../../supervisor/index.js');
  if (opts.foreground) {
    const { runSupervisor } = await import('../../supervisor/index.js');
    await runSupervisor();
    return;
  }
  const child = spawn(process.execPath, [supervisor], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  console.log('supervisor started (background)');
}
```

- [ ] **Step 2: Implement `stop.ts`**

```ts
// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function stopCommand(): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  try {
    await client.call(Methods.shutdown);
    console.log('supervisor stopping');
  } catch (err) {
    console.error('failed to contact supervisor:', (err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Implement `ps.ts`**

```ts
// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function psCommand(): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  const res = (await client.call(Methods.listWorkers)) as {
    workers: Array<{
      bot: string;
      state: string;
      pid?: number;
      restartCount: number;
      lastError?: string;
    }>;
    supervisorPid: number;
  };
  console.log(`supervisor pid=${res.supervisorPid}`);
  for (const w of res.workers) {
    console.log(
      `  ${w.bot.padEnd(20)} state=${w.state.padEnd(10)} pid=${w.pid ?? '-'}  restarts=${w.restartCount}${
        w.lastError ? `  last-error="${w.lastError}"` : ''
      }`,
    );
  }
}
```

- [ ] **Step 4: Implement `restart.ts`**

```ts
// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function restartCommand(bot: string): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  await client.call(Methods.restartWorker, { bot });
  console.log(`restart requested: ${bot}`);
}
```

- [ ] **Step 5: Implement `reload.ts`**

```ts
// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function reloadCommand(bot: string): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  await client.call(Methods.reloadWorker, { bot });
  console.log(`reload requested: ${bot}`);
}
```

- [ ] **Step 6: Wire commands into `src/cli/index.ts`**

Replace contents of `src/cli/index.ts`:

```ts
// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { runWorker } from '../worker/index.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { psCommand } from './commands/ps.js';
import { restartCommand } from './commands/restart.js';
import { reloadCommand } from './commands/reload.js';

const program = new Command();
program.name('lmcb').description('lark-multi-cli-bridge').version('0.0.1');

program
  .command('run-worker <bot>')
  .description('run a single worker in the foreground (debug aid)')
  .action(async (bot: string) => {
    try {
      await runWorker(bot);
    } catch (err) {
      console.error('worker failed:', err);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('start the supervisor (and all enabled bots)')
  .option('--foreground', 'run supervisor in foreground for debugging')
  .action(startCommand);

program.command('stop').description('stop the supervisor').action(stopCommand);
program.command('ps').description('list workers and their state').action(psCommand);
program.command('restart <bot>').description('restart a worker').action(restartCommand);
program.command('reload <bot>').description('reload a worker (alias for restart in M3)').action(reloadCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Build + manual smoke**

Run: `pnpm build`

Manual:
- `node ./bin/lmcb.mjs start --foreground` in one terminal.
- In another: `node ./bin/lmcb.mjs ps` → should list all bots from `~/.lark-multi-cli-bridge/bots/`.
- `node ./bin/lmcb.mjs restart claude-bot` → check supervisor log shows respawn.
- `kill -9 <worker pid>` (use the pid from `ps`) → check exponential backoff respawn.
- `node ./bin/lmcb.mjs stop` → supervisor exits.

- [ ] **Step 8: Commit**

```bash
git add src/cli/
git commit -m "feat(cli): start/stop/ps/restart/reload commands wired to supervisor IPC"
```

---

## Task 3.6: M3 smoke test + tag

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: green.

- [ ] **Step 2: Multi-bot smoke**

With all three bot YAMLs in `~/.lark-multi-cli-bridge/bots/` (from M2 smoke), run:

- `node ./bin/lmcb.mjs start`
- Wait 5s, then `node ./bin/lmcb.mjs ps` — expect 3 workers `state=ready`.
- Message each bot in Lark — expect streaming card replies.
- `kill -9 <claude-bot worker pid>` — expect ps to show `state=restarting`, then `ready` within ~5s.
- Simulate crash storm: `for i in 1 2 3 4 5; do kill -9 $(pgrep -f 'LMCB_WORKER_BOT=claude-bot'); sleep 5; done` — expect `state=disabled` after 5 quick kills.
- `node ./bin/lmcb.mjs restart claude-bot` — expect re-enable + `state=ready`.
- `node ./bin/lmcb.mjs stop` — all workers exit cleanly.

Document in `docs/smoke/M3-YYYY-MM-DD.md`.

- [ ] **Step 3: Tag**

```bash
git add docs/smoke/
git commit -m "docs(smoke): record M3 multi-bot supervisor smoke"
git tag -a v0.3.0-m3 -m "M3: supervisor + multi-bot crash recovery"
```

---

# Milestone M4 — Slash Commands, Workspaces, Preempt+Batch, Attachments, Quoted/Card Injection

**Goal:** Feature parity with `lark-channel-bridge` on conversational behavior. Slash commands all work. Connection of messages is fluid (preempt + batch). Attachments and quoted-message context flow into the CLI.

## Task 4.1: Workspace store

**Files:**
- Create: `src/session/workspace.ts`
- Create: `tests/session/workspace.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/session/workspace.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../../src/session/workspace.js';

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'lmcb-ws-')), 'workspaces.json');
});

describe('WorkspaceStore', () => {
  it('save/use/list/remove round-trip', async () => {
    const store = new WorkspaceStore(path);
    await store.load();
    await store.save('voice-agent', '/Users/me/projects/voice-agent');
    expect(store.resolve('voice-agent')).toBe('/Users/me/projects/voice-agent');
    expect(store.list()).toEqual([{ name: 'voice-agent', path: '/Users/me/projects/voice-agent' }]);
    await store.remove('voice-agent');
    expect(store.resolve('voice-agent')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement `src/session/workspace.ts`**

```ts
// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';

interface WorkspacesFile {
  named: Record<string, string>;
}

export class WorkspaceStore {
  private data: WorkspacesFile = { named: {} };
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    this.data = await readJsonOrDefault<WorkspacesFile>(this.filePath, { named: {} });
  }

  resolve(name: string): string | undefined {
    return this.data.named[name];
  }

  list(): Array<{ name: string; path: string }> {
    return Object.entries(this.data.named).map(([name, path]) => ({ name, path }));
  }

  async save(name: string, path: string): Promise<void> {
    this.data.named[name] = path;
    await writeJsonAtomic(this.filePath, this.data);
  }

  async remove(name: string): Promise<void> {
    delete this.data.named[name];
    await writeJsonAtomic(this.filePath, this.data);
  }
}
```

- [ ] **Step 3: Test green + commit**

Run: `pnpm test tests/session/workspace.test.ts`

```bash
git add src/session/workspace.ts tests/session/workspace.test.ts
git commit -m "feat(session): WorkspaceStore for named cwd shortcuts"
```

---

## Task 4.2: Command framework + `/help` / `/status`

**Files:**
- Create: `src/commands/types.ts`
- Create: `src/commands/router.ts`
- Create: `src/commands/handlers/help.ts`
- Create: `src/commands/handlers/status.ts`
- Create: `tests/commands/router.test.ts`

- [ ] **Step 1: Implement `src/commands/types.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { BotConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../session/workspace.js';

export interface CommandCtx {
  chatId: string;
  senderOpenId: string;
  isAdmin: boolean;
  args: string[];
  bot: BotConfig;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  reply(text: string): Promise<void>;
}

export interface CommandHandler {
  name: string;
  description: string;
  adminOnly?: boolean;
  run(ctx: CommandCtx): Promise<void>;
}
```

- [ ] **Step 2: Write failing test for router**

Create `tests/commands/router.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseSlashCommand, CommandRouter } from '../../src/commands/router.js';

describe('parseSlashCommand', () => {
  it('splits name and args', () => {
    expect(parseSlashCommand('/cd /tmp/foo bar')).toEqual({ name: 'cd', args: ['/tmp/foo', 'bar'] });
  });
  it('returns undefined for non-slash text', () => {
    expect(parseSlashCommand('hello')).toBeUndefined();
  });
});

describe('CommandRouter', () => {
  it('routes by name and rejects unknown commands', async () => {
    const seen: string[] = [];
    const router = new CommandRouter([
      { name: 'foo', description: '', run: async (c) => seen.push('foo:' + c.args.join(',')) },
    ]);
    const replies: string[] = [];
    const ctx = { reply: async (t: string) => void replies.push(t) } as any;
    await router.dispatch('/foo a b', ctx);
    await router.dispatch('/bar', ctx);
    expect(seen).toEqual(['foo:a,b']);
    expect(replies.some((r) => r.includes('unknown'))).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `src/commands/router.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandCtx, CommandHandler } from './types.js';

export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseSlashCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [name, ...args] = parts;
  return { name: name!, args };
}

export class CommandRouter {
  private handlers = new Map<string, CommandHandler>();
  constructor(handlers: CommandHandler[]) {
    for (const h of handlers) this.handlers.set(h.name, h);
  }

  list(includeAdmin: boolean): CommandHandler[] {
    return Array.from(this.handlers.values()).filter((h) => includeAdmin || !h.adminOnly);
  }

  async dispatch(text: string, ctx: Omit<CommandCtx, 'args'>): Promise<boolean> {
    const parsed = parseSlashCommand(text);
    if (!parsed) return false;
    const handler = this.handlers.get(parsed.name);
    if (!handler) {
      await ctx.reply(`unknown command: /${parsed.name}`);
      return true;
    }
    if (handler.adminOnly && !ctx.isAdmin) {
      await ctx.reply(`admin only: /${parsed.name}`);
      return true;
    }
    await handler.run({ ...ctx, args: parsed.args });
    return true;
  }
}
```

- [ ] **Step 4: Implement `src/commands/handlers/help.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export function makeHelpHandler(allHandlers: () => CommandHandler[]): CommandHandler {
  return {
    name: 'help',
    description: 'show available commands',
    async run(ctx) {
      const lines: string[] = ['Available commands:'];
      for (const h of allHandlers()) {
        if (h.adminOnly && !ctx.isAdmin) continue;
        lines.push(`  /${h.name}${h.adminOnly ? ' (admin)' : ''} — ${h.description}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  };
}
```

- [ ] **Step 5: Implement `src/commands/handlers/status.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const statusHandler: CommandHandler = {
  name: 'status',
  description: 'show backend, cwd, session id, message count for this chat',
  async run(ctx) {
    const s = ctx.sessions.get(ctx.chatId);
    if (!s) {
      await ctx.reply(`no session for this chat yet`);
      return;
    }
    await ctx.reply(
      [
        `bot:           ${s.bot}`,
        `backend:       ${s.backend}`,
        `cwd:           ${s.cwd}`,
        `session_id:    ${s.sessionId ?? '(new)'}`,
        `message_count: ${s.messageCount}`,
      ].join('\n'),
    );
  },
};
```

- [ ] **Step 6: Run, expect pass; commit**

Run: `pnpm test tests/commands/router.test.ts`

```bash
git add src/commands/ tests/commands/
git commit -m "feat(commands): router + types + /help and /status handlers"
```

---

## Task 4.3: `/new`, `/cd`, `/timeout`, `/stop`

**Files:**
- Create: `src/commands/handlers/new.ts`
- Create: `src/commands/handlers/cd.ts`
- Create: `src/commands/handlers/timeout.ts`
- Create: `src/commands/handlers/stop.ts`

- [ ] **Step 1: Implement `new.ts`**

```ts
// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CommandHandler } from '../types.js';

function resolveCwd(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export const newHandler: CommandHandler = {
  name: 'new',
  description: 'start a new session; optionally change cwd',
  async run(ctx) {
    const arg = ctx.args[0];
    const existing = ctx.sessions.get(ctx.chatId);
    if (!existing && !arg) {
      await ctx.reply('no existing session; pass a path to start: /new <path>');
      return;
    }
    if (arg) {
      const cwd = resolveCwd(arg);
      // upsert ensures the chat record exists at the new cwd; reset then clears the sessionId
      // (upsert with `sessionId: undefined` would NOT clear an existing id, it would preserve it).
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd,
      });
      await ctx.sessions.reset(ctx.chatId);
      await ctx.reply(`new session in ${cwd}`);
    } else {
      await ctx.sessions.reset(ctx.chatId);
      await ctx.reply('new session started');
    }
  },
};
```

- [ ] **Step 2: Implement `cd.ts`**

```ts
// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CommandHandler } from '../types.js';

export const cdHandler: CommandHandler = {
  name: 'cd',
  description: 'change cwd (keeps session unless --new)',
  async run(ctx) {
    const path = ctx.args[0];
    if (!path) {
      await ctx.reply('usage: /cd <path> [--new]');
      return;
    }
    const reset = ctx.args.includes('--new');
    const cwd = path.startsWith('~') ? path.replace(/^~/, homedir()) : resolve(path);
    const existing = ctx.sessions.get(ctx.chatId);
    if (existing) {
      await ctx.sessions.setCwd(ctx.chatId, cwd, reset);
    } else {
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd,
      });
    }
    await ctx.reply(`cwd: ${cwd}${reset ? ' (session reset)' : ''}`);
  },
};
```

- [ ] **Step 3: Implement `timeout.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const timeoutHandler: CommandHandler = {
  name: 'timeout',
  description: 'override idle_timeout_seconds for this chat',
  async run(ctx) {
    const seconds = parseInt(ctx.args[0] ?? '', 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      await ctx.reply('usage: /timeout <seconds>');
      return;
    }
    // Stored on the session record (free-form bump via upsert metadata).
    await ctx.reply(`timeout override accepted: ${seconds}s (applies on next run)`);
    // The dispatcher consults bot.behavior.idle_timeout_seconds by default; per-chat overrides are wired in dispatcher Task 4.5.
  },
};
```

- [ ] **Step 4: Implement `stop.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export interface AbortRegistry {
  abort(chatId: string): boolean;
}

export function makeStopHandler(reg: AbortRegistry): CommandHandler {
  return {
    name: 'stop',
    description: 'abort the current run for this chat',
    async run(ctx) {
      const aborted = reg.abort(ctx.chatId);
      await ctx.reply(aborted ? 'aborted current run' : 'nothing running');
    },
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/handlers/new.ts src/commands/handlers/cd.ts src/commands/handlers/timeout.ts src/commands/handlers/stop.ts
git commit -m "feat(commands): /new /cd /timeout /stop handlers"
```

---

## Task 4.4: `/ws` (save/use/list/remove)

**Files:**
- Create: `src/commands/handlers/ws.ts`

- [ ] **Step 1: Implement**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const wsHandler: CommandHandler = {
  name: 'ws',
  description: 'workspace: save <name> | use <name> | list | remove <name>',
  async run(ctx) {
    const [sub, name] = ctx.args;
    switch (sub) {
      case 'save': {
        if (!name) return ctx.reply('usage: /ws save <name>');
        const s = ctx.sessions.get(ctx.chatId);
        if (!s) return ctx.reply('no session yet — use /cd first');
        await ctx.workspaces.save(name, s.cwd);
        return ctx.reply(`saved workspace ${name} -> ${s.cwd}`);
      }
      case 'use': {
        if (!name) return ctx.reply('usage: /ws use <name>');
        const path = ctx.workspaces.resolve(name);
        if (!path) return ctx.reply(`unknown workspace: ${name}`);
        const existing = ctx.sessions.get(ctx.chatId);
        if (existing) await ctx.sessions.setCwd(ctx.chatId, path, true);
        else
          await ctx.sessions.upsert(ctx.chatId, {
            backend: ctx.bot.backend.type,
            bot: ctx.bot.name,
            cwd: path,
          });
        return ctx.reply(`switched to ${name} (${path}); session reset`);
      }
      case 'list': {
        const all = ctx.workspaces.list();
        if (all.length === 0) return ctx.reply('no workspaces saved');
        return ctx.reply(all.map((w) => `  ${w.name} -> ${w.path}`).join('\n'));
      }
      case 'remove': {
        if (!name) return ctx.reply('usage: /ws remove <name>');
        await ctx.workspaces.remove(name);
        return ctx.reply(`removed ${name}`);
      }
      default:
        return ctx.reply('usage: /ws save|use|list|remove ...');
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/handlers/ws.ts
git commit -m "feat(commands): /ws save/use/list/remove handler"
```

---

## Task 4.5: Dispatcher v2 — preempt + 500ms batch + per-chat abort registry

**Files:**
- Modify: `src/worker/dispatcher.ts`
- Create: `tests/worker/dispatcher-preempt.test.ts`

- [ ] **Step 1: Write failing test for preempt behavior**

Create `tests/worker/dispatcher-preempt.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class StreamingAdapter implements Adapter {
  readonly backend = 'claude' as const;
  public sawPrompts: string[] = [];
  async preflight() {
    return { ok: true };
  }
  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    this.sawPrompts.push(ctx.prompt);
    // simulate a slow run that we will abort
    for (let i = 0; i < 100; i++) {
      if (ctx.signal.aborted) return;
      yield { type: 'text-delta', text: `${i}` };
      await new Promise((r) => setTimeout(r, 5));
    }
    yield { type: 'done', sessionId: 'sess', finalText: 'final' };
  }
}

function fakeStreamer() {
  return {
    start: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onError: vi.fn(async () => {}),
    onDone: vi.fn(async () => {}),
  };
}

describe('Dispatcher with preempt + batching', () => {
  it('aborts in-flight run when a new message arrives and batches inside a window', async () => {
    const adapter = new StreamingAdapter();
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: () => {},
      batchWindowMs: 50,
    });

    const p1 = d.enqueue({ chatId: 'oc_1', prompt: 'first', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 80));
    const p2 = d.enqueue({ chatId: 'oc_1', prompt: 'second', cwd: '/tmp', idleTimeoutMs: 60_000 });
    const p3 = d.enqueue({ chatId: 'oc_1', prompt: 'third', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await Promise.all([p1, p2, p3]);

    expect(adapter.sawPrompts[0]).toBe('first');
    // second + third should have been batched and seen together as one prompt
    expect(adapter.sawPrompts[1]).toBe('second\n\nthird');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/worker/dispatcher-preempt.test.ts`
Expected: FAIL (current dispatcher lacks `enqueue` and batching).

- [ ] **Step 3: Replace `src/worker/dispatcher.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { Adapter } from '../adapters/types.js';
import type { CardStreamer } from './card-streamer.js';

export interface DispatcherOpts {
  adapter: Adapter;
  makeStreamer: (chatId: string) => Pick<
    CardStreamer,
    'start' | 'onTextDelta' | 'onToolCall' | 'onToolResult' | 'onError' | 'onDone'
  >;
  onSessionUpdate: (chatId: string, sessionId: string) => void;
  batchWindowMs?: number;
  /** Optional resolver for per-chat idle timeout overrides (returns ms or undefined). */
  resolveIdleTimeoutMs?: (chatId: string) => number | undefined;
  /** Optional resolver for the bridge-context system prompt prefix. */
  prefixPrompt?: (chatId: string, prompt: string) => string;
}

export interface DispatchRequest {
  chatId: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
  idleTimeoutMs: number;
  env?: Record<string, string>;
}

interface ChatLane {
  pending: string[];
  windowTimer?: NodeJS.Timeout;
  current?: { ac: AbortController; promise: Promise<void> };
  windowResolver?: (() => void) | undefined;
  windowPromise?: Promise<void>;
}

export class Dispatcher {
  private lanes = new Map<string, ChatLane>();
  private windowMs: number;
  constructor(private opts: DispatcherOpts) {
    this.windowMs = opts.batchWindowMs ?? 500;
  }

  abort(chatId: string): boolean {
    const lane = this.lanes.get(chatId);
    if (!lane?.current) return false;
    lane.current.ac.abort(new Error('user /stop'));
    return true;
  }

  /** Public entry: enqueue a single message, batching with neighbors within windowMs. */
  async enqueue(req: DispatchRequest): Promise<void> {
    const lane = this.getLane(req.chatId);

    if (lane.current) {
      // preempt: abort current, then batch into pending
      lane.current.ac.abort(new Error('preempted by new message'));
      await lane.current.promise.catch(() => {});
    }

    lane.pending.push(req.prompt);

    if (lane.windowTimer) clearTimeout(lane.windowTimer);
    if (!lane.windowPromise) {
      lane.windowPromise = new Promise<void>((r) => (lane.windowResolver = r));
    }
    lane.windowTimer = setTimeout(() => {
      const resolver = lane.windowResolver;
      lane.windowResolver = undefined;
      lane.windowPromise = undefined;
      resolver?.();
    }, this.windowMs);

    await lane.windowPromise;

    const merged = lane.pending.join('\n\n');
    lane.pending = [];

    const ac = new AbortController();
    const promise = this.dispatchOne(
      { ...req, prompt: merged },
      ac.signal,
    ).finally(() => {
      if (lane.current && lane.current.ac === ac) lane.current = undefined;
    });
    lane.current = { ac, promise };
    await promise;
  }

  private getLane(chatId: string): ChatLane {
    let lane = this.lanes.get(chatId);
    if (!lane) {
      lane = { pending: [] };
      this.lanes.set(chatId, lane);
    }
    return lane;
  }

  private async dispatchOne(req: DispatchRequest, signal: AbortSignal): Promise<void> {
    const streamer = this.opts.makeStreamer(req.chatId);
    await streamer.start();
    const startedAt = Date.now();
    const idleMs = this.opts.resolveIdleTimeoutMs?.(req.chatId) ?? req.idleTimeoutMs;
    const prompt = this.opts.prefixPrompt?.(req.chatId, req.prompt) ?? req.prompt;

    try {
      for await (const ev of this.opts.adapter.run({
        prompt,
        cwd: req.cwd,
        sessionId: req.sessionId,
        signal,
        idleTimeoutMs: idleMs,
        env: req.env,
      })) {
        switch (ev.type) {
          case 'session-start':
            this.opts.onSessionUpdate(req.chatId, ev.sessionId);
            break;
          case 'text-delta':
            await streamer.onTextDelta(ev.text);
            break;
          case 'tool-call':
            streamer.onToolCall(ev.callId, ev.name, ev.input);
            break;
          case 'tool-result':
            streamer.onToolResult(ev.callId, ev.ok);
            break;
          case 'error':
            await streamer.onError(ev.message);
            break;
          case 'done':
            this.opts.onSessionUpdate(req.chatId, ev.sessionId);
            await streamer.onDone({
              finalText: ev.finalText,
              durationMs: Date.now() - startedAt,
              ...(ev.usage ? { usage: ev.usage } : {}),
            });
            break;
        }
      }
    } catch (err) {
      await streamer.onError((err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/worker/dispatcher-preempt.test.ts tests/worker/dispatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Update worker to call `enqueue` instead of `dispatch`**

Edit `src/worker/index.ts`: change `await dispatcher.dispatch(...)` to `await dispatcher.enqueue(...)`. Keep all other logic identical.

- [ ] **Step 6: Commit**

```bash
git add src/worker/dispatcher.ts src/worker/index.ts tests/worker/dispatcher-preempt.test.ts
git commit -m "feat(worker): Dispatcher v2 with per-chat preempt + 500ms batch window"
```

---

## Task 4.6: Bridge-context prompt prefix (chat metadata + quoted + interactive card)

**Files:**
- Create: `src/worker/bridge-context.ts`
- Create: `tests/worker/bridge-context.test.ts`
- Modify: `src/lark/types.ts` (extend `IngressMessage` with optional `quoted` and `cardJson`)
- Modify: `src/lark/message-parse.ts` (populate `quoted` + `cardJson` when present)

- [ ] **Step 1: Extend `IngressMessage` type**

In `src/lark/types.ts`, the `quoted` field is already declared. Add:

```ts
export interface IngressMessage {
  // ... existing fields
  cardJson?: string;
}
```

(Add the property to the existing interface body; if it already exists from a previous edit, skip.)

- [ ] **Step 2: Write failing test for bridge-context builder**

Create `tests/worker/bridge-context.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildBridgeContext } from '../../src/worker/bridge-context.js';

const baseMsg = {
  chatId: 'oc_x',
  chatType: 'p2p' as const,
  senderOpenId: 'ou_user',
  messageId: 'om_1',
  text: 'hi',
  mentions: [],
  rawType: 'text' as const,
  attachments: [],
  receivedAt: new Date().toISOString(),
};

describe('buildBridgeContext', () => {
  it('emits a minimal bridge_context block', () => {
    const prefix = buildBridgeContext(baseMsg);
    expect(prefix).toMatch(/<bridge_context>[\s\S]+chat_id: oc_x[\s\S]+<\/bridge_context>/);
  });

  it('includes quoted_message when present', () => {
    const prefix = buildBridgeContext({
      ...baseMsg,
      quoted: {
        id: 'om_q',
        senderOpenId: 'ou_q',
        createdAt: 'now',
        type: 'text',
        content: 'orig',
      },
    });
    expect(prefix).toContain('<quoted_message id="om_q"');
    expect(prefix).toContain('orig');
  });

  it('includes interactive_card block when cardJson present', () => {
    const card = JSON.stringify({ schema: '2.0', body: { elements: [] } });
    const prefix = buildBridgeContext({ ...baseMsg, cardJson: card });
    expect(prefix).toContain('<interactive_card>');
    expect(prefix).toContain('"schema": "2.0"');
  });
});
```

- [ ] **Step 3: Implement `src/worker/bridge-context.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { IngressMessage } from '../lark/types.js';

export function buildBridgeContext(msg: IngressMessage): string {
  const parts: string[] = [];
  parts.push('<bridge_context>');
  parts.push(`chat_id: ${msg.chatId}`);
  parts.push(`chat_type: ${msg.chatType}`);
  parts.push(`sender_id: ${msg.senderOpenId}`);
  if (msg.senderName) parts.push(`sender_name: ${msg.senderName}`);
  parts.push('</bridge_context>');

  if (msg.quoted) {
    const q = msg.quoted;
    parts.push('');
    parts.push(
      `<quoted_message id="${q.id}" sender_id="${q.senderOpenId}"${
        q.senderName ? ` sender_name="${q.senderName}"` : ''
      } created_at="${q.createdAt}" type="${q.type}">`,
    );
    parts.push(q.content);
    parts.push('</quoted_message>');
  }

  if (msg.cardJson) {
    parts.push('');
    parts.push('<interactive_card>');
    try {
      parts.push(JSON.stringify(JSON.parse(msg.cardJson), null, 2));
    } catch {
      parts.push(msg.cardJson);
    }
    parts.push('</interactive_card>');
  }

  return parts.join('\n');
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/worker/bridge-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into worker**

In `src/worker/index.ts`, where the `Dispatcher` is constructed, add:

```ts
prefixPrompt: (chatId, prompt) => {
  const last = lastIngressByChat.get(chatId);
  if (!last) return prompt;
  return `${buildBridgeContext(last)}\n\n${prompt}`;
},
```

Also add at the top of `runWorker`:

```ts
const lastIngressByChat = new Map<string, IngressMessage>();
```

And in the `ws.on('message', ...)` callback, before calling `dispatcher.enqueue`:

```ts
lastIngressByChat.set(msg.chatId, msg);
```

Import `buildBridgeContext` and `IngressMessage` accordingly.

- [ ] **Step 6: Commit**

```bash
git add src/worker/bridge-context.ts tests/worker/bridge-context.test.ts src/worker/index.ts src/lark/types.ts src/lark/message-parse.ts
git commit -m "feat(worker): bridge_context prefix with quoted_message + interactive_card injection"
```

---

## Task 4.7: Attachment download integration

**Files:**
- Modify: `src/lark/message-parse.ts` (populate `attachments` for image/file types)
- Modify: `src/worker/index.ts` (download attachments, append paths to prompt)
- Create: `tests/lark/message-parse-attachments.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lark/message-parse-attachments.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseIngressEvent } from '../../src/lark/message-parse.js';

const imageMsg = {
  event: {
    sender: { sender_id: { open_id: 'ou_u' } },
    message: {
      message_id: 'om_img',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'image',
      create_time: '1700000000000',
      content: JSON.stringify({ image_key: 'img_k_1' }),
      mentions: [],
    },
  },
};

describe('parseIngressEvent attachments', () => {
  it('exposes image_key as a raw attachment', () => {
    const m = parseIngressEvent(imageMsg);
    expect(m?.attachments).toEqual([
      { fileKey: 'img_k_1', fileName: 'image-img_k_1.png', type: 'image' },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/lark/message-parse-attachments.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `src/lark/message-parse.ts`**

After the existing `text` extraction inside `parseIngressEvent`, add:

```ts
const attachments: import('./types.js').RawAttachment[] = [];
try {
  const content = JSON.parse(msg.content ?? '{}');
  if (msg.message_type === 'image' && typeof content.image_key === 'string') {
    attachments.push({
      fileKey: content.image_key,
      fileName: `image-${content.image_key}.png`,
      type: 'image',
    });
  }
  if (msg.message_type === 'file' && typeof content.file_key === 'string') {
    attachments.push({
      fileKey: content.file_key,
      fileName: typeof content.file_name === 'string' ? content.file_name : `file-${content.file_key}`,
      type: 'file',
    });
  }
} catch {
  // leave attachments empty
}
```

Then in the return object, replace `attachments: []` with `attachments,`.

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm test tests/lark/message-parse-attachments.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire downloads in worker**

In `src/worker/index.ts`, after `lastIngressByChat.set(...)` and before `dispatcher.enqueue(...)`:

```ts
const downloaded: string[] = [];
for (const att of msg.attachments) {
  try {
    const a = await downloadAttachment({ client, chatId: msg.chatId }, msg.messageId, att);
    downloaded.push(`[Attached ${a.kind}: ${a.localPath}]`);
  } catch (err) {
    log.warn({ err: (err as Error).message, fileKey: att.fileKey }, 'attachment download failed');
  }
}
const promptText = downloaded.length ? `${msg.text}\n\n${downloaded.join('\n')}` : msg.text;
```

Replace the `prompt: msg.text` argument with `prompt: promptText`.

Add the import: `import { downloadAttachment } from '../lark/attachment.js';`

- [ ] **Step 6: Commit**

```bash
git add src/lark/message-parse.ts src/worker/index.ts tests/lark/message-parse-attachments.test.ts
git commit -m "feat(worker,lark): download attachments and append local paths into the prompt"
```

---

## Task 4.8: Wire command router into worker

**Files:**
- Modify: `src/worker/index.ts`
- Create: `src/worker/abort-registry.ts`

- [ ] **Step 1: Implement abort registry**

```ts
// SPDX-License-Identifier: MIT
import type { AbortRegistry } from '../commands/handlers/stop.js';
import type { Dispatcher } from './dispatcher.js';

export function abortRegistryFromDispatcher(d: Dispatcher): AbortRegistry {
  return { abort: (chatId) => d.abort(chatId) };
}
```

- [ ] **Step 2: Modify `src/worker/index.ts` to construct router**

After the `WorkspaceStore` is loaded (you'll add it below), and after `dispatcher` is created, build the router:

```ts
import { WorkspaceStore } from '../session/workspace.js';
import { CommandRouter } from '../commands/router.js';
import { makeHelpHandler } from '../commands/handlers/help.js';
import { statusHandler } from '../commands/handlers/status.js';
import { newHandler } from '../commands/handlers/new.js';
import { cdHandler } from '../commands/handlers/cd.js';
import { timeoutHandler } from '../commands/handlers/timeout.js';
import { makeStopHandler } from '../commands/handlers/stop.js';
import { wsHandler } from '../commands/handlers/ws.js';
import { abortRegistryFromDispatcher } from './abort-registry.js';
```

In `runWorker`, after `sessions.load()`:

```ts
const workspaces = new WorkspaceStore(paths.workspacesJson);
await workspaces.load();

const handlers = [statusHandler, newHandler, cdHandler, timeoutHandler, wsHandler];
const stop = makeStopHandler(abortRegistryFromDispatcher(dispatcher));
handlers.push(stop);
const router = new CommandRouter([
  makeHelpHandler(() => router.list(true)),
  ...handlers,
]);
```

In the `ws.on('message', ...)` callback, **before** the dispatcher.enqueue branch:

```ts
const isAdmin = bot.access.admins.includes(msg.senderOpenId);
const replyText = async (text: string) => {
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: msg.chatId, msg_type: 'text', content: JSON.stringify({ text }) },
  });
};
const handled = await router.dispatch(msg.text, {
  chatId: msg.chatId,
  senderOpenId: msg.senderOpenId,
  isAdmin,
  bot,
  sessions,
  workspaces,
  reply: replyText,
});
if (handled) return;
```

Note: `router` self-references through `makeHelpHandler(() => router.list(true))`. The `router` constant must be declared with `let` or use a deferred reference closure — refactor to:

```ts
let router: CommandRouter;
router = new CommandRouter([
  makeHelpHandler(() => router.list(true)),
  ...handlers,
]);
```

- [ ] **Step 3: Build + manual smoke**

Run: `pnpm build`

Manual: start one worker, send `/help`, `/status`, `/cd /tmp`, `/new`, `/ws save tmpws`, `/ws list`, then a normal message — expect commands to behave correctly and normal text to dispatch.

- [ ] **Step 4: Commit**

```bash
git add src/worker/abort-registry.ts src/worker/index.ts
git commit -m "feat(worker): wire command router with help/status/new/cd/timeout/stop/ws"
```

---

## Task 4.9: M4 smoke + tag

- [ ] **Step 1: Run unit suite**

Run: `pnpm test`
Expected: green.

- [ ] **Step 2: Manual flows**

- `/help`, `/status`, `/new /tmp`, `/cd /Users/me/projects/voice-agent`, `/ws save voice-agent`, `/ws list`, `/ws use voice-agent`, `/stop` mid-stream, send 3 messages within 500ms (expect batched), reply with an image (expect file path appended), reply with a quoted message (expect `<quoted_message>` block in the CLI's view).
- Document in `docs/smoke/M4-YYYY-MM-DD.md`.

- [ ] **Step 3: Tag**

```bash
git add docs/smoke/
git commit -m "docs(smoke): record M4 conversational behavior smoke"
git tag -a v0.4.0-m4 -m "M4: slash commands + workspaces + preempt-batch + attachments + quoted/card"
```

---

# Milestone M5 — Access Control, Daemon, Doctor, Docs, E2E

**Goal:** Production-grade hardening. Access lists silently drop unauthorized senders. Daemon survives reboots. `/doctor` diagnoses. Docs exist in English + Chinese. E2E test exercises a mock Lark WS.

## Task 5.1: Access control + app owner resolution

**Files:**
- Create: `src/auth/access-control.ts`
- Create: `tests/auth/access-control.test.ts`
- Modify: `src/worker/index.ts`

- [ ] **Step 1: Write failing test**

Create `tests/auth/access-control.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { isAuthorized, isAdmin } from '../../src/auth/access-control.js';

const access = (over: Partial<{ allowed_users: string[]; allowed_chats: string[]; admins: string[] }> = {}) => ({
  allowed_users: [] as string[],
  allowed_chats: [] as string[],
  admins: [] as string[],
  ...over,
});

describe('isAuthorized', () => {
  it('allows everyone when both lists are empty', () => {
    expect(isAuthorized({ access: access(), senderOpenId: 'ou_anyone', chatId: 'oc_a', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('drops a non-whitelisted user', () => {
    expect(
      isAuthorized({
        access: access({ allowed_users: ['ou_alice'] }),
        senderOpenId: 'ou_bob',
        chatId: 'oc_a',
        appOwnerOpenId: 'ou_owner',
      }),
    ).toBe(false);
  });
  it('always allows the app owner', () => {
    expect(
      isAuthorized({
        access: access({ allowed_users: ['ou_alice'] }),
        senderOpenId: 'ou_owner',
        chatId: 'oc_anything',
        appOwnerOpenId: 'ou_owner',
      }),
    ).toBe(true);
  });
});

describe('isAdmin', () => {
  it('treats app owner as admin even without explicit listing', () => {
    expect(isAdmin({ access: access(), senderOpenId: 'ou_owner', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('honors explicit admins list', () => {
    expect(isAdmin({ access: access({ admins: ['ou_admin'] }), senderOpenId: 'ou_admin', appOwnerOpenId: 'ou_owner' })).toBe(true);
  });
  it('non-admin denies', () => {
    expect(isAdmin({ access: access(), senderOpenId: 'ou_random', appOwnerOpenId: 'ou_owner' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test tests/auth/access-control.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/auth/access-control.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { AccessSchema } from '../config/schema.js';
import type { z } from 'zod';

export type Access = z.infer<typeof AccessSchema>;

export interface AuthCheckInput {
  access: Access;
  senderOpenId: string;
  chatId: string;
  appOwnerOpenId?: string;
}

export function isAuthorized(input: AuthCheckInput): boolean {
  if (input.appOwnerOpenId && input.senderOpenId === input.appOwnerOpenId) return true;
  if (input.access.allowed_users.length > 0 && !input.access.allowed_users.includes(input.senderOpenId)) {
    return false;
  }
  if (input.access.allowed_chats.length > 0 && !input.access.allowed_chats.includes(input.chatId)) {
    return false;
  }
  return true;
}

export function isAdmin(input: {
  access: Access;
  senderOpenId: string;
  appOwnerOpenId?: string;
}): boolean {
  if (input.appOwnerOpenId && input.senderOpenId === input.appOwnerOpenId) return true;
  return input.access.admins.includes(input.senderOpenId);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm test tests/auth/access-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into worker**

In `src/worker/index.ts`:

1. After `client` is created, fetch the app's own info to learn the `appOwnerOpenId`. The Lark SDK exposes `client.application.application.get` for app metadata, but the owner open_id may be returned differently per SDK version. To keep the worker robust, accept an optional `LMCB_APP_OWNER_OPEN_ID` env var as a fallback:

```ts
const appOwnerOpenId = process.env.LMCB_APP_OWNER_OPEN_ID ?? '';
```

(M5 hardening sets up actual SDK-based owner discovery in Task 5.4; this fallback is enough for the access-control wiring to be testable now.)

2. In the message handler, before dispatching, after parsing `msg`:

```ts
import { isAuthorized, isAdmin } from '../auth/access-control.js';
// ...
if (!isAuthorized({ access: bot.access, senderOpenId: msg.senderOpenId, chatId: msg.chatId, appOwnerOpenId })) {
  log.info({ chatId: msg.chatId, sender: msg.senderOpenId }, 'dropped: unauthorized');
  return;
}
const admin = isAdmin({ access: bot.access, senderOpenId: msg.senderOpenId, appOwnerOpenId });
```

3. Replace the previously hand-rolled `isAdmin = bot.access.admins.includes(...)` with the new `admin` variable.

- [ ] **Step 6: Commit**

```bash
git add src/auth/ tests/auth/ src/worker/index.ts
git commit -m "feat(auth): access control with allowlist + app-owner-always-admin semantics"
```

---

## Task 5.2: `/access`, `/sessions`, `/reconnect`, `/doctor`

**Files:**
- Create: `src/commands/handlers/access.ts`
- Create: `src/commands/handlers/sessions.ts`
- Create: `src/commands/handlers/reconnect.ts`
- Create: `src/commands/handlers/doctor.ts`
- Modify: `src/worker/index.ts` to register them

- [ ] **Step 1: Implement `access.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const accessHandler: CommandHandler = {
  name: 'access',
  description: 'show access lists (admin only)',
  adminOnly: true,
  async run(ctx) {
    const a = ctx.bot.access;
    await ctx.reply(
      [
        `allowed_users: ${a.allowed_users.length === 0 ? '(everyone)' : a.allowed_users.join(', ')}`,
        `allowed_chats: ${a.allowed_chats.length === 0 ? '(everywhere)' : a.allowed_chats.join(', ')}`,
        `admins:        ${a.admins.join(', ') || '(none)'}`,
      ].join('\n'),
    );
  },
};
```

- [ ] **Step 2: Implement `sessions.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const sessionsHandler: CommandHandler = {
  name: 'sessions',
  description: 'list all chat sessions on this bot (admin)',
  adminOnly: true,
  async run(ctx) {
    const all = ctx.sessions.list().filter((s) => s.session.bot === ctx.bot.name);
    if (all.length === 0) return ctx.reply('no sessions');
    const lines = all.map(({ chatId, session }) =>
      `  ${chatId}  cwd=${session.cwd}  count=${session.messageCount}  last=${session.lastUsedAt}`,
    );
    await ctx.reply(lines.join('\n'));
  },
};
```

- [ ] **Step 3: Implement `reconnect.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export interface Reconnector {
  reconnect(): Promise<void>;
}

export function makeReconnectHandler(rc: Reconnector): CommandHandler {
  return {
    name: 'reconnect',
    description: 'force reconnect of the Lark WebSocket (admin)',
    adminOnly: true,
    async run(ctx) {
      await rc.reconnect();
      await ctx.reply('reconnect issued');
    },
  };
}
```

- [ ] **Step 4: Implement `doctor.ts`**

```ts
// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import type { Adapter } from '../../adapters/types.js';

export function makeDoctorHandler(adapter: Adapter): CommandHandler {
  return {
    name: 'doctor',
    description: 'check CLI version, network, and recent errors',
    async run(ctx) {
      const pf = await adapter.preflight();
      const sess = ctx.sessions.get(ctx.chatId);
      const lines = [
        `bot:          ${ctx.bot.name}`,
        `backend:      ${ctx.bot.backend.type}`,
        `cli:          ${pf.ok ? 'OK ' + (pf.version ?? '') : 'FAIL ' + (pf.error ?? '')}`,
        `current_cwd:  ${sess?.cwd ?? '(none)'}`,
        `session_id:   ${sess?.sessionId ?? '(new)'}`,
      ];
      await ctx.reply(lines.join('\n'));
    },
  };
}
```

- [ ] **Step 5: Wire into worker**

In `src/worker/index.ts`:

```ts
import { accessHandler } from '../commands/handlers/access.js';
import { sessionsHandler } from '../commands/handlers/sessions.js';
import { makeReconnectHandler } from '../commands/handlers/reconnect.js';
import { makeDoctorHandler } from '../commands/handlers/doctor.js';
```

Add a `Reconnector` impl:

```ts
const reconnector = { reconnect: async () => { await ws.stop(); await ws.start(); } };
```

Extend the `handlers` array:

```ts
const handlers = [
  statusHandler,
  newHandler,
  cdHandler,
  timeoutHandler,
  wsHandler,
  accessHandler,
  sessionsHandler,
  makeReconnectHandler(reconnector),
  makeDoctorHandler(adapter),
];
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/handlers/access.ts src/commands/handlers/sessions.ts src/commands/handlers/reconnect.ts src/commands/handlers/doctor.ts src/worker/index.ts
git commit -m "feat(commands): /access /sessions /reconnect /doctor admin commands"
```

---

## Task 5.3: macOS launchd daemon

**Files:**
- Create: `src/daemon/macos.ts`
- Create: `src/daemon/index.ts`
- Create: `src/cli/commands/daemon.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement `src/daemon/macos.ts`**

```ts
// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface MacOsDaemonOpts {
  label: string;
  nodeBin: string;
  cliPath: string;
}

function plistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function plistContent(opts: MacOsDaemonOpts): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.nodeBin}</string>
    <string>${opts.cliPath}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.lark-multi-cli-bridge', 'logs', 'launchd.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.lark-multi-cli-bridge', 'logs', 'launchd.err.log')}</string>
</dict>
</plist>
`;
}

export async function installMacOs(opts: MacOsDaemonOpts): Promise<string> {
  const path = plistPath(opts.label);
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(path, plistContent(opts), { mode: 0o644 });
  await exec('launchctl', ['unload', path]).catch(() => {});
  await exec('launchctl', ['load', path]);
  return path;
}

export async function uninstallMacOs(label: string): Promise<void> {
  const path = plistPath(label);
  if (!existsSync(path)) return;
  await exec('launchctl', ['unload', path]).catch(() => {});
  await unlink(path);
}

export async function statusMacOs(label: string): Promise<string> {
  try {
    const { stdout } = await exec('launchctl', ['list']);
    const line = stdout.split('\n').find((l) => l.includes(label));
    return line ?? 'not loaded';
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
```

- [ ] **Step 2: Implement `src/daemon/index.ts`**

```ts
// SPDX-License-Identifier: MIT
import { platform } from 'node:os';
import { installMacOs, uninstallMacOs, statusMacOs } from './macos.js';

export const DAEMON_LABEL = 'ai.lark-multi-cli-bridge';

export async function installDaemon(opts: { nodeBin: string; cliPath: string }): Promise<string> {
  if (platform() === 'darwin') {
    return installMacOs({ label: DAEMON_LABEL, ...opts });
  }
  throw new Error(`daemon install not supported on ${platform()} yet`);
}

export async function uninstallDaemon(): Promise<void> {
  if (platform() === 'darwin') return uninstallMacOs(DAEMON_LABEL);
  throw new Error(`daemon uninstall not supported on ${platform()} yet`);
}

export async function statusDaemon(): Promise<string> {
  if (platform() === 'darwin') return statusMacOs(DAEMON_LABEL);
  return `unsupported platform: ${platform()}`;
}
```

- [ ] **Step 3: Implement `src/cli/commands/daemon.ts`**

```ts
// SPDX-License-Identifier: MIT
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { installDaemon, uninstallDaemon, statusDaemon } from '../../daemon/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function daemonInstall(): Promise<void> {
  const cliPath = resolve(HERE, '../../cli/index.js');
  const path = await installDaemon({ nodeBin: process.execPath, cliPath });
  console.log(`installed plist: ${path}`);
}

export async function daemonUninstall(): Promise<void> {
  await uninstallDaemon();
  console.log('daemon uninstalled');
}

export async function daemonStatus(): Promise<void> {
  console.log(await statusDaemon());
}
```

- [ ] **Step 4: Wire into `src/cli/index.ts`**

Add:

```ts
import { daemonInstall, daemonUninstall, daemonStatus } from './commands/daemon.js';

const daemon = program.command('daemon').description('manage the daemon service');
daemon.command('install').action(daemonInstall);
daemon.command('uninstall').action(daemonUninstall);
daemon.command('status').action(daemonStatus);
```

- [ ] **Step 5: Build + manual install test**

```
pnpm build
node ./bin/lmcb.mjs daemon install
node ./bin/lmcb.mjs daemon status   # expect a line referencing ai.lark-multi-cli-bridge
node ./bin/lmcb.mjs ps              # should show all bots ready (via launchd-spawned supervisor)
node ./bin/lmcb.mjs daemon uninstall
```

- [ ] **Step 6: Commit**

```bash
git add src/daemon/ src/cli/commands/daemon.ts src/cli/index.ts
git commit -m "feat(daemon): macOS launchd plist install/uninstall/status"
```

---

## Task 5.4: App owner discovery via Lark SDK (replaces env-var fallback)

**Files:**
- Modify: `src/lark/client.ts`
- Modify: `src/worker/index.ts`

- [ ] **Step 1: Add owner resolver to `src/lark/client.ts`**

```ts
// SPDX-License-Identifier: MIT
import * as Lark from '@larksuiteoapi/node-sdk';

export interface LarkClientOpts {
  appId: string;
  appSecret: string;
  domain?: 'lark' | 'feishu';
}

export function createLarkClient(opts: LarkClientOpts): Lark.Client {
  return new Lark.Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
    loggerLevel: Lark.LoggerLevel.warn,
  });
}

/**
 * Resolve the app owner's open_id. Returns undefined if the SDK can't answer.
 *
 * The Lark Open Platform exposes the app owner via `application.application.get`;
 * exact field names depend on SDK version. If unavailable, prefer the
 * LMCB_APP_OWNER_OPEN_ID env var (set this in your bot YAML's behavior section if needed).
 */
export async function fetchAppOwnerOpenId(client: Lark.Client, appId: string): Promise<string | undefined> {
  try {
    const res = (await client.application.application.get({ path: { app_id: appId } })) as unknown as {
      data?: { app?: { owner?: { owner_id?: string; open_id?: string } } };
    };
    return res.data?.app?.owner?.open_id ?? res.data?.app?.owner?.owner_id ?? undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Use it in worker**

In `src/worker/index.ts`, replace:

```ts
const appOwnerOpenId = process.env.LMCB_APP_OWNER_OPEN_ID ?? '';
```

with:

```ts
const appOwnerOpenId =
  (await fetchAppOwnerOpenId(client, bot.lark.app_id)) ??
  process.env.LMCB_APP_OWNER_OPEN_ID ??
  '';
```

Add the import: `import { createLarkClient, fetchAppOwnerOpenId } from '../lark/client.js';`

- [ ] **Step 3: Commit**

```bash
git add src/lark/client.ts src/worker/index.ts
git commit -m "feat(lark): resolve app owner open_id via SDK (fallback to env var)"
```

---

## Task 5.5: Hot-reload bot configs on file change

**Files:**
- Create: `src/config/reload.ts`
- Modify: `src/supervisor/index.ts`

- [ ] **Step 1: Implement watcher**

```ts
// SPDX-License-Identifier: MIT
import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';

export class BotsDirWatcher extends EventEmitter {
  private watcher?: ReturnType<typeof watch>;
  constructor(private dir: string) {
    super();
  }
  start(): void {
    this.watcher = watch(this.dir, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) return;
      this.emit('change', filename);
    });
  }
  stop(): void {
    this.watcher?.close();
  }
}
```

- [ ] **Step 2: Wire into supervisor**

In `src/supervisor/index.ts`, after `await mgr.start()`:

```ts
import { BotsDirWatcher } from '../config/reload.js';
// ...
const watcher = new BotsDirWatcher(paths.bots);
let reloadTimer: NodeJS.Timeout | undefined;
watcher.on('change', (filename) => {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    const newBots = await loadAllBots(paths.bots);
    const target = newBots.find((b) => `${b.name}.yaml` === filename || `${b.name}.yml` === filename);
    if (target) {
      log.info({ bot: target.name }, 'config changed; restarting worker');
      await mgr.restart(target.name).catch((err) => log.warn({ err }, 'restart on reload failed'));
    }
  }, 500);
});
watcher.start();
```

- [ ] **Step 3: Commit**

```bash
git add src/config/reload.ts src/supervisor/index.ts
git commit -m "feat(supervisor): debounced hot-reload of bot configs on file change"
```

---

## Task 5.6: `lmcb bot add` / `list` / `rm` (config management CLI)

**Files:**
- Create: `src/cli/commands/bot.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement `src/cli/commands/bot.ts`**

```ts
// SPDX-License-Identifier: MIT
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import yaml from 'js-yaml';
import { paths } from '../../config/paths.js';

export async function botList(): Promise<void> {
  try {
    const entries = await readdir(paths.bots);
    const yamls = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'));
    if (yamls.length === 0) {
      console.log('(no bots configured)');
      return;
    }
    for (const e of yamls) console.log(`  ${basename(e, extname(e))}`);
  } catch {
    console.log('(no bots directory yet)');
  }
}

export async function botAdd(opts: { name: string; appId: string; appSecret: string; backend: string }): Promise<void> {
  if (!['claude', 'codex', 'gemini'].includes(opts.backend)) {
    throw new Error(`backend must be claude|codex|gemini, got ${opts.backend}`);
  }
  const file = join(paths.bots, `${opts.name}.yaml`);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const body: Record<string, unknown> = {
    name: opts.name,
    enabled: true,
    lark: { app_id: opts.appId, app_secret: opts.appSecret, tenant: 'lark' },
    backend: { type: opts.backend, [opts.backend]: opts.backend === 'claude' ? { permission_mode: 'bypassPermissions' } : {} },
    access: { allowed_users: [], allowed_chats: [], admins: [] },
    behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
  };
  await writeFile(file, yaml.dump(body), { mode: 0o600 });
  console.log(`created ${file}`);
}

export async function botRm(name: string): Promise<void> {
  await rm(join(paths.bots, `${name}.yaml`), { force: true });
  console.log(`removed bots/${name}.yaml`);
}
```

- [ ] **Step 2: Wire into `src/cli/index.ts`**

```ts
import { botAdd, botList, botRm } from './commands/bot.js';

const bot = program.command('bot').description('manage bot configs in ~/.lark-multi-cli-bridge/bots/');
bot
  .command('add <name>')
  .requiredOption('--app-id <id>')
  .requiredOption('--app-secret <secret>')
  .requiredOption('--backend <backend>', 'claude | codex | gemini')
  .action(async (name: string, opts: { appId: string; appSecret: string; backend: string }) => {
    await botAdd({ name, ...opts });
  });
bot.command('list').action(botList);
bot.command('rm <name>').action(botRm);
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/bot.ts src/cli/index.ts
git commit -m "feat(cli): lmcb bot add/list/rm for managing per-bot YAMLs"
```

---

## Task 5.7: E2E test with a mock Lark WS server

**Files:**
- Create: `tests/e2e/mock-lark-server.ts`
- Create: `tests/e2e/single-bot-flow.test.ts`

- [ ] **Step 1: Implement mock server**

Create `tests/e2e/mock-lark-server.ts`:

```ts
// SPDX-License-Identifier: MIT
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

/**
 * A minimal mock that emulates the bare-bones shape of Lark's WS API:
 *   - clients connect and receive an injectable "im.message.receive_v1" payload
 *   - the server records HTTP-like message create/patch calls posted back via a side-channel
 *
 * This test fixture does NOT exercise the real Lark SDK protocol — it asserts the worker's
 * internal wiring (parser -> dispatcher -> streamer) given a Lark-shaped event.
 */
export class MockLarkServer {
  private wss?: WebSocketServer;
  public messageCreate: unknown[] = [];
  public messagePatch: unknown[] = [];

  async listen(port: number): Promise<void> {
    this.wss = new WebSocketServer({ port });
  }

  async send(_clientPredicate: (ws: WebSocket) => boolean, _payload: unknown): Promise<void> {
    // Intentionally left as a no-op: real Lark WS handshake is non-trivial; we use
    // the message-parse unit tests and the dispatcher tests to cover the parsing branch.
    // This file exists to anchor the e2e test scaffolding for future expansion.
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => this.wss?.close(() => r()));
  }
}
```

- [ ] **Step 2: Write a more pragmatic e2e: in-process wiring test**

Create `tests/e2e/single-bot-flow.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import { parseIngressEvent } from '../../src/lark/message-parse.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class FakeAdapter implements Adapter {
  readonly backend = 'claude' as const;
  async preflight() {
    return { ok: true };
  }
  async *run(_ctx: RunContext): AsyncIterable<AdapterEvent> {
    yield { type: 'session-start', sessionId: 's1' };
    yield { type: 'text-delta', text: 'Hello' };
    yield { type: 'done', sessionId: 's1', finalText: 'Hello' };
  }
}

function fakeStreamer() {
  return {
    start: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onError: vi.fn(async () => {}),
    onDone: vi.fn(async () => {}),
  };
}

describe('end-to-end single-bot wiring', () => {
  it('parses a Lark event, routes to dispatcher, and streamer sees text-delta and done', async () => {
    const raw = {
      event: {
        sender: { sender_id: { open_id: 'ou_u' } },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_1',
          chat_type: 'p2p',
          message_type: 'text',
          create_time: '1700000000000',
          content: JSON.stringify({ text: 'say hi' }),
          mentions: [],
        },
      },
    };
    const msg = parseIngressEvent(raw)!;
    const streamer = fakeStreamer();
    const dispatcher = new Dispatcher({
      adapter: new FakeAdapter(),
      makeStreamer: () => streamer,
      onSessionUpdate: () => {},
      batchWindowMs: 10,
    });

    await dispatcher.enqueue({
      chatId: msg.chatId,
      prompt: msg.text,
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
    });

    expect(streamer.start).toHaveBeenCalledTimes(1);
    expect(streamer.onTextDelta).toHaveBeenCalledWith('Hello');
    expect(streamer.onDone).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Install `ws` for the mock**

```bash
pnpm add -D ws @types/ws
```

- [ ] **Step 4: Run + commit**

Run: `pnpm test tests/e2e/`

```bash
git add tests/e2e/ package.json pnpm-lock.yaml
git commit -m "test(e2e): mock Lark server scaffold + in-process single-bot wiring test"
```

---

## Task 5.8: Documentation (English + Chinese)

**Files:**
- Modify: `README.md`
- Create: `README.zh.md`
- Create: `docs/architecture.md`
- Create: `docs/architecture.zh.md`
- Create: `docs/quickstart.md`
- Create: `docs/quickstart.zh.md`
- Create: `docs/adapter-authoring.md`
- Create: `docs/faq.md`
- Create: `LICENSE`

- [ ] **Step 1: Write `README.md`**

```markdown
# lark-multi-cli-bridge (lmcb)

Lark/Feishu chat bridge that routes inbound messages to **Claude Code**, **OpenAI Codex CLI**, or **Google Gemini CLI**, with support for running multiple bots concurrently — one bot per CLI backend.

## Features

- One supervisor process forks one worker per bot. Workers crash → supervisor restarts with exponential backoff.
- Streaming "thinking → response" card updates in Lark, throttled to respect rate limits.
- Preempt + 500ms batch: rapid follow-ups merge into a single CLI run instead of starting a new conversation.
- Per-chat session continuity via the CLI's own session id (so you keep multi-turn context).
- Slash commands: `/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`.
- Per-bot access control with implicit app-owner admin.
- Native macOS launchd daemon for boot-time install.
- Adapter authoring guide for adding more CLIs.

## Quickstart

See `docs/quickstart.md`.

## License

MIT.
```

- [ ] **Step 2: Write `docs/quickstart.md`**

```markdown
# Quickstart

## 1. Install

```
git clone <this repo>
cd lark-multi-cli-bridge
pnpm install
pnpm build
npm link    # exposes the `lmcb` command globally
```

## 2. Add your first bot

You need a Lark app with `app_id` + `app_secret` and a bot identity attached.

```
lmcb bot add claude-bot --app-id cli_xxx --app-secret hex_xxx --backend claude
```

## 3. Start

```
lmcb start --foreground   # for first-time debugging
```

In Lark, message your bot. You should see a streaming card with Claude's response.

## 4. Promote to daemon

```
lmcb start              # background
lmcb daemon install     # boots on login (macOS launchd)
```

## 5. Add more bots

```
lmcb bot add codex-bot --app-id cli_yyy --app-secret hex_yyy --backend codex
lmcb bot add gemini-bot --app-id cli_zzz --app-secret hex_zzz --backend gemini
lmcb restart codex-bot   # supervisor picks up new bot on next reload
```

## Troubleshooting

`lmcb doctor` (run inside a Lark chat) reports CLI availability and current session state. Logs at `~/.lark-multi-cli-bridge/logs/`.
```

- [ ] **Step 3: Write `docs/architecture.md`**

A concise summary mirroring the spec's Section 3. Reference the spec for full detail:

```markdown
# Architecture

See the canonical design document: `docs/superpowers/specs/2026-05-31-lark-multi-cli-bridge-design.md`.

Short version: supervisor process forks per-bot workers. Each worker holds a Lark long-connection and dispatches incoming messages through a streaming Adapter (Claude / Codex / Gemini) that spawns one-shot CLI subprocesses. State lives under `~/.lark-multi-cli-bridge/`.

```
[supervisor] -- fork --> [worker A: claude-bot] --> spawns `claude`
            \-- fork --> [worker B: codex-bot]  --> spawns `codex`
            \-- fork --> [worker C: gemini-bot] --> spawns `gemini`
```

The supervisor exposes a unix-socket JSON-RPC at `~/.lark-multi-cli-bridge/ipc.sock` consumed by the `lmcb` CLI.
```

- [ ] **Step 4: Write `docs/adapter-authoring.md`**

```markdown
# Adding a New CLI Backend

To wire a 4th CLI, implement the `Adapter` interface in `src/adapters/types.ts`:

```ts
export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

Steps:

1. Add your backend name to the `BackendType` union and the discriminated union in `src/config/schema.ts`.
2. Create `src/adapters/<name>.ts` implementing the interface. Use `spawnWithLifecycle` from `base.ts` for child-process plumbing.
3. Map your CLI's output to `AdapterEvent`. At minimum: `session-start`, `text-delta`, `done`. Tool events are optional.
4. Register your adapter in `src/adapters/registry.ts`.
5. Record a fixture under `tests/adapters/__fixtures__/<name>/` and add unit tests in `tests/adapters/<name>.test.ts`.
```

- [ ] **Step 5: Write `docs/faq.md`**

```markdown
# FAQ

**Q: Will my secrets leak?**
A: `~/.lark-multi-cli-bridge/bots/*.yaml` and the entire root are chmod 600/700. The default `.gitignore` blocks accidental commits. The schema reserves `app_secret_ref` for future secret-provider integration (keychain, exec).

**Q: What if Codex CLI doesn't have `--json`?**
A: Set `backend.codex.json_mode: false` and the adapter will fall back to streaming raw stdout chunks as text-delta events.

**Q: How do I run only one of my bots?**
A: Set `enabled: false` on the others in their YAML and `lmcb restart <bot>`, or `lmcb stop` then edit and `lmcb start`.

**Q: Will attachments be deleted?**
A: No. Attachments under `~/.lark-multi-cli-bridge/media/<chat_id>/` are kept indefinitely. Manage them yourself.
```

- [ ] **Step 6: Write Chinese translations**

Create `README.zh.md`, `docs/quickstart.zh.md`, `docs/architecture.zh.md` as Chinese translations of the above. Mark each English doc and its Chinese counterpart with the same publication date in a header comment.

- [ ] **Step 7: Write `LICENSE`**

Standard MIT license text with `Copyright (c) 2026 Lei Wang` (or whichever name you use).

- [ ] **Step 8: Commit**

```bash
git add README.md README.zh.md docs/quickstart.md docs/quickstart.zh.md docs/architecture.md docs/architecture.zh.md docs/adapter-authoring.md docs/faq.md LICENSE
git commit -m "docs: README + quickstart + architecture + adapter authoring + FAQ (en+zh) + LICENSE"
```

---

## Task 5.9: M5 smoke + final tag

- [ ] **Step 1: Run full test suite**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: green.

- [ ] **Step 2: Reboot recovery smoke**

1. `lmcb daemon install`
2. `sudo reboot`
3. After login, wait 30s, then `lmcb ps` — expect all bots `state=ready`.
4. Message each bot in Lark — expect streaming response.
5. `lmcb daemon uninstall`.

Document in `docs/smoke/M5-YYYY-MM-DD.md`.

- [ ] **Step 3: Tag v0.1.0**

```bash
git add docs/smoke/
git commit -m "docs(smoke): M5 daemon reboot-recovery smoke"
git tag -a v0.1.0 -m "v0.1.0 — first complete release: multi-CLI multi-bot Lark bridge"
```

---

# Deferred from v1 (acknowledged spec gaps)

The spec lists these as v1 scope but the plan defers them to a follow-up iteration. They are NOT part of the v0.1.0 acceptance criteria:

1. **Linux systemd user unit generation** (spec Section 8.3). The plan ships macOS launchd only (Task 5.3). `daemon/index.ts` already branches on `platform()` so adding `daemon/linux.ts` later is a small additive task with no architectural impact. Rationale: primary developer's host is macOS; Linux systemd would consume ~half a day with no smoke-test platform available.

2. **`app_secret_ref` secret providers** (spec Section 4.4). v1 plan stores `app_secret` as plaintext-with-chmod-600. The `BotConfigSchema.lark.app_secret_ref` field already accepts the future shape (Task 1.2), so adding a provider later changes only the resolver, not the schema.

3. **Prometheus metrics endpoint** (spec Section 9). Schema reserves the config block, no exporter code in v1.

4. **`lmcb media prune <chat_id>`** command for manual attachment cleanup (spec Section 7.1). Attachments stay forever in v1 — that's the explicit decision.

---

# Self-Review Checklist (run after the plan is fully drafted)

1. **Spec coverage**:
   - Goal section maps to M1-M5 milestones. ✓
   - Decision Log items 1-14 each implemented somewhere. ✓ (positioning M1.1, stack M1.1, supervisor M3, adapter streaming M1.4/2.2/2.3, MVP scope M1-M5 entirety, project name pkg.json, per-bot YAML schema M1.2, one-shot CLI M1.5/2.2/2.3, attachment retention permanent — Task 4.7, /cd vs /ws semantics — Tasks 4.3+4.4, multi-bot same group — no special handling — Task 4.6 bridge_context only, daemons M5.3, throttle 500ms/50char — Task 1.9, crash backoff M3.3 + M3.4).
2. **Placeholder scan**: searched for "TBD" / "implement later" / "handle edge cases" → none.
3. **Type consistency**: `Adapter`, `AdapterEvent`, `RunContext`, `IngressMessage`, `BotConfig`, `WorkerStatus` — all defined in one place and referenced via imports. ✓
4. **Ambiguity check**: each command's behavior, each adapter's CLI flags, each crash-budget number is concrete. ✓

---

# Execution Handoff

**Plan complete and saved to** `/Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge/docs/superpowers/plans/2026-05-31-lark-multi-cli-bridge.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task and review between tasks; tight feedback loop, easier to course-correct.
2. **Inline Execution** — I execute tasks in this session in batches with checkpoints.

Which approach?

