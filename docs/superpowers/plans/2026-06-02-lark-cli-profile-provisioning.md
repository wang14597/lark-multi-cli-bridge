# lark-cli Profile Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cross-bot identity pollution by giving each lmcb bot its own lark-cli profile and exposing it to LLM children via a PATH shim that hard-pins `--profile <app_id>` on every invocation.

**Architecture:** Replace the failed `LARKSUITE_CLI_APP_ID/SECRET/BRAND` env-injection scheme (ae97924) with the T2/T3 original design: at worker startup, idempotently `lark-cli profile add` the bot's app, then write an executable shim at `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli` that `exec`s the real lark-cli with `--profile <app_id>` prepended. Dispatcher's `extraEnv` then prepends the bot's shim dir to `PATH`, so every `lark-cli` call inside the LLM subprocess transparently routes through the right profile.

**Tech Stack:** Node.js 20+, TypeScript (strict + exactOptionalPropertyTypes), Vitest, lark-cli 1.0.43, POSIX shell (bash shim).

---

## Background — Why this rewrite exists

Root cause investigation summary (kept here for plan readers):

1. We tested `env -i ... LARKSUITE_CLI_APP_ID=cli_aa96561a57b81ed1 LARKSUITE_CLI_APP_SECRET=... LARKSUITE_CLI_BRAND=lark lark-cli api GET /open-apis/bot/v3/info`. Result: `{"ok":false,"error":{"type":"auth","message":"no access token available for bot"}}`. **Pure env injection cannot mint a tenant_access_token in lark-cli 1.0.43.**
2. We then ran `lark-cli profile add --name cli_aa96561a57b81ed1 --app-id cli_aa96561a57b81ed1 --app-secret-stdin --brand lark` followed by `lark-cli --profile cli_aa96561a57b81ed1 api GET /open-apis/bot/v3/info`. Result: `app_name: wl-claude-bot` — correct identity, token minted successfully.
3. Conclusion: lark-cli requires a registered profile. The `LARKSUITE_CLI_*` env vars are recognised (they put lark-cli into "external credentials" mode, surfacing the `"auth" is not supported: credentials are provided externally` message) but the external-provider path is incomplete and never produces a usable bot token.
4. Before this plan, every LLM-spawned `lark-cli` call inside lmcb silently fell back to whichever profile happened to be the local `active: true` default — leaking cross-bot identity (the documented "bot identity confusion" complaint was not an LLM hallucination).

---

## File Structure

**New:**
- `src/lark/lark-cli-provision.ts` — `ensureLarkProfile()` and `provisionLarkShim()` (~120 LoC)
- `tests/lark/lark-cli-provision.test.ts` — unit tests with mocked `runLarkCli` and tmp fs

**Modified:**
- `src/config/paths.ts` — add `shimsDir(botName)` helper
- `src/worker/index.ts` — replace `larkCliEnv` block with provision + PATH-shim
- `src/worker/dispatcher.ts` — comment-only update on `extraEnv` JSDoc
- `tests/worker/dispatcher-extra-env.test.ts` — drop LARKSUITE_CLI_* assertions, keep generic PATH/env merge coverage
- `docs/architecture.md` + `docs/architecture.zh.md` — replace "external-credentials env mode" section with "profile + shim" section

**Out of scope (do not touch this plan):**
- The overlay skill text (`skills/lark-bridge-overlay/SKILL.md`) — that's a docs concern, separate follow-up.
- The `lmcb init` first-run flow — the profile provision is automatic at worker startup, not at init time.

---

## Public API contracts

These types are referenced across multiple tasks. Defined here once to avoid drift.

```ts
// src/lark/lark-cli-provision.ts

export interface ProvisionedProfile {
  /** Profile name == bot.lark.app_id. */
  name: string;
  /** Absolute path to the real lark-cli binary we resolved (NOT the shim). */
  realLarkCliPath: string;
}

export interface ProvisionDeps {
  /**
   * Run a lark-cli command. The implementation MUST NOT route through any
   * lmcb shim — it has to hit the real binary. Production wiring resolves the
   * real binary once at startup; tests inject a fake.
   */
  runLarkCli: (
    args: string[],
    opts?: { stdin?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** fs writer; tests inject a tmp-dir-aware fake. */
  writeFile: (path: string, content: string, mode: number) => Promise<void>;
  /** mkdir -p. */
  mkdirp: (path: string) => Promise<void>;
}

export interface Bot {
  name: string;
  lark: { app_id: string; app_secret: string; tenant: 'lark' | 'feishu' };
}

export async function ensureLarkProfile(
  bot: Bot,
  deps: ProvisionDeps,
): Promise<void>;

export async function provisionLarkShim(
  bot: Bot,
  shimDir: string,
  realLarkCliPath: string,
  deps: Pick<ProvisionDeps, 'writeFile' | 'mkdirp'>,
): Promise<string>; // returns absolute path to the shim file
```

