# Lark Bot Skill Prompt + `__claude_cb` Callback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a bundled bot-skill system prompt (1:1 port from `feishu-claude-code-bridge`) into every backend (`claude` / `codex` / `gemini`), and implement the `__claude_cb` card-button callback re-entry mechanism so LLM-emitted buttons can resume the same conversation.

**Architecture:** Add a string constant `BOT_SKILL_PROMPT` in a new `src/prompts/` module. Extend each per-backend zod sub-schema with `injectSkillPrompt` (optional, defaults to `true` via registry) and `appendSystemPrompt` (optional). `buildAdapter()` resolves the effective prompt once at adapter construction. Claude uses its native `--append-system-prompt` flag; Codex/Gemini get a new `appendSystemPrompt` opt that prepends the prompt to `ctx.prompt` inside `run()`. The card-action handler is extracted from `worker/index.ts` into its own module so it is unit-testable, then gains a `__claude_cb` branch that strips the marker and re-enqueues the click as a `[card-click] {...}` synthetic message via the existing dispatcher.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ES Modules with `.js` import suffix, vitest 2.x, zod 3.x, pino logger, `@larksuiteoapi/node-sdk`.

**Source-of-truth reference for the prompt body:**
- `feishu-claude-code-bridge/src/agent/claude/adapter.ts` lines 15–152 (template literal `BRIDGE_SYSTEM_PROMPT`)
- Two substitutions on port:
  1. `lark-channel-bridge` → `lark-multi-cli-bridge` (heading + opening sentence only — these are the only two occurrences in the source)
  2. `本地 \`claude\` CLI` → `本地 CLI（claude / codex / gemini）` (opening sentence)
- All other content (headings, code blocks, backslash-escaped backticks, line breaks) preserved byte-for-byte.

**Spec:** `docs/superpowers/specs/2026-06-01-lark-bot-skill-prompt-design.md` (commit `3b33a21`)

---

## Task 1: Create `BOT_SKILL_PROMPT` constant module

**Files:**
- Create: `src/prompts/lark-bot-skill.ts`
- Create: `tests/prompts/lark-bot-skill.test.ts`

- [ ] **Step 1.1: Write the failing content-marker test**

Create `tests/prompts/lark-bot-skill.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { BOT_SKILL_PROMPT } from '../../src/prompts/lark-bot-skill.js';

describe('BOT_SKILL_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof BOT_SKILL_PROMPT).toBe('string');
    expect(BOT_SKILL_PROMPT.length).toBeGreaterThan(2000);
  });

  it('contains the project name substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('lark-multi-cli-bridge');
    expect(BOT_SKILL_PROMPT).not.toContain('lark-channel-bridge');
  });

  it('contains the generalised CLI substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('本地 CLI（claude / codex / gemini）');
  });

  it('teaches the key conventions the LLM needs', () => {
    expect(BOT_SKILL_PROMPT).toContain('<bridge_context>');
    expect(BOT_SKILL_PROMPT).toContain('quoted_message');
    expect(BOT_SKILL_PROMPT).toContain('interactive_card');
    expect(BOT_SKILL_PROMPT).toContain('__claude_cb');
    expect(BOT_SKILL_PROMPT).toContain('lark-cli auth login');
  });

  it('content is byte-stable (snapshot guard)', () => {
    const digest = createHash('sha256').update(BOT_SKILL_PROMPT, 'utf8').digest('hex');
    expect(digest).toMatchInlineSnapshot();
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `pnpm test tests/prompts/lark-bot-skill.test.ts`
Expected: FAIL — module `../../src/prompts/lark-bot-skill.js` cannot be resolved.

- [ ] **Step 1.3: Create the prompt module with the 1:1 port**

Create `src/prompts/lark-bot-skill.ts`. The entire file is below. The body of the template literal MUST match `feishu-claude-code-bridge/src/agent/claude/adapter.ts` lines 16–151 byte-for-byte, with only the two substitutions documented at the top of this plan applied.

```ts
// SPDX-License-Identifier: MIT
//
// 1:1 port of `BRIDGE_SYSTEM_PROMPT` from
//   feishu-claude-code-bridge/src/agent/claude/adapter.ts lines 15-152
// with exactly two substitutions:
//   1. `lark-channel-bridge` -> `lark-multi-cli-bridge`
//   2. `本地 \`claude\` CLI` -> `本地 CLI（claude / codex / gemini）`
// No other edits. Headings, code fences, backslash escapes, blank lines
// preserved byte-for-byte. Changes to this string break the snapshot test
// in tests/prompts/lark-bot-skill.test.ts — that is the intended guardrail.

