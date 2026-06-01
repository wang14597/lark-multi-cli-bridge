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
        yield { type: 'thinking', ...(block.text !== undefined ? { text: block.text } : {}) };
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
      ...(obj.usage
        ? {
            usage: {
              ...(obj.usage.input_tokens !== undefined ? { inputTokens: obj.usage.input_tokens } : {}),
              ...(obj.usage.output_tokens !== undefined ? { outputTokens: obj.usage.output_tokens } : {}),
              ...(obj.usage.cache_read_input_tokens !== undefined ? { cachedInputTokens: obj.usage.cache_read_input_tokens } : {}),
            },
          }
        : {}),
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
      if (err instanceof Error && (err.name === 'PreemptError' || err.name === 'UserStopError')) {
        throw err;
      }
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
  }
}