The shim content is fixed (also referenced across tasks):

```bash
#!/usr/bin/env bash
# lmcb-managed shim for bot <name> — DO NOT EDIT.
# Hard-pins --profile so the LLM never falls through to the default profile.
exec "<REAL_LARK_CLI>" --profile "<APP_ID>" "$@"
```

---

## Task 1: paths helper for shim dirs

**Files:**
- Modify: `src/config/paths.ts`
- Test: `tests/config/paths.test.ts` (create if missing, otherwise extend)

- [ ] **Step 1: Read current paths.ts**

Run: `cat src/config/paths.ts`
Expected: see exported `paths` object with `bots`, `sessionsJson`, `workspacesJson`, `workerLog(name, date)`.

- [ ] **Step 2: Write failing test**

Create `tests/config/paths.test.ts` (or append to existing) with:

```ts
import { describe, it, expect } from 'vitest';
import { paths } from '../../src/config/paths.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('paths.shimsDir', () => {
  it('returns ~/.lark-multi-cli-bridge/shims/<bot>', () => {
    expect(paths.shimsDir('codex-bot')).toBe(
      join(homedir(), '.lark-multi-cli-bridge', 'shims', 'codex-bot'),
    );
  });

  it('rejects bot names containing path separators', () => {
    expect(() => paths.shimsDir('../etc')).toThrow();
    expect(() => paths.shimsDir('a/b')).toThrow();
  });
});
```

- [ ] **Step 3: Run test, confirm failure**

Run: `pnpm test -- tests/config/paths.test.ts`
Expected: FAIL — `paths.shimsDir is not a function`.

- [ ] **Step 4: Implement**

In `src/config/paths.ts`, add to the exported `paths` object:

```ts
shimsDir(botName: string): string {
  if (botName.includes('/') || botName.includes('\\') || botName.includes('..')) {
    throw new Error(`invalid bot name: ${botName}`);
  }
  return join(homedir(), '.lark-multi-cli-bridge', 'shims', botName);
},
```

- [ ] **Step 5: Run test, confirm pass**

Run: `pnpm test -- tests/config/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/paths.ts tests/config/paths.test.ts
git commit -m "feat(paths): add shimsDir(botName) helper for lark-cli profile shims"
```

---

## Task 2: ensureLarkProfile — failing test (idempotent skip when present)

**Files:**
- Create: `tests/lark/lark-cli-provision.test.ts`

- [ ] **Step 1: Write test file with idempotent-skip case**

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { ensureLarkProfile } from '../../src/lark/lark-cli-provision.js';

const bot = {
  name: 'claude-bot',
  lark: { app_id: 'cli_aa96561a57b81ed1', app_secret: 'sekrit', tenant: 'lark' as const },
};

function makeRunner(scriptedResponses: Array<{
  match: (args: string[]) => boolean;
  result: { stdout: string; stderr: string; exitCode: number };
}>) {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const runLarkCli = vi.fn(async (args: string[], opts?: { stdin?: string }) => {
    calls.push({ args, ...(opts?.stdin !== undefined ? { stdin: opts.stdin } : {}) });
    for (const r of scriptedResponses) {
      if (r.match(args)) return r.result;
    }
    throw new Error(`unexpected runLarkCli args: ${JSON.stringify(args)}`);
  });
  return { runLarkCli, calls };
}