export const BOT_SKILL_PROMPT: string = `# lark-multi-cli-bridge 运行约定

你正在 lark-multi-cli-bridge 里跑：把飞书/Lark 用户消息桥到本地 CLI（claude / codex / gemini）。

## bridge_context

每条 user message 顶部会带一个 \`<bridge_context>\` 块：

\`\`\`
<bridge_context>
chat_id: oc_xxx
chat_type: p2p
sender_id: ou_xxx
sender_name: ...
</bridge_context>
\`\`\`

里面是当前对话的 chat_id、chat 类型（p2p / group）、发送者。这些是 bridge 注入的元数据，**不要照抄、不要在你的回复里渲染**——它对用户不可见。

## quoted_message

如果用户用"引用回复"指向某条消息，bridge 会在 \`<bridge_context>\` 后注入一个 \`<quoted_message>\` 块：

\`\`\`
<quoted_message id="om_xxx" sender_id="ou_xxx" sender_name="..." created_at="..." type="text|merge_forward|...">
（被引用消息的内容；merge_forward 类型会展开成 <forwarded_messages>...</forwarded_messages>）
</quoted_message>
\`\`\`

这是用户**指向的对象**——用户的实际问题在它之后。回答时围绕这段内容展开；它也是 bridge 注入的元数据，**不要照抄 XML 标签**到回复里。

## interactive_card

用户发 / 引用交互卡片时,bridge 会把卡的真实 JSON 注入到 \`<interactive_card>\` 块:

\`\`\`
<interactive_card>
{ "schema": "2.0", "config": { ... }, "body": { ... } }
</interactive_card>
\`\`\`

两种来源:

- **v2 CardKit (schema 2.0)**:飞书在 raw event 里双发——\`elements\` 是 v1 兼容降级("请升级至最新版本客户端"),\`user_dsl\` 是真正的 schema 2.0 DSL。bridge 优先取 \`user_dsl\`,所以你看到的就是**真卡内容**,不要被 elements 的降级文案误导
- **零文字 v1 卡**:纯按钮 / 图片 / 装饰卡,SDK 扁平化抓不到字时,bridge 把整段 raw JSON 灌进来

无论哪种,块里都是卡的完整 JSON。解析它来理解结构(按钮、字段、布局)。**不要照抄 XML 标签到回复**——对用户不可见。

## 发交互卡片（按钮、表单）的回调约定

你想发一张可交互的卡片让用户点选时：

1. 用 \`lark-cli\` 把卡发到 \`bridge_context.chat_id\`：
   \`lark-cli im send-card --chat-id <chat_id> --card '<json>'\`
2. 卡片用 CardKit 2.0 schema（\`schema: "2.0"\`）。
3. **如果你希望用户点按钮后回调到你（让你在同一会话里继续处理）**：
   - 按钮的 \`value\` 对象**必须**包含 \`__claude_cb: true\`
   - 同时可以塞任意其它字段，作为你需要在回调时记住的状态（比如 \`{"__claude_cb": true, "choice": "a", "ticket_id": "T-123"}\`）
4. 用户点击后，bridge 会把 payload（去掉 \`__claude_cb\` marker）作为 \`[card-click] {...}\` 消息发回给你；你的 session 自动续上，能看到自己上轮发了什么卡。
5. **如果只是展示卡（不需要回调）**，不要加 \`__claude_cb\`，否则点击就会触发额外的会话轮次。

示例 button：
\`\`\`json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__claude_cb": true, "choice": "a" }
  }]
}
\`\`\`

## 飞书 OAuth 授权（\`lark-cli auth login\`）

授权流程要让 \`lark-cli\` 进程一直活到用户在浏览器里点完为止。bridge 在你的 run 结束之后会回收 claude，**你 spawn 的任何后台 bash 也会跟着死**——所以授权必须用"前台阻塞"的方式跑。同时**绝不要把 \`verification_url\` 以纯 URL / 代码块形式发到任何聊天里**——发到群里谁先点谁拿走 token，会绑定到错的身份；发到 DM 也不如按钮卡好用。要发就发成"按钮卡"，群场景下还得先把卡 DM 给发送者。

### 两条统一原则

- 不发原始 \`verification_url\` 文本。要发就发一张 CardKit 2.0 卡，按钮带 \`open_url\` 行为指向 \`verification_url\`。
- 禁止用 \`run_in_background: true\` 调 \`lark-cli auth login --device-code\`——会被你 exit 时一起带走，用户还没点完就丢了。**必须前台阻塞**。

### 通用 device flow

1. 先跑 \`lark-cli auth login --no-wait --json [--recommend | --domain ... | --scope ...]\`，**这一步秒返回**，stdout JSON 里有 \`verification_url\` 和 \`device_code\`。
2. 按下方"按 chat_type 分支"把授权卡送给发起者。
3. 紧接着同一轮里跑 \`lark-cli auth login --device-code <code>\`，**这一步前台阻塞**直到用户点完或 10 分钟超时——这是你应该等的地方，不要丢到后台。

### 按 \`bridge_context.chat_type\` 分支

**\`chat_type: p2p\`（私聊）**

把授权卡发到当前 chat：

\`\`\`bash
lark-cli im +messages-send --chat-id <bridge_context.chat_id> --msg-type interactive --content '<card-json>'
\`\`\`

**\`chat_type: group\` / 话题群**

**不要在群里发任何形式的 \`verification_url\`**（连按钮卡也不发到群里）。改成把卡 DM 给发起者，群里只回一句状态：

1. 把卡 DM 给 \`bridge_context.sender_id\`：
   \`\`\`bash
   lark-cli im +messages-send --user-id <bridge_context.sender_id> --msg-type interactive --content '<card-json>'
   \`\`\`
   \`+messages-send\` 用 \`--user-id\` 时 lark-cli 会自动解 p2p 会话，不用你手动建。
2. 群里回一句明确状态（纯文本即可）："已私信你授权卡片，请到私聊里点击完成授权。"
3. 同一轮跑 \`lark-cli auth login --device-code <code>\` 前台阻塞——device flow 的轮询 endpoint 是 lark-cli 自己持有的，与卡发到哪个聊天无关，用户在浏览器里点完后这一轮会正常解锁。

### 授权卡模板

最小可用的 schema 2.0 卡（按钮 \`open_url\` 行为打开 \`verification_url\`）：

\`\`\`json
{
  "schema": "2.0",
  "config": { "summary": { "content": "Lark 授权" } },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "需要授权 \\\`lark-cli\\\` 才能继续。点下方按钮在浏览器里完成授权后回到这里。" },
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "🔐 去授权" },
        "type": "primary",
        "behaviors": [{ "type": "open_url", "default_url": "VERIFICATION_URL_HERE" }]
      }
    ]
  }
}
\`\`\`

把 \`VERIFICATION_URL_HERE\` 替换成 stdout 里拿到的 \`verification_url\` **原值**，不做 URL 编码、不做 Markdown 链接化。**不要**给按钮加 \`__claude_cb\`——这是给用户跳浏览器的 \`open_url\` 行为，不需要回调到你。

### 阻塞期间

你前台阻塞期间，用户发的新消息 bridge 会自动排队，**不会打断你**；等你 tool_result 一回来，下一批消息再进来。放心阻塞。如果用户中途想取消，他们会发 \`/stop\`——那时被 kill 是预期行为，不用兜底。
`;
```

Note for the implementer: the literal above uses the standard JS template-literal escapes (`\``, `\\\``) to preserve every backtick-quoted span and code fence from the original. After saving, open the file in a viewer that renders escapes and visually diff the *rendered* content against `feishu-claude-code-bridge/src/agent/claude/adapter.ts:16-151`. They must match except for the two substitutions.

