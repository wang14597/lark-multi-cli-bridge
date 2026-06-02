// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
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
  item?: { id?: string; type?: string; text?: string; name?: string };
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
  if (obj.type === 'item.completed' && obj.item) {
    if (obj.item.type === 'agent_message' && typeof obj.item.text === 'string') {
      yield { type: 'text-delta', text: obj.item.text };
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
              ...(obj.usage.input_tokens !== undefined ? { inputTokens: obj.usage.input_tokens } : {}),
              ...(obj.usage.output_tokens !== undefined ? { outputTokens: obj.usage.output_tokens } : {}),
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
              ...(obj.usage.input_tokens !== undefined ? { inputTokens: obj.usage.input_tokens } : {}),
              ...(obj.usage.output_tokens !== undefined ? { outputTokens: obj.usage.output_tokens } : {}),
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
    // codex 0.130.0 removed `--session <id>`. Session continuation is now a
    // subcommand: `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`.
    const baseArgs: string[] = ['exec'];
    if (ctx.sessionId) baseArgs.push('resume');
    if (jsonMode) baseArgs.push('--json');
    // codex exec refuses to run outside a git repo (or trusted dir) without this flag.
    // Default on for bridge use: bots commonly point at $HOME or other non-repo cwds.
    if ((this.opts.skipGitRepoCheck ?? true) === true) baseArgs.push('--skip-git-repo-check');
    if (this.opts.model) baseArgs.push('--model', this.opts.model);
    baseArgs.push(...(this.opts.extraArgs ?? []));
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
            if (ev.type === 'done') {
              doneEmitted = true;
              // Patch in the running sessionId and accumulated finalText
              // since the parser doesn't see them at line-parse time.
              yield {
                ...ev,
                sessionId: ev.sessionId || sessionId,
                finalText: ev.finalText || finalText,
              };
              continue;
            }
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