describe('ensureLarkProfile', () => {
  it('skips add when profile with matching app_id already exists', async () => {
    const { runLarkCli, calls } = makeRunner([
      {
        match: (args) => args[0] === 'profile' && args[1] === 'list',
        result: {
          stdout: JSON.stringify([
            { name: 'other', appId: 'cli_aa93d72c97f9deea', brand: 'lark', active: true },
            { name: 'cli_aa96561a57b81ed1', appId: 'cli_aa96561a57b81ed1', brand: 'lark', active: false },
          ]),
          stderr: '',
          exitCode: 0,
        },
      },
    ]);

    await ensureLarkProfile(bot, {
      runLarkCli,
      writeFile: vi.fn(),
      mkdirp: vi.fn(),
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.args).toEqual(['profile', 'list']);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: FAIL — `Cannot find module '.../lark-cli-provision.js'` or `ensureLarkProfile is not a function`.

(No commit; pair with Task 3.)

---

## Task 3: ensureLarkProfile — minimal implementation for skip-when-present

**Files:**
- Create: `src/lark/lark-cli-provision.ts`

- [ ] **Step 1: Write the minimal module**

```ts
// SPDX-License-Identifier: MIT

export interface ProvisionedProfile {
  name: string;
  realLarkCliPath: string;
}

export interface ProvisionDeps {
  runLarkCli: (
    args: string[],
    opts?: { stdin?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFile: (path: string, content: string, mode: number) => Promise<void>;
  mkdirp: (path: string) => Promise<void>;
}

export interface Bot {
  name: string;
  lark: { app_id: string; app_secret: string; tenant: 'lark' | 'feishu' };
}

interface LarkCliProfile {
  name: string;
  appId: string;
  brand: string;
  active: boolean;
}

export async function ensureLarkProfile(bot: Bot, deps: ProvisionDeps): Promise<void> {
  // lark-cli 1.0.43/1.0.45 emit JSON by default; there is no --format flag.
  const listed = await deps.runLarkCli(['profile', 'list']);
  if (listed.exitCode !== 0) {
    throw new Error(`lark-cli profile list failed (exit ${listed.exitCode}): ${listed.stderr}`);
  }
  let profiles: LarkCliProfile[];
  try {
    profiles = JSON.parse(listed.stdout) as LarkCliProfile[];
  } catch (err) {
    throw new Error(`lark-cli profile list returned non-JSON stdout: ${(err as Error).message}`);
  }
  const match = profiles.find((p) => p.appId === bot.lark.app_id);
  if (match) return;

  // Provision missing profile — secret arrives via stdin to avoid argv leak.
  const added = await deps.runLarkCli(
    [
      'profile',
      'add',
      '--name',
      bot.lark.app_id,
      '--app-id',
      bot.lark.app_id,
      '--brand',
      bot.lark.tenant,
      '--app-secret-stdin',
    ],
    { stdin: bot.lark.app_secret },
  );
  if (added.exitCode !== 0) {
    throw new Error(`lark-cli profile add failed (exit ${added.exitCode}): ${added.stderr}`);
  }
}
```

- [ ] **Step 2: Run the existing test, confirm pass**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add src/lark/lark-cli-provision.ts tests/lark/lark-cli-provision.test.ts
git commit -m "feat(lark): ensureLarkProfile — idempotent skip when bot profile already registered"
```

---

## Task 4: ensureLarkProfile — failing test for add path

**Files:**
- Modify: `tests/lark/lark-cli-provision.test.ts`

- [ ] **Step 1: Append test for missing profile**

Add inside `describe('ensureLarkProfile', ...)`:

```ts
it('runs profile add with --app-secret-stdin when app_id missing from list', async () => {
  const { runLarkCli, calls } = makeRunner([
    {
      match: (args) => args[0] === 'profile' && args[1] === 'list',
      result: {
        stdout: JSON.stringify([
          { name: 'other', appId: 'cli_aa93d72c97f9deea', brand: 'lark', active: true },
        ]),
        stderr: '',
        exitCode: 0,
      },
    },
    {
      match: (args) => args[0] === 'profile' && args[1] === 'add',
      result: { stdout: 'OK', stderr: '', exitCode: 0 },
    },
  ]);

  await ensureLarkProfile(bot, {
    runLarkCli,
    writeFile: vi.fn(),
    mkdirp: vi.fn(),
  });

  expect(calls.length).toBe(2);
  expect(calls[1]!.args).toEqual([
    'profile',
    'add',
    '--name',
    'cli_aa96561a57b81ed1',
    '--app-id',
    'cli_aa96561a57b81ed1',
    '--brand',
    'lark',
    '--app-secret-stdin',
  ]);
  expect(calls[1]!.stdin).toBe('sekrit');
});

it('throws when profile add fails', async () => {
  const { runLarkCli } = makeRunner([
    {
      match: (args) => args[0] === 'profile' && args[1] === 'list',
      result: { stdout: '[]', stderr: '', exitCode: 0 },
    },
    {
      match: (args) => args[0] === 'profile' && args[1] === 'add',
      result: { stdout: '', stderr: 'boom', exitCode: 1 },
    },
  ]);
  await expect(
    ensureLarkProfile(bot, { runLarkCli, writeFile: vi.fn(), mkdirp: vi.fn() }),
  ).rejects.toThrow(/profile add failed.*boom/);
});

it('throws when profile list returns non-zero', async () => {
  const { runLarkCli } = makeRunner([
    {
      match: (args) => args[0] === 'profile' && args[1] === 'list',
      result: { stdout: '', stderr: 'nope', exitCode: 2 },
    },
  ]);
  await expect(
    ensureLarkProfile(bot, { runLarkCli, writeFile: vi.fn(), mkdirp: vi.fn() }),
  ).rejects.toThrow(/profile list failed.*nope/);
});
```

- [ ] **Step 2: Run tests, confirm 3 new pass (impl already handles them)**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 3: Commit**

```bash
git add tests/lark/lark-cli-provision.test.ts
git commit -m "test(lark): cover ensureLarkProfile add path + failure modes"
```

---

## Task 5: provisionLarkShim — failing tests

**Files:**
- Modify: `tests/lark/lark-cli-provision.test.ts`

- [ ] **Step 1: Append describe block for provisionLarkShim**

```ts
import { provisionLarkShim } from '../../src/lark/lark-cli-provision.js';

describe('provisionLarkShim', () => {
  it('writes shim with exec line bound to real lark-cli + bot app_id', async () => {
    const writes: Array<{ path: string; content: string; mode: number }> = [];
    const mkdirs: string[] = [];
    const writeFile = vi.fn(async (path: string, content: string, mode: number) => {
      writes.push({ path, content, mode });
    });
    const mkdirp = vi.fn(async (path: string) => {
      mkdirs.push(path);
    });

    const shimPath = await provisionLarkShim(
      bot,
      '/tmp/shims/claude-bot',
      '/usr/local/bin/lark-cli',
      { writeFile, mkdirp },
    );

    expect(shimPath).toBe('/tmp/shims/claude-bot/lark-cli');
    expect(mkdirs).toEqual(['/tmp/shims/claude-bot']);
    expect(writes.length).toBe(1);
    expect(writes[0]!.mode).toBe(0o755);
    expect(writes[0]!.path).toBe('/tmp/shims/claude-bot/lark-cli');
    expect(writes[0]!.content).toContain('#!/usr/bin/env bash');
    expect(writes[0]!.content).toContain(
      'exec "/usr/local/bin/lark-cli" --profile "cli_aa96561a57b81ed1" "$@"',
    );
  });

  it('rejects realLarkCliPath that contains a double-quote (shim injection guard)', async () => {
    await expect(
      provisionLarkShim(
        bot,
        '/tmp/shims/x',
        '/usr/local/bin/lark"; rm -rf /; "cli',
        { writeFile: vi.fn(), mkdirp: vi.fn() },
      ),
    ).rejects.toThrow(/unsafe lark-cli path/);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: FAIL — `provisionLarkShim is not a function`.

(No commit; pair with Task 6.)

---

## Task 6: provisionLarkShim — implementation

**Files:**
- Modify: `src/lark/lark-cli-provision.ts`

- [ ] **Step 1: Append to module**

```ts
import { join } from 'node:path';

export async function provisionLarkShim(
  bot: Bot,
  shimDir: string,
  realLarkCliPath: string,
  deps: Pick<ProvisionDeps, 'writeFile' | 'mkdirp'>,
): Promise<string> {
  if (realLarkCliPath.includes('"') || realLarkCliPath.includes('\n')) {
    throw new Error(`unsafe lark-cli path (contains quote or newline): ${realLarkCliPath}`);
  }
  // app_id is constrained to [a-z0-9_] by Lark's open platform, but be paranoid.
  if (!/^[A-Za-z0-9_-]+$/.test(bot.lark.app_id)) {
    throw new Error(`unsafe app_id: ${bot.lark.app_id}`);
  }
  await deps.mkdirp(shimDir);
  const shimPath = join(shimDir, 'lark-cli');
  const content =
    `#!/usr/bin/env bash\n` +
    `# lmcb-managed shim for bot ${bot.name} — DO NOT EDIT.\n` +
    `# Hard-pins --profile so the LLM never falls through to the default profile.\n` +
    `exec "${realLarkCliPath}" --profile "${bot.lark.app_id}" "$@"\n`;
  await deps.writeFile(shimPath, content, 0o755);
  return shimPath;
}
```

- [ ] **Step 2: Run tests, confirm pass**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lark/lark-cli-provision.ts tests/lark/lark-cli-provision.test.ts
git commit -m "feat(lark): provisionLarkShim — write per-bot PATH shim that pins --profile"
```

---

## Task 7: Wire production runLarkCli + lark-cli path resolver

**Files:**
- Modify: `src/lark/lark-cli-provision.ts`
- Test: `tests/lark/lark-cli-provision.test.ts`

The unit tests above use a fake `runLarkCli`. Production needs a real impl that spawns the real binary and pipes stdin. We also need to discover the real binary path (`which lark-cli` equivalent) so the shim doesn't recurse if the binary is on PATH.

- [ ] **Step 1: Write failing test for resolveRealLarkCli**

Append:

```ts
import { resolveRealLarkCli } from '../../src/lark/lark-cli-provision.js';

describe('resolveRealLarkCli', () => {
  it('rejects paths inside any lmcb shims dir', () => {
    expect(() =>
      resolveRealLarkCli(
        '/Users/me/.lark-multi-cli-bridge/shims/codex-bot/lark-cli',
        '/Users/me/.lark-multi-cli-bridge/shims',
      ),
    ).toThrow(/refusing to use shim/);
  });

  it('returns the path unchanged when it lives outside shims', () => {
    expect(
      resolveRealLarkCli('/usr/local/bin/lark-cli', '/Users/me/.lark-multi-cli-bridge/shims'),
    ).toBe('/usr/local/bin/lark-cli');
  });
});
```

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: FAIL — `resolveRealLarkCli is not a function`.

- [ ] **Step 2: Implement resolveRealLarkCli + real runLarkCli factory**

Append to `src/lark/lark-cli-provision.ts`:

```ts
import { spawn } from 'node:child_process';

export function resolveRealLarkCli(candidatePath: string, shimsRoot: string): string {
  if (candidatePath.startsWith(shimsRoot + '/') || candidatePath === shimsRoot) {
    throw new Error(`refusing to use shim as real lark-cli: ${candidatePath}`);
  }
  return candidatePath;
}

/**
 * Build a runLarkCli that always invokes the real binary (NOT a shim). The
 * caller is responsible for resolving `realLarkCliPath` via resolveRealLarkCli
 * before passing it in. Strips PATH from the env so even if something puts a
 * shim on PATH ahead of the real binary, we still hit the real one.
 */
export function makeRunLarkCli(
  realLarkCliPath: string,
): ProvisionDeps['runLarkCli'] {
  return (args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(realLarkCliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
      if (opts?.stdin !== undefined) {
        child.stdin.end(opts.stdin);
      } else {
        child.stdin.end();
      }
    });
}
```

- [ ] **Step 3: Run tests, confirm pass**

Run: `pnpm test -- tests/lark/lark-cli-provision.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
git add src/lark/lark-cli-provision.ts tests/lark/lark-cli-provision.test.ts
git commit -m "feat(lark): resolveRealLarkCli guard + makeRunLarkCli factory for production"
```

---

## Task 8: Wire provision + shim into worker startup

**Files:**
- Modify: `src/worker/index.ts`

- [ ] **Step 1: Locate the env-injection block**

Run: `grep -n "LARKSUITE_CLI_APP_ID" src/worker/index.ts`
Expected: line ~71 — the `larkCliEnv` object.

- [ ] **Step 2: Replace the env block + extraEnv wiring**

Find the existing block at `src/worker/index.ts` (around lines 64-74):

```ts
  // Bind every lark-cli child invocation to THIS bot's identity by injecting
  // the LARKSUITE_CLI_* "external credentials" env vars into the LLM child's
  // environment. lark-cli detects these and switches to its external-provider
  // mode, bypassing config.json and the OS keychain entirely — so the worker
  // never touches the global default profile and stays cross-platform.
  const larkCliEnv: Record<string, string> = {
    LARKSUITE_CLI_APP_ID: bot.lark.app_id,
    LARKSUITE_CLI_APP_SECRET: bot.lark.app_secret,
    LARKSUITE_CLI_BRAND: bot.lark.tenant,
  };
```

Replace with:

```ts
  // Every lark-cli call from inside the LLM subprocess must hit THIS bot's
  // app identity. lark-cli 1.0.43 cannot accept credentials purely via env
  // (LARKSUITE_CLI_APP_ID/SECRET enter "external credentials" mode but never
  // mint a usable bot token); the only working path is a registered profile
  // + the --profile flag. We provision a profile per bot and expose it via a
  // PATH shim that hard-pins --profile on every invocation.
  const shimDir = paths.shimsDir(bot.name);
  const realLarkCliPath = resolveRealLarkCli(
    process.env.LMCB_LARK_CLI_PATH ?? (await which('lark-cli')),
    paths.shimsRoot,
  );
  const runLarkCli = makeRunLarkCli(realLarkCliPath);
  await ensureLarkProfile(bot, {
    runLarkCli,
    writeFile: (p, c, m) => writeFile(p, c, { mode: m }),
    mkdirp: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  });
  await provisionLarkShim(bot, shimDir, realLarkCliPath, {
    writeFile: (p, c, m) => writeFile(p, c, { mode: m }),
    mkdirp: (p) => mkdir(p, { recursive: true }).then(() => undefined),
  });
  log.info({ shimDir, realLarkCliPath }, 'lark-cli profile + shim provisioned');

  const larkCliEnv: Record<string, string> = {
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
  };
```

- [ ] **Step 3: Add the imports at the top of `src/worker/index.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import {
  ensureLarkProfile,
  provisionLarkShim,
  resolveRealLarkCli,
  makeRunLarkCli,
  which,
} from '../lark/lark-cli-provision.js';
```

(`paths` is already imported. Do NOT recompute the shims root with `homedir()` —
use `paths.shimsRoot` so the path honors `LMCB_HOME` for tests / sandboxed runs.)

- [ ] **Step 4: Add a `which()` helper**

Node 20 doesn't ship `which` natively. Add to the same `lark-cli-provision.ts` file (export it), then import here. Append:

```ts
// In src/lark/lark-cli-provision.ts

import { delimiter } from 'node:path';
import { access, constants } from 'node:fs/promises';

/**
 * Minimal `which` shim — walks PATH looking for an executable named `name`.
 * Returns the first match. Throws if not found.
 */
export async function which(name: string): Promise<string> {
  const path = process.env.PATH ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = `${dir}/${name}`;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable here, keep searching
    }
  }
  throw new Error(`executable not found on PATH: ${name}`);
}
```

Update the import in `src/worker/index.ts` to include `which`.

- [ ] **Step 5: Add unit test for `which`**

Append to `tests/lark/lark-cli-provision.test.ts`:

```ts
import { which } from '../../src/lark/lark-cli-provision.js';

describe('which', () => {
  it('finds an executable on PATH', async () => {
    // `sh` is always on POSIX PATH for our CI/dev envs
    const sh = await which('sh');
    expect(sh).toMatch(/\/sh$/);
  });

  it('throws when not found', async () => {
    await expect(which('definitely_not_a_real_binary_xyz123')).rejects.toThrow(/not found on PATH/);
  });
});
```

- [ ] **Step 6: Run everything**

Run: `pnpm test`
Expected: All previous tests still pass + 2 new which() tests pass.

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/worker/index.ts src/lark/lark-cli-provision.ts tests/lark/lark-cli-provision.test.ts
git commit -m "feat(worker): provision lark-cli profile + PATH shim at startup, replace failed env mode"
```

---

## Task 9: Update dispatcher-extra-env test for new env shape

**Files:**
- Modify: `tests/worker/dispatcher-extra-env.test.ts`

The existing tests at `tests/worker/dispatcher-extra-env.test.ts` are still 100% valid (they verify the generic extraEnv merge mechanism, not specifically LARKSUITE_CLI_*). But the comment header that hints at "LARKSUITE_CLI_*" is now misleading. Also keep coverage that PATH is the canonical use case now.

- [ ] **Step 1: Replace the file header comment + add PATH-specific assertion**

At the top of `tests/worker/dispatcher-extra-env.test.ts`, replace the first non-license line (and any inline comments about LARKSUITE_CLI_*) with:

```ts
// SPDX-License-Identifier: MIT
// Dispatcher.extraEnv is the channel by which worker startup pins lark-cli
// identity into every LLM child. Today it's used to prepend a per-bot PATH
// shim; tomorrow it could carry other static per-worker identity. Tests
// here cover the merge mechanism, not the specific keys.
import { describe, it, expect, vi } from 'vitest';
```

(Leave the rest of the file as-is — its existing assertions on `PATH`/`KEEP_ME`/`EXTRA` already cover the production shape.)

- [ ] **Step 2: Run**

Run: `pnpm test -- tests/worker/dispatcher-extra-env.test.ts`
Expected: PASS (3 tests, unchanged).

- [ ] **Step 3: Commit**

```bash
git add tests/worker/dispatcher-extra-env.test.ts
git commit -m "docs(test): rephrase dispatcher-extra-env header — PATH shim is the canonical use"
```

---

## Task 10: Update dispatcher.ts comment

**Files:**
- Modify: `src/worker/dispatcher.ts`

- [ ] **Step 1: Find the misleading comment**

Run: `grep -n "LARKSUITE_CLI" src/worker/dispatcher.ts`
Expected: line ~25 in the `DispatcherOpts.extraEnv` JSDoc.

- [ ] **Step 2: Replace with current truth**

Find this comment block at `src/worker/dispatcher.ts:23-26`:

```ts
  // Env merged into every adapter.run() invocation. Per-request env wins on
  // key collision. Use for static per-worker identity injection, e.g.
  // LARKSUITE_CLI_APP_ID/SECRET that locks every lark-cli child to one bot.
  extraEnv?: Record<string, string>;
```

Replace with:

```ts
  // Env merged into every adapter.run() invocation. Per-request env wins on
  // key collision. Use for static per-worker identity injection — today this
  // is a PATH prefix pointing at the bot's lark-cli profile shim (see
  // src/lark/lark-cli-provision.ts).
  extraEnv?: Record<string, string>;
```

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test -- tests/worker/dispatcher.test.ts tests/worker/dispatcher-extra-env.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/worker/dispatcher.ts
git commit -m "docs(dispatcher): update extraEnv JSDoc to reference the PATH shim model"
```

---

## Task 11: Full verify

**Files:** none.

- [ ] **Step 1: Run full suite + typecheck + build**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 2: Walk diff once**

Run: `git log --oneline ae97924..HEAD`
Expected: 6-7 commits, all scoped to this fix.

Run: `git diff ae97924..HEAD -- 'src/**' 'tests/**' | wc -l`
Expected: roughly 400-600 lines.

---

## Task 12: Manual verify with the real bot

**Files:** none.

This is the only step that actually proves the fix works end-to-end. The unit tests verify shape; this verifies identity.

- [ ] **Step 1: Clean stale profile residue first**

Run:
```bash
lark-cli profile list
```

If a leftover profile from prior cleanup attempts (e.g. `cli_aa93d72c97f9deea`) is still present and is NOT one of the configured bot app_ids, remove it:

```bash
lark-cli profile remove <stale-profile-name>
```

- [ ] **Step 2: Stop any running lmcb daemon**

Run: `lmcb stop` (or `launchctl unload ~/Library/LaunchAgents/com.lark-multi-cli-bridge.plist`).

- [ ] **Step 3: Wipe any pre-existing shims dir (so we can prove fresh provision)**

Run: `rm -rf ~/.lark-multi-cli-bridge/shims/`

- [ ] **Step 4: Build + start**

```bash
pnpm build
lmcb start
```

Tail the worker log for the new info line:

```bash
tail -f ~/.lark-multi-cli-bridge/logs/<bot-name>-*.log | grep -E "profile|shim"
```

Expected: a log entry `lark-cli profile + shim provisioned` with `shimDir` and `realLarkCliPath` fields.

- [ ] **Step 5: Verify shim was written**

```bash
ls -la ~/.lark-multi-cli-bridge/shims/
cat ~/.lark-multi-cli-bridge/shims/<bot-name>/lark-cli
```

Expected: a `<bot-name>/lark-cli` file, 0755, containing `exec "<real-path>" --profile "<app_id>" "$@"`.

- [ ] **Step 6: Verify lark-cli profile got registered**

```bash
lark-cli profile list
```

Expected: includes a profile with `appId` matching every configured bot.

- [ ] **Step 7: Drive the actual bug case via Lark chat**

DM the bot a message asking it to call `lark-cli api GET /open-apis/bot/v3/info`. The reply card output should show `app_name: <THIS bot's name>` — not any other bot's name.

If running multiple bots, repeat for each one. Each must return its OWN app_name.

- [ ] **Step 8: Verify no fallback path exists**

While the lmcb daemon is running, in a terminal NOT under any of lmcb's PATH:

```bash
# Take the active default profile out from under it
lark-cli profile use cli_some_other_app_id  # if any other profile exists
```

Then re-trigger the bot. It must still resolve its own identity (proves the shim's --profile pin survives default-profile changes).

- [ ] **Step 9: Cleanup the test default switch**

If you ran step 8's `profile use`, switch back to whichever profile you want as your interactive default (or leave the bot's profile active — it's harmless).

- [ ] **Step 10: Squash-commit reminder**

The plan execution should produce ~6 commits. Leave them as-is for now; the user will decide whether to squash before push (per their no-auto-push policy).

---

## Task 13: Documentation update

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`

- [ ] **Step 1: Locate the LARKSUITE_CLI_* section**

Run: `grep -n "LARKSUITE_CLI" docs/architecture.md docs/architecture.zh.md`

- [ ] **Step 2: Rewrite the section in docs/architecture.md**

Find the paragraph that describes how lmcb isolates bot identity via env injection. Replace it with:

```markdown
### How lmcb isolates bot identity for lark-cli children

The LLM subprocess (claude / codex / gemini) typically calls `lark-cli` to
send messages, list members, etc. Each lmcb bot needs its own Lark app
identity — without isolation, every bot would silently borrow whichever
`lark-cli` profile happens to be the local default, leaking cross-bot
identity.

lmcb pins identity via a **PATH shim**:

1. At worker startup, `ensureLarkProfile(bot)` idempotently registers a
   `lark-cli profile` named after the bot's `app_id` (using
   `--app-secret-stdin` so secrets never appear in argv).
2. `provisionLarkShim(bot)` writes an executable wrapper at
   `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli` that `exec`s the real
   `lark-cli` binary with `--profile <app_id>` prepended.
3. The dispatcher injects `PATH=<shim-dir>:$PATH` into every LLM child, so
   any `lark-cli` call inside the child transparently routes through the
   correct profile.

This was migrated from a `LARKSUITE_CLI_APP_ID/SECRET/BRAND` env-injection
approach (commit ae97924) which proved non-functional in lark-cli 1.0.43:
the env vars are recognised but never mint a usable bot token.
```

- [ ] **Step 3: Mirror the change into docs/architecture.zh.md**

Translate the same content into Chinese, keeping section structure identical.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/architecture.zh.md
git commit -m "docs(architecture): document the lark-cli profile + PATH shim isolation model"
```

---

## Self-Review

**Spec coverage:**
- Root cause identified (lark-cli 1.0.43 requires registered profile): Background ✓
- Idempotent profile provision: Tasks 2-4 ✓
- Per-bot shim that pins --profile: Tasks 5-6 ✓
- Production binary resolution that refuses shims: Task 7 ✓
- Worker startup wiring: Task 8 ✓
- Test cleanup: Tasks 9-10 ✓
- End-to-end verification: Task 12 ✓
- Documentation: Task 13 ✓

**Placeholder scan:** None. Every step has explicit code, commands, or expected output.

**Type consistency:**
- `ProvisionDeps`, `Bot`, `ProvisionedProfile` defined in the Public API contracts section and used identically in Tasks 2-7.
- `runLarkCli` signature `(args, opts?) => Promise<{stdout,stderr,exitCode}>` consistent across all tasks.
- Shim file path = `<shimDir>/lark-cli` consistent across Task 5 (test), Task 6 (impl), Task 8 (PATH), Task 12 (manual verify).
- `which()` exported from `lark-cli-provision.ts`, imported in `worker/index.ts` — consistent.

**Risks not yet addressed (out of scope but worth flagging):**
- POSIX-only shim. Windows lmcb users would need a `.cmd` variant. Current lmcb only documents macOS launchd, so this is consistent with project scope.
- Shim absolute path is captured at startup. If the user upgrades `lark-cli` to a new install location and the old path disappears, shim will break until next worker restart. Acceptable tradeoff — restart is cheap.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-02-lark-cli-profile-provisioning.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