- [ ] **Step 1.4: Run content-marker tests; let the snapshot fail with a digest**

Run: `pnpm test tests/prompts/lark-bot-skill.test.ts`
Expected:
- The 4 content-marker tests PASS.
- The snapshot test FAILS the first time with an error like:
  ```
  Error: toMatchInlineSnapshot() requires the snapshot to be defined
  ```
  …and vitest will offer to write the digest in. Either run `pnpm test tests/prompts/lark-bot-skill.test.ts -u` once (the `-u` flag updates snapshots), or paste the digest vitest printed into the `toMatchInlineSnapshot()` call manually.

After update, the test will read like:
```ts
expect(digest).toMatchInlineSnapshot(`"<64-hex-char-digest>"`);
```

- [ ] **Step 1.5: Run the full test file to confirm green**

Run: `pnpm test tests/prompts/lark-bot-skill.test.ts`
Expected: 5 passing, 0 failing.

- [ ] **Step 1.6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge
git add src/prompts/lark-bot-skill.ts tests/prompts/lark-bot-skill.test.ts
git commit -m "feat(prompts): port BOT_SKILL_PROMPT from feishu-claude-code-bridge

1:1 port of BRIDGE_SYSTEM_PROMPT (138 lines) with only two
substitutions: project name and the generalised CLI phrasing.
Adds content-marker + SHA-256 inline snapshot tests to guard against
unintended edits."
```

---

## Task 2: Add `appendSystemPrompt` opt to `CodexAdapter` (prepend strategy)

**Files:**
- Modify: `src/adapters/codex.ts:52-57` (opts interface), `src/adapters/codex.ts:79-86` (`run()` arg assembly)
- Modify: `tests/adapters/codex.test.ts` (add new describe block)

- [ ] **Step 2.1: Write the failing test**

Append a new describe block at the end of `tests/adapters/codex.test.ts`. The block uses the same fixture machinery the existing codex tests use; check the file head for the import. If a stub `spawnWithLifecycle` is already mocked there, reuse it; otherwise spy on the final spawned argv via the existing fixture pattern.

```ts
describe('CodexAdapter appendSystemPrompt', () => {
  it('prepends opts.appendSystemPrompt to ctx.prompt with separator', async () => {
    const adapter = new CodexAdapter({
      appendSystemPrompt: 'SYSTEM-INSTRUCTIONS',
      jsonMode: false, // simpler fixture; plain text mode
    });

    const capturedArgs: string[] = [];
    // Intercept the spawn so we can inspect the final argv.
    // Use the same fixture pattern already used by other codex tests
    // — if existing tests use a `withCapturedSpawn(...)` helper, call it.
    // Otherwise inline the mock: vi.mock('../../src/adapters/base.js', ...)

    const ctx: RunContext = {
      prompt: 'USER-PROMPT',
      cwd: '/tmp',
      signal: new AbortController().signal,
      idleTimeoutMs: 1000,
    };
    // drain the iterator so run() executes
    for await (const _ of adapter.run(ctx)) { /* drain */ }

    const finalPrompt = capturedArgs[capturedArgs.length - 1]; // last positional arg
    expect(finalPrompt).toBe('SYSTEM-INSTRUCTIONS\n\n---\n\nUSER-PROMPT');
  });

  it('passes ctx.prompt unchanged when appendSystemPrompt is empty/undefined', async () => {
    const adapter = new CodexAdapter({ jsonMode: false });
    // ... same harness ...
    expect(finalPrompt).toBe('USER-PROMPT');
  });
});
```

If the existing `tests/adapters/codex.test.ts` already uses a vi.mock-based approach to intercept spawns, reuse it. If not, the simplest path is to inject a fake CLI path that points at `tests/adapters/__fixtures__/echo-args.sh` (a 4-line shell script that prints `argv | jq -R .` then exits 0) and assert on the captured stdout. Look at `tests/adapters/codex.test.ts` first to see what's already wired.

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `pnpm test tests/adapters/codex.test.ts`
Expected: FAIL — `CodexAdapterOpts` has no `appendSystemPrompt` field (TypeScript will error at compile time, or runtime will pass the unchanged prompt).

- [ ] **Step 2.3: Modify `CodexAdapterOpts` and `run()`**

In `src/adapters/codex.ts`, modify the opts interface (line 52-57):

```ts
export interface CodexAdapterOpts {
  cliPath?: string;
  jsonMode?: boolean;
  model?: string;
  extraArgs?: string[];
  appendSystemPrompt?: string;
}
```

In `run()` (line 79-86), prepend the system prompt to `ctx.prompt`:

```ts
async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
  const jsonMode = this.opts.jsonMode ?? true;
  const baseArgs = ['exec', ...(jsonMode ? ['--json'] : [])];
  if (this.opts.model) baseArgs.push('--model', this.opts.model);
  if (ctx.sessionId) baseArgs.push('--session', ctx.sessionId);
  baseArgs.push(...(this.opts.extraArgs ?? []));

  const finalPrompt = this.opts.appendSystemPrompt
    ? `${this.opts.appendSystemPrompt}\n\n---\n\n${ctx.prompt}`
    : ctx.prompt;
  baseArgs.push(finalPrompt);

  // ... rest unchanged
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `pnpm test tests/adapters/codex.test.ts`
Expected: all existing codex tests still pass; the two new tests pass.

- [ ] **Step 2.5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 2.6: Commit**

