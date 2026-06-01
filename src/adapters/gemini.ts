// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

// Matches CSI/SGR ANSI escape sequences.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

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
      if (err instanceof Error && (err.name === 'PreemptError' || err.name === 'UserStopError')) {
        throw err;
      }
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
