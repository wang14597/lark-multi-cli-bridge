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

    // codex exec has no native --append-system-prompt equivalent, so prepend
    // the system prompt to ctx.prompt with a '\n\n---\n\n' separator.
    const finalPrompt = this.opts.appendSystemPrompt
      ? `${this.opts.appendSystemPrompt}\n\n---\n\n${ctx.prompt}`
      : ctx.prompt;
    baseArgs.push(finalPrompt);

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
      if (!jsonMode) {
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