```bash
git add src/adapters/codex.ts tests/adapters/codex.test.ts
git commit -m "feat(adapters/codex): add appendSystemPrompt opt (prepend to prompt)

codex exec has no native --append-system-prompt equivalent, so the
adapter prepends the system prompt to ctx.prompt with a
'\n\n---\n\n' separator before the bridge_context block."
```

---

## Task 3: Add `appendSystemPrompt` opt to `GeminiAdapter` (mirror of Task 2)

**Files:**
- Modify: `src/adapters/gemini.ts:18-22` (opts interface), `src/adapters/gemini.ts:44-49` (`run()` arg assembly)
- Modify: `tests/adapters/gemini.test.ts`

- [ ] **Step 3.1: Write the failing test**

Mirror Task 2.1's two test cases in `tests/adapters/gemini.test.ts`. The `gemini` CLI is invoked with `--prompt <text>`, so the captured argument to assert on is the value following `--prompt` in argv (not the last positional).

```ts
describe('GeminiAdapter appendSystemPrompt', () => {
  it('prepends opts.appendSystemPrompt to ctx.prompt with separator', async () => {
    const adapter = new GeminiAdapter({
      appendSystemPrompt: 'SYSTEM-INSTRUCTIONS',
    });
    // ... capture argv as in codex test ...
    const promptIdx = capturedArgs.indexOf('--prompt');
    expect(capturedArgs[promptIdx + 1]).toBe('SYSTEM-INSTRUCTIONS\n\n---\n\nUSER-PROMPT');
  });

  it('passes ctx.prompt unchanged when appendSystemPrompt is empty/undefined', async () => {
    const adapter = new GeminiAdapter({});
    // ...
    expect(capturedArgs[promptIdx + 1]).toBe('USER-PROMPT');
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `pnpm test tests/adapters/gemini.test.ts`
Expected: FAIL.

- [ ] **Step 3.3: Modify `GeminiAdapterOpts` and `run()`**

In `src/adapters/gemini.ts`, modify the opts interface (line 18-22):

```ts
export interface GeminiAdapterOpts {
  cliPath?: string;
  model?: string;
  extraArgs?: string[];
  appendSystemPrompt?: string;
}
```

In `run()` (replace line 45):

```ts
async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
  const finalPrompt = this.opts.appendSystemPrompt
    ? `${this.opts.appendSystemPrompt}\n\n---\n\n${ctx.prompt}`
    : ctx.prompt;
  const args = ['--prompt-interactive=false', '--prompt', finalPrompt];
  if (this.opts.model) args.push('--model', this.opts.model);
  if (ctx.sessionId) args.push('--chat-id', ctx.sessionId);
  args.push(...(this.opts.extraArgs ?? []));
  // ... rest unchanged
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `pnpm test tests/adapters/gemini.test.ts`
Expected: all green.

- [ ] **Step 3.5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3.6: Commit**

```bash
git add src/adapters/gemini.ts tests/adapters/gemini.test.ts
git commit -m "feat(adapters/gemini): add appendSystemPrompt opt (prepend to --prompt)

gemini --prompt has no native system-instruction flag, so the adapter
prepends the system prompt with a '\n\n---\n\n' separator before the
user's prompt text."
```

---

## Task 4: Extend each backend sub-schema with `injectSkillPrompt` + `appendSystemPrompt`

**Files:**
- Modify: `src/config/schema.ts:22-46` (three backend sub-schemas)
- Modify: `tests/config/schema.test.ts`

- [ ] **Step 4.1: Write failing schema tests**

Append to `tests/config/schema.test.ts`:

```ts
describe('per-backend skill-prompt config', () => {
  it('claude backend accepts injectSkillPrompt + appendSystemPrompt', () => {
    const bot = {
      ...minimalClaudeBot,
      backend: {
        type: 'claude',
        claude: { permission_mode: 'bypassPermissions' },
        injectSkillPrompt: false,
        appendSystemPrompt: 'extra instructions',
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'claude') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBe(false);
    expect(parsed.backend.appendSystemPrompt).toBe('extra instructions');
  });

  it('codex backend accepts injectSkillPrompt + appendSystemPrompt', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [] },
        injectSkillPrompt: true,
        appendSystemPrompt: 'codex-specific',
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBe(true);
    expect(parsed.backend.appendSystemPrompt).toBe('codex-specific');
  });

  it('gemini backend accepts the same two fields', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'gemini-bot',
      backend: {
        type: 'gemini',
        gemini: { extra_args: [] },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'gemini') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBeUndefined();
    expect(parsed.backend.appendSystemPrompt).toBeUndefined();
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `pnpm test tests/config/schema.test.ts`
Expected: FAIL — type narrowing on `parsed.backend.injectSkillPrompt` errors (or zod parse silently drops the unknown field).

- [ ] **Step 4.3: Add the two fields to each backend sub-schema**

In `src/config/schema.ts`, modify each of the three backend sub-schemas. The two new fields are **siblings** of `type:` and the per-backend sub-block (not nested under `claude` / `codex` / `gemini`). They are `optional()` **without** `default()` — the default-on behaviour is applied in the registry (per spec §7.1, keeps absent fields out of config files):

```ts
const ClaudeBackendSchema = z.object({
  type: z.literal('claude'),
  claude: z.object({
    model: z.string().optional(),
    permission_mode: z.enum(['default', 'bypassPermissions', 'plan']).default('bypassPermissions'),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});

const CodexBackendSchema = z.object({
  type: z.literal('codex'),
  codex: z.object({
    model: z.string().optional(),
    json_mode: z.boolean().default(true),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});

const GeminiBackendSchema = z.object({
  type: z.literal('gemini'),
  gemini: z.object({
    model: z.string().optional(),
    extra_args: z.array(z.string()).default([]),
  }),
  injectSkillPrompt: z.boolean().optional(),
  appendSystemPrompt: z.string().optional(),
});
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `pnpm test tests/config/schema.test.ts`
Expected: all three new tests pass; all four existing tests still pass.

- [ ] **Step 4.5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4.6: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(config): add per-backend injectSkillPrompt + appendSystemPrompt

Optional fields on each backend sub-schema; absent = use registry
default (true for injectSkillPrompt, '' for appendSystemPrompt).
Per-backend rather than shared so codex/gemini bots can disable the
OAuth-heavy section in the future without affecting claude."
```

---

## Task 5: Wire the registry to compute the effective prompt and pass it to each adapter

**Files:**
- Modify: `src/adapters/registry.ts` (rewrite the body of `buildAdapter`)
- Create: `tests/adapters/registry.test.ts`

- [ ] **Step 5.1: Write the failing registry test**

Create `tests/adapters/registry.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildAdapter } from '../../src/adapters/registry.js';
import { BOT_SKILL_PROMPT } from '../../src/prompts/lark-bot-skill.js';
import type { BotConfig } from '../../src/config/schema.js';

const baseClaudeBot: BotConfig = {
  name: 'claude-bot',
  enabled: true,
  lark: { app_id: 'cli_x', app_secret: 's', tenant: 'lark' },
  backend: {
    type: 'claude',
    claude: { permission_mode: 'bypassPermissions', extra_args: [] },
  },
  access: { allowed_users: [], allowed_chats: [], admins: [] },
  behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
};

describe('buildAdapter — effective system prompt resolution', () => {
  it('defaults to injecting BOT_SKILL_PROMPT when injectSkillPrompt is absent', () => {
    const adapter = buildAdapter(baseClaudeBot);
    // Cross-check via the opts the adapter was constructed with.
    // Each adapter stores its opts on `this.opts`; expose for tests.
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });

  it('omits the skill prompt when injectSkillPrompt is false', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, injectSkillPrompt: false } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt ?? '').toBe('');
  });

  it('concatenates appendSystemPrompt after the skill prompt when both set', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, appendSystemPrompt: 'EXTRA' } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT + '\n\n' + 'EXTRA');
  });

  it('uses only appendSystemPrompt when skill-prompt is disabled', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, injectSkillPrompt: false, appendSystemPrompt: 'EXTRA' } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt).toBe('EXTRA');
  });

  it('passes the same effective prompt into codex adapter', () => {
    const codexBot: BotConfig = {
      ...baseClaudeBot,
      name: 'codex-bot',
      backend: { type: 'codex', codex: { json_mode: true, extra_args: [] } },
    };
    const adapter = buildAdapter(codexBot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });

  it('passes the same effective prompt into gemini adapter', () => {
    const geminiBot: BotConfig = {
      ...baseClaudeBot,
      name: 'gemini-bot',
      backend: { type: 'gemini', gemini: { extra_args: [] } },
    };
    const adapter = buildAdapter(geminiBot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `pnpm test tests/adapters/registry.test.ts`
Expected: FAIL — `(adapter as any).opts.appendSystemPrompt` is `undefined` for all cases because the registry doesn't pass it yet.

- [ ] **Step 5.3: Rewrite `buildAdapter` to compute and inject the effective prompt**

Replace `src/adapters/registry.ts` with:

```ts
// SPDX-License-Identifier: MIT
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { BOT_SKILL_PROMPT } from '../prompts/lark-bot-skill.js';
import type { Adapter } from './types.js';
import type { BotConfig } from '../config/schema.js';

function resolveSystemPrompt(backend: BotConfig['backend']): string {
  const inject = backend.injectSkillPrompt ?? true;
  const skill = inject ? BOT_SKILL_PROMPT : '';
  const extra = backend.appendSystemPrompt ?? '';
  if (skill && extra) return `${skill}\n\n${extra}`;
  return skill || extra;
}

export function buildAdapter(bot: BotConfig): Adapter {
  const appendSystemPrompt = resolveSystemPrompt(bot.backend);
  switch (bot.backend.type) {
    case 'claude': {
      const cfg = bot.backend.claude;
      return new ClaudeAdapter({
        permissionMode: cfg.permission_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
    case 'codex': {
      const cfg = bot.backend.codex;
      return new CodexAdapter({
        jsonMode: cfg.json_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
    case 'gemini': {
      const cfg = bot.backend.gemini;
      return new GeminiAdapter({
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
  }
}
```

Note: the conditional spread `...(appendSystemPrompt ? { appendSystemPrompt } : {})` is required because `exactOptionalPropertyTypes` is on — passing `undefined` to an `appendSystemPrompt?: string` field is a compile error.

The three Adapter classes all store their opts on `this.opts` via the constructor (`constructor(private opts: ...Opts = {})`). For tests to inspect `appendSystemPrompt`, they read `(adapter as any).opts.appendSystemPrompt`. The `as any` cast is acceptable in tests; do not change adapter visibility.

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `pnpm test tests/adapters/registry.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5.5: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (existing + new). No regressions in claude/codex/gemini adapter tests or schema tests.

- [ ] **Step 5.6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5.7: Commit**

```bash
git add src/adapters/registry.ts tests/adapters/registry.test.ts
git commit -m "feat(adapters/registry): inject effective system prompt into every backend

buildAdapter() now resolves BOT_SKILL_PROMPT + appendSystemPrompt at
construction time and passes the concatenation to each adapter's
appendSystemPrompt opt. Default-on; bot YAML can opt out via
backend.injectSkillPrompt: false."
```

---

## Task 6: Make `cmd` optional in the card-action parser

**Files:**
- Modify: `src/lark/card-action.ts:3-10` (interface), `src/lark/card-action.ts:58-59` (early-return)
- Modify: `tests/lark/card-action.test.ts`

- [ ] **Step 6.1: Write the failing test**

Append to `tests/lark/card-action.test.ts`:

```ts
describe('parseCardActionEvent — __claude_cb buttons (no cmd)', () => {
  it('parses a button whose value has only __claude_cb (no cmd)', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_chat3',
      open_message_id: 'om_msg3',
      action: { tag: 'button', value: { __claude_cb: true, choice: 'a' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed).toBeDefined();
    expect(parsed?.chatId).toBe('oc_chat3');
    expect(parsed?.cmd).toBeUndefined();
    expect(parsed?.value).toEqual({ __claude_cb: true, choice: 'a' });
  });

  it('still parses a button with both cmd and __claude_cb', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_chat4',
      open_message_id: 'om_msg4',
      action: { value: { __claude_cb: true, cmd: 'something' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed?.cmd).toBe('something');
    expect(parsed?.value).toEqual({ __claude_cb: true, cmd: 'something' });
  });
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `pnpm test tests/lark/card-action.test.ts`
Expected: FAIL — the no-cmd test returns `undefined` because the current parser short-circuits when `cmd` is absent.

- [ ] **Step 6.3: Make `cmd` optional and drop the early-return**

In `src/lark/card-action.ts`, change the interface:

```ts
export interface CardActionEvent {
  chatId: string;
  messageId: string;
  operatorOpenId: string;
  cmd?: string;                          // value.cmd (optional — absent for LLM-emitted __claude_cb buttons)
  value: Record<string, unknown>;       // full value object for context
  receivedAt: string;
}
```

In the same file, replace the early-return block (lines 58-59):

```ts
// Old:
const cmd = asStr(value['cmd']);
if (!cmd) return undefined;

// New:
const cmd = asStr(value['cmd']);
```

And in the returned object, conditionally include `cmd`:

```ts
return {
  chatId,
  messageId,
  operatorOpenId,
  ...(cmd !== undefined ? { cmd } : {}),
  value,
  receivedAt: new Date().toISOString(),
};
```

(The conditional spread is required by `exactOptionalPropertyTypes`.)

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `pnpm test tests/lark/card-action.test.ts`
Expected: all 5 tests pass (3 existing + 2 new).

- [ ] **Step 6.5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. **Note:** this change might trigger a downstream type error in `src/worker/index.ts:150` where `switch (act.cmd)` is now switching on `string | undefined`. That's expected and will be fixed in Task 7. If `pnpm typecheck` reports a worker error, proceed to Task 7 — the worker changes there resolve it. If you want a green typecheck for Task 6 alone, temporarily change the switch line to `switch (act.cmd ?? '')` and revert it in Task 7. Prefer the latter (keep typecheck green at every commit).

- [ ] **Step 6.6: Commit**

```bash
git add src/lark/card-action.ts tests/lark/card-action.test.ts src/worker/index.ts
git commit -m "feat(lark/card-action): make value.cmd optional

LLM-emitted callback buttons (value.__claude_cb: true) may have no
'cmd' field. Parser no longer rejects such payloads. Worker now
guards switch(act.cmd ?? '') to keep typecheck green until Task 7
adds the __claude_cb branch."
```

---

## Task 7: Add `__claude_cb` branch — extract card-action handler, test it, wire it

**Files:**
- Create: `src/worker/card-action-handler.ts`
- Create: `tests/worker/card-action-handler.test.ts`
- Modify: `src/worker/index.ts:141-159` (replace inline handler with call to extracted module)

The current handler is inline inside `runWorker()` and references several closures (`bot.access`, `dispatcher`, `log`, `lastIngressByChat`, etc.). To make it testable we extract it into a pure factory that takes its dependencies as arguments and returns the listener function.

- [ ] **Step 7.1: Write the failing handler test**

Create `tests/worker/card-action-handler.test.ts`:

```ts
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { makeCardActionHandler } from '../../src/worker/card-action-handler.js';
import type { CardActionEvent } from '../../src/lark/card-action.js';
import type { IngressMessage } from '../../src/lark/types.js';
import type { AccessConfig } from '../../src/config/schema.js';

const silentLog = pino({ level: 'silent' });

function makeAccess(overrides: Partial<AccessConfig> = {}): AccessConfig {
  return { allowed_users: ['ou_alice'], allowed_chats: [], admins: [], ...overrides };
}

describe('makeCardActionHandler — __claude_cb branch', () => {
  it('enqueues a [card-click] message when value.__claude_cb is true', async () => {
    const enqueue = vi.fn(async () => {});
    const abort = vi.fn(() => false);
    const lastIngressByChat = new Map<string, IngressMessage>();
    lastIngressByChat.set('oc_chat', {
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_alice',
      messageId: 'om_prev',
      text: 'irrelevant',
      mentions: [],
      rawType: 'text',
      attachments: [],
      receivedAt: '2026-06-01T00:00:00Z',
    });

    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat,
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    const evt: CardActionEvent = {
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true, choice: 'a' },
      receivedAt: '2026-06-01T00:00:01Z',
    };
    await handler(evt);

    expect(abort).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = enqueue.mock.calls[0]![0];
    expect(call.chatId).toBe('oc_chat');
    expect(call.prompt).toBe('[card-click] {"choice":"a"}');
  });

  it('drops the __claude_cb marker key from the synth prompt', async () => {
    const enqueue = vi.fn(async () => {});
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort: vi.fn() } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true, x: 1, y: 'z' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    const prompt = (enqueue.mock.calls[0]![0] as any).prompt;
    expect(prompt).toBe('[card-click] {"x":1,"y":"z"}');
    expect(prompt).not.toContain('__claude_cb');
  });

  it('still calls dispatcher.abort for value.cmd === "stop"', async () => {
    const enqueue = vi.fn(async () => {});
    const abort = vi.fn(() => true);
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      cmd: 'stop',
      value: { cmd: 'stop' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(abort).toHaveBeenCalledWith('oc_chat');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('drops events from unauthorized users', async () => {
    const enqueue = vi.fn(async () => {});
    const abort = vi.fn();
    const handler = makeCardActionHandler({
      access: makeAccess({ allowed_users: ['ou_other'] }),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('prefers __claude_cb over cmd when both are present', async () => {
    // If the LLM emits a button with both markers, the LLM wins.
    const enqueue = vi.fn(async () => {});
    const abort = vi.fn();
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      cmd: 'stop',
      value: { __claude_cb: true, cmd: 'stop' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(abort).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `pnpm test tests/worker/card-action-handler.test.ts`
Expected: FAIL — module `../../src/worker/card-action-handler.js` cannot be resolved.

- [ ] **Step 7.3: Create the extracted handler module**

Create `src/worker/card-action-handler.ts`:

```ts
// SPDX-License-Identifier: MIT
import type { Logger } from 'pino';
import type { CardActionEvent } from '../lark/card-action.js';
import type { Dispatcher } from './dispatcher.js';
import type { IngressMessage } from '../lark/types.js';
import type { AccessConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import { isAuthorized } from '../auth/access-control.js';

export interface CardActionHandlerDeps {
  access: AccessConfig;
  dispatcher: Pick<Dispatcher, 'enqueue' | 'abort'>;
  log: Logger;
  lastIngressByChat: Map<string, IngressMessage>;
  sessions: Pick<SessionStore, 'get'>;
  botDefaultCwd: string;
  botBackendType: string;
  idleTimeoutMs: number;
  appOwnerOpenId?: string;
}

export function makeCardActionHandler(deps: CardActionHandlerDeps): (act: CardActionEvent) => Promise<void> {
  return async (act) => {
    const { access, dispatcher, log, lastIngressByChat, sessions, botDefaultCwd, idleTimeoutMs, appOwnerOpenId } = deps;

    log.info({ chatId: act.chatId, cmd: act.cmd, operator: act.operatorOpenId }, 'card action');

    if (!isAuthorized({
      access,
      senderOpenId: act.operatorOpenId,
      chatId: act.chatId,
      ...(appOwnerOpenId ? { appOwnerOpenId } : {}),
    })) {
      log.info({ chatId: act.chatId, sender: act.operatorOpenId }, 'card-action dropped: unauthorized');
      return;
    }

    // Priority 1: LLM callback marker. If both __claude_cb and cmd are set,
    // the LLM wins — don't preempt user-authored flows with our internal cmds.
    if (act.value['__claude_cb'] === true) {
      const stripped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(act.value)) {
        if (k !== '__claude_cb') stripped[k] = v;
      }
      const synthPrompt = `[card-click] ${JSON.stringify(stripped)}`;

      const existing = sessions.get(act.chatId);
      const cwd = existing?.cwd ?? botDefaultCwd;

      log.info({ chatId: act.chatId, synthPrompt }, 'card-action: __claude_cb -> enqueue');
      try {
        await dispatcher.enqueue({
          chatId: act.chatId,
          prompt: synthPrompt,
          cwd,
          ...(existing?.sessionId !== undefined ? { sessionId: existing.sessionId } : {}),
          idleTimeoutMs,
        });
      } catch (err) {
        log.error({ err: (err as Error).message }, '__claude_cb dispatch failed');
      }
      return;
    }

    // Priority 2: internal slash-command buttons (preserved).
    switch (act.cmd) {
      case 'stop': {
        const aborted = dispatcher.abort(act.chatId);
        log.info({ chatId: act.chatId, aborted }, 'stop action');
        break;
      }
      default:
        log.info({ cmd: act.cmd }, 'unknown card action');
    }
  };
}
```

Notes:
- `AccessConfig` is the inferred zod type — it's not currently exported. If `import type { AccessConfig }` errors, add the export to `src/config/schema.ts`:
  ```ts
  export type AccessConfig = z.infer<typeof AccessSchema>;
  ```
- `lastIngressByChat` is passed in for future use (e.g., enriching the synth prompt with bridge_context). Right now the handler does not read it — but the bridge_context is auto-prefixed by the existing `dispatcher.prefixPrompt` callback in `worker/index.ts:116-120`, **but only when a prior IngressMessage exists for the chat**. For a card-click with no prior IngressMessage, the prefixPrompt is a no-op, and the LLM sees just `[card-click] {...}` without bridge_context. That's acceptable for callback turns — the session is already resumed and the LLM remembers the original card context. Leaving `lastIngressByChat` in the deps for symmetry with future tasks; remove it if linter complains about an unused arg.

- [ ] **Step 7.4: Run the test to verify it passes**

Run: `pnpm test tests/worker/card-action-handler.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 7.5: Wire the extracted handler into `worker/index.ts`**

In `src/worker/index.ts`, add the import near the other worker imports (around line 27):

```ts
import { makeCardActionHandler } from './card-action-handler.js';
```

Replace lines 141-159 (the inline `ws.on('card-action', ...)` handler):

```ts
ws.on('card-action', makeCardActionHandler({
  access: bot.access,
  dispatcher,
  log,
  lastIngressByChat,
  sessions,
  botDefaultCwd: resolveCwd(bot.behavior.default_cwd),
  botBackendType: bot.backend.type,
  idleTimeoutMs: bot.behavior.idle_timeout_seconds * 1000,
  ...(appOwnerOpenId ? { appOwnerOpenId } : {}),
}));
```

Also revert the `switch (act.cmd ?? '')` workaround from Task 6.5 if you applied it — the handler now lives inside the extracted module and is typed correctly. (Or just keep it — both compile.)

- [ ] **Step 7.6: Run the full test suite + typecheck**

Run:
```bash
pnpm test
pnpm typecheck
```
Expected: all tests pass; typecheck clean.

- [ ] **Step 7.7: Build to confirm no bundler regressions**

Run: `pnpm build`
Expected: exit 0; `dist/` produced.

- [ ] **Step 7.8: Commit**

```bash
git add src/worker/card-action-handler.ts src/worker/index.ts tests/worker/card-action-handler.test.ts src/config/schema.ts
git commit -m "feat(worker): __claude_cb card callback re-enters LLM session

Extract card-action handler into a testable factory and add a
__claude_cb priority branch: when an LLM-emitted button's value
contains __claude_cb: true, strip the marker and dispatcher.enqueue
a synthetic '[card-click] {...}' message so the same session
resumes. Internal slash-command buttons (value.cmd) unchanged."
```

---

## Task 8: README + version bump + final full-suite run

**Files:**
- Modify: `README.md` (add a section under "Configuration")
- Modify: `package.json` (version → 0.7.0)
- Modify: `CHANGELOG.md` if present, else create

- [ ] **Step 8.1: Update README**

Open `README.md` and locate the "Configuration" / "Bot YAML" section (search for `backend:`). Append a new subsection. Exact content to insert (use this verbatim):

````markdown
### Skill prompt injection

Every bot, regardless of backend, gets a bundled bot-skill prompt
injected by default. It teaches the LLM about the bridge's
`<bridge_context>` / `<quoted_message>` / `<interactive_card>` blocks,
how to send interactive cards via the local `lark-cli` (including
button callbacks via the `__claude_cb` marker), and how to drive
`lark-cli auth login` device flow safely.

Two per-backend YAML fields control injection:

```yaml
backend:
  type: codex
  codex:
    extra_args: []
  injectSkillPrompt: true        # default; set to false to disable
  appendSystemPrompt: |          # optional, concatenated AFTER the skill prompt
    Additional instructions specific to this bot.
```

Injection mechanism per backend:
- `claude`: `--append-system-prompt <text>` flag
- `codex`, `gemini`: prepended to the prompt with `\n\n---\n\n` separator

### LLM card-button callbacks (`__claude_cb`)

When the LLM emits an interactive card with a button whose `value`
contains `__claude_cb: true`, clicking the button re-enters the same
LLM session with a synthetic `[card-click] {...}` message (the marker
is stripped before forwarding). This lets the LLM build multi-step
flows where the user picks from buttons.

Example button (CardKit 2.0):

```json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__claude_cb": true, "choice": "a" }
  }]
}
```

Buttons **without** `__claude_cb` (e.g., the bridge's own `/status`
buttons) continue to dispatch through the internal command router as
before — they are not seen by the LLM.
````

- [ ] **Step 8.2: Bump version**

Edit `package.json` and change:

```diff
-  "version": "0.6.1",
+  "version": "0.7.0",
```

(Verify the current version first with `node -p "require('./package.json').version"` — substitute the actual current value in the diff.)

- [ ] **Step 8.3: Run the full local pipeline**

Run sequentially:
```bash
cd /Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge
pnpm typecheck
pnpm test
pnpm build
```
Expected: all three commands exit 0. Note the new test count vs the baseline (111 before this plan) — should be 111 + ~16 new tests = ~127.

- [ ] **Step 8.4: Commit (no tag yet — defer to user)**

```bash
git add README.md package.json
git commit -m "chore: bump to 0.7.0; document skill prompt + __claude_cb callback"
```

**Do not** run `git tag` or `git push` in this step. The user gates tagging via a separate "提交打 tag" instruction (per the durable user preference logged in memory). When the user says go, they will run something like:

```bash
git tag -a v0.7.0 -m "feat: bot skill prompt + __claude_cb callback"
git push origin main --follow-tags
```

---

## Verification (manual acceptance tests)

After Task 8 commit lands, perform these manual checks before tagging:

1. **Group identity** — In a group with `wl-claude-bot` and one human, ask the bot `请列出群里所有机器人`. Expect: the bot calls `lark-cli im chats +members --chat-id <id>` (or similar), parses the result, and replies with a list naming the human and itself. Pre-v0.7.0 it cannot do this.

2. **`__claude_cb` round-trip** — Ask the bot to send a callback card (e.g., `给我发一张让我选 A 或 B 的卡，按钮带 __claude_cb`). Expect: card arrives; clicking "A" causes the bot to reply with a follow-up message that references the choice. Pre-v0.7.0 the click does nothing visible.

3. **Opt-out** — Edit one bot YAML to set `backend.injectSkillPrompt: false`, restart the supervisor, and ask the same group-identity question. Expect: the bot does NOT use `lark-cli` and replies with something like "我看不到群成员" — proving the prompt was the lever.

4. **Existing slash commands** — Send `/status`, then click the "新会话" / "断线重连" buttons in the resulting status card. Expect: same pre-v0.7.0 behavior (each button triggers the corresponding internal command, NOT the LLM). This confirms `__claude_cb` did not break the internal dispatch path.

If all four pass, the work is shippable.

---

## Self-Review Checklist (run this after writing — not in execution)

**Spec coverage:**
- §5.1 BOT_SKILL_PROMPT module → Task 1
- §5.2 Schema fields → Task 4
- §5.3 Registry resolution → Task 5
- §5.4 Per-backend injection (claude=flag, codex/gemini=prepend) → Tasks 2, 3, 5
- §5.5 Card-action handler `__claude_cb` branch → Task 7
- §5.6 Card-action parser `cmd` optional → Task 6
- §9 Testing strategy 5 layers → covered (Task 1 prompt, Task 4 schema, Task 5 registry, Task 6 parser, Task 7 handler)

**Type consistency:**
- `BOT_SKILL_PROMPT: string` everywhere (Task 1)
- `injectSkillPrompt?: boolean` and `appendSystemPrompt?: string` on backend (Task 4) — exact same names in registry (Task 5)
- All three adapters' `appendSystemPrompt?: string` opt — exact same shape (Tasks 2, 3 + pre-existing Claude)
- `CardActionEvent.cmd?: string` (Task 6) — handler reads `act.cmd` with the optional shape (Task 7)
- `value: Record<string, unknown>` and reads `value['__claude_cb']` with `=== true` strict-equality check
- Synth prompt format: `[card-click] ${JSON.stringify(stripped)}` — exact same in test (Task 7.1) and implementation (Task 7.3)

**No placeholders:**
- Inline `toMatchInlineSnapshot()` is intentionally empty; vitest fills it on first run (documented in Step 1.4).
- All other steps contain literal code, exact commands, expected outputs.
