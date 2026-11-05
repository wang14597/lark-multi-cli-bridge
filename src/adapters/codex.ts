// SPDX-License-Identifier: MIT
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnWithLifecycle } from './base.js';
import { CONCLUSION_SCHEMA, looksLikeJson, parseConclusionJson } from './conclusion.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

interface CodexJsonLine {
  type: string;
  // legacy (<=0.129) fields
  session_id?: string;
  role?: string;
  text?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
  // 0.130.0+ fields
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    // command_execution (verified on 0.162.1)
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
}

// Written once per process; codex reads it on every conclusion-mode run.
let conclusionSchemaFile: string | undefined;
function getConclusionSchemaFile(): string {
  if (!conclusionSchemaFile) {
    const f = join(tmpdir(), 'lmcb-conclusion-schema.json');
    writeFileSync(f, JSON.stringify(CONCLUSION_SCHEMA));
    conclusionSchemaFile = f;
  }
  return conclusionSchemaFile;
}

// Shared across calls so parseCodexJsonLine can attach the most recent
// thread_id (from thread.started) to a later turn.completed's `done`
// event, since 0.130.0's turn.completed does not echo the thread id.
let lastThreadId = '';

export function* parseCodexJsonLine(line: string): Iterable<AdapterEvent> {
  let obj: CodexJsonLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  // codex 0.130.0+ schema
  if (obj.type === 'thread.started' && obj.thread_id) {
    lastThreadId = obj.thread_id;
    yield { type: 'session-start', sessionId: obj.thread_id };
    return;
  }
  if (obj.type === 'turn.started') {
    return;
  }
  if (obj.type === 'item.started' && obj.item?.type === 'command_execution' && obj.item.id) {
    yield { type: 'tool-call', callId: obj.item.id, name: 'Bash', input: obj.item };
    return;
  }
  if (obj.type === 'item.completed' && obj.item) {
    const item = obj.item;
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      yield { type: 'text-delta', text: item.text };
    } else if (item.type === 'reasoning' && typeof item.text === 'string') {
      yield { type: 'thinking', text: item.text };
    } else if (item.type === 'command_execution' && item.id) {
      yield {
        type: 'tool-result',
        callId: item.id,
        name: 'Bash',
        ok: item.exit_code === 0 && item.status !== 'failed',
        ...(typeof item.aggregated_output === 'string' ? { summary: item.aggregated_output } : {}),
      };
    }
    return;
  }
  if (obj.type === 'turn.completed') {
    yield {
      type: 'done',
      sessionId: lastThreadId,
      finalText: '',
      ...(obj.usage
        ? {
            usage: {
              ...(obj.usage.input_tokens !== undefined
                ? { inputTokens: obj.usage.input_tokens }
                : {}),
              ...(obj.usage.output_tokens !== undefined
                ? { outputTokens: obj.usage.output_tokens }
                : {}),
            },
          }
        : {}),
    };
    return;
  }
  if (obj.type === 'thread.ended') {
    return;
  }

  // legacy schema (<=0.129)
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
      ...(obj.usage
        ? {
            usage: {
              ...(obj.usage.input_tokens !== undefined
                ? { inputTokens: obj.usage.input_tokens }
                : {}),
              ...(obj.usage.output_tokens !== undefined
                ? { outputTokens: obj.usage.output_tokens }
                : {}),
            },
          }
        : {}),
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
  appendSystemPrompt?: string;
  skipGitRepoCheck?: boolean;
  // Default ON. When true the adapter passes
  // `--dangerously-bypass-approvals-and-sandbox`, granting codex the same
  // full machine + network access as claude's bypassPermissions default.
  // Skipped automatically if extraArgs already carries a sandbox/approval flag.
  bypassSandbox?: boolean;
}

// Sandbox/approval flags codex exec understands. If the user wired any of
// these into extraArgs we defer to their explicit choice instead of forcing
// the bypass flag on top (which would conflict or double up).
const CODEX_SANDBOX_FLAGS = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--sandbox',
  '-s',
  '--ask-for-approval',
  '-a',
  '--full-auto',
  '--yolo',
];

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
    // codex 0.130.0 removed `--session <id>`. Session continuation is now a
    // subcommand: `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`.
    const baseArgs: string[] = ['exec'];
    if (ctx.sessionId) baseArgs.push('resume');
    if (jsonMode) baseArgs.push('--json');
    // codex exec refuses to run outside a git repo (or trusted dir) without this flag.
    // Default on for bridge use: bots commonly point at $HOME or other non-repo cwds.
    if ((this.opts.skipGitRepoCheck ?? true) === true) baseArgs.push('--skip-git-repo-check');
    if (this.opts.model) baseArgs.push('--model', this.opts.model);
    // Bypass codex's OS sandbox + approval prompts by default (parity with
    // claude's bypassPermissions), unless the user already controls the
    // sandbox via their own extraArgs flag.
    const extraArgs = this.opts.extraArgs ?? [];
    const userControlsSandbox = extraArgs.some((a) => CODEX_SANDBOX_FLAGS.includes(a));
    if ((this.opts.bypassSandbox ?? true) === true && !userControlsSandbox) {
      baseArgs.push('--dangerously-bypass-approvals-and-sandbox');
    }
    // codex runs shell commands via a login shell, and macOS's login-shell
    // PATH reordering pushes the bridge's per-bot lark-cli shim behind the real
    // binary — codex then uses the default lark profile instead of this bot's.
    // A non-login shell keeps the inherited PATH (shim first).
    if (!extraArgs.some((a) => a.startsWith('allow_login_shell=')))
      baseArgs.push('-c', 'allow_login_shell=false');
    baseArgs.push(...extraArgs);
    if (ctx.conclusion) baseArgs.push('--output-schema', getConclusionSchemaFile());
    // resume subcommand takes SESSION_ID as a positional arg before PROMPT.
    if (ctx.sessionId) baseArgs.push(ctx.sessionId);

    // codex exec has no native --append-system-prompt equivalent, so prepend
    // the system prompt to ctx.prompt with a '\n\n---\n\n' separator.
    const finalPrompt = this.opts.appendSystemPrompt
      ? `${this.opts.appendSystemPrompt}\n\n---\n\n${ctx.prompt}`
      : ctx.prompt;
    baseArgs.push(finalPrompt);

    let finalText = '';
    let sessionId = ctx.sessionId ?? '';
    let doneEmitted = false;
    // Each agent_message is a whole message; the parser is stateless, so
    // paragraph breaks between back-to-back messages are added here.
    let prevWasText = false;

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
            if (ev.type === 'done') {
              doneEmitted = true;
              prevWasText = false;
              const text = ev.finalText || finalText;
              // --output-schema makes the last message the JSON object; a
              // resumed run may still answer in prose. Truncated JSON → none.
              const conclusion = ctx.conclusion
                ? (parseConclusionJson(text) ??
                  (looksLikeJson(text) ? undefined : text.trim() || undefined))
                : undefined;
              // Patch in the running sessionId and last message since the
              // parser doesn't see them at line-parse time.
              yield {
                ...ev,
                sessionId: ev.sessionId || sessionId,
                finalText: text,
                ...(conclusion ? { conclusion } : {}),
              };
              continue;
            }
            if (ev.type === 'text-delta') {
              // run() needs codex >=0.130 (`exec resume`), where every
              // text-delta is a whole agent_message.
              finalText = ev.text;
              yield prevWasText ? { type: 'text-delta', text: `\n\n${ev.text}` } : ev;
              prevWasText = true;
              continue;
            }
            prevWasText = false;
            yield ev;
          }
        } else {
          for (const ev of parsePlainChunk(line + '\n')) {
            if (ev.type === 'text-delta') finalText += ev.text;
            yield ev;
          }
        }
      }
      // Stream ended cleanly. If no `done` came through (jsonMode without
      // a recognised terminal event, or plain mode), synthesize one so
      // downstream card streamers can mark the turn complete instead of
      // sitting on "thinking" forever.
      if (!doneEmitted) {
        yield { type: 'done', sessionId, finalText };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'UserStopError') {
        throw err;
      }
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
