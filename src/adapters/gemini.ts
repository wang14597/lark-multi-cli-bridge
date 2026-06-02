// SPDX-License-Identifier: MIT
import { spawnWithLifecycle } from './base.js';
import type { Adapter, AdapterEvent, AdapterPreflight, RunContext } from './types.js';

// Matches CSI/SGR ANSI escape sequences.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * Plain-text fallback parser. Used when jsonMode is disabled or for edge
 * cases where gemini emits text without going through `-o stream-json`.
 * Just strips ANSI and yields the chunk as one text-delta.
 */
export function* chunkToEvents(chunk: string): Iterable<AdapterEvent> {
  const text = stripAnsi(chunk);
  if (!text) return;
  yield { type: 'text-delta', text };
}

// Shape of a single line emitted by `gemini -o stream-json` (0.44+).
interface GeminiStreamLine {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'result';
  // init
  session_id?: string;
  model?: string;
  // message
  role?: 'user' | 'assistant' | string;
  content?: string;
  delta?: boolean;
  // tool_use / tool_result
  tool_name?: string;
  tool_id?: string;
  parameters?: unknown;
  output?: string;
  // result
  status?: 'success' | 'error' | string;
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached?: number;
    duration_ms?: number;
    tool_calls?: number;
  };
  error?: { type?: string; message?: string } | string;
}

/**
 * Gemini's tool_result lines carry only tool_id, not tool_name. The id is
 * formatted as `<name>__<name>_<timestamp>_<index>` (verified on 0.44.1),
 * so we slice off the first `__` to recover the human-readable tool name
 * for AdapterEvent.tool-result.name. If the format changes upstream, the
 * dedicated test in gemini.test.ts will catch it.
 */
function toolNameFromId(toolId: string): string {
  const i = toolId.indexOf('__');
  return i === -1 ? toolId : toolId.slice(0, i);
}

/**
 * Map a single stream-json line to zero or more AdapterEvents.
 *
 * Shape summary (per gemini-cli 0.44.1):
 *   init    -> session-start { sessionId }
 *   message (role=user)            -> ignored (prompt echo)
 *   message (role=assistant, delta) -> text-delta { text }
 *   result  (status=success)        -> done { sessionId, finalText, usage }
 *   result  (status=error)          -> error { message }
 *
 * Robust to unknown future types: an unrecognised `type` yields nothing
 * rather than throwing, so parser bumps in future gemini versions degrade
 * gracefully (text-delta stream just stops contributing instead of
 * crashing the worker).
 */
export function* parseGeminiJsonLine(line: string): Iterable<AdapterEvent> {
  let obj: GeminiStreamLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }

  if (obj.type === 'init' && typeof obj.session_id === 'string') {
    yield { type: 'session-start', sessionId: obj.session_id };
    return;
  }
  if (obj.type === 'message') {
    if (obj.role === 'assistant' && typeof obj.content === 'string' && obj.content.length > 0) {
      yield { type: 'text-delta', text: obj.content };
    }
    return;
  }
  if (obj.type === 'tool_use' && typeof obj.tool_id === 'string' && typeof obj.tool_name === 'string') {
    yield {
      type: 'tool-call',
      callId: obj.tool_id,
      name: obj.tool_name,
      input: obj.parameters ?? {},
    };
    return;
  }
  if (obj.type === 'tool_result' && typeof obj.tool_id === 'string') {
    const ok = obj.status === 'success';
    const summary = typeof obj.output === 'string' ? obj.output : undefined;
    yield {
      type: 'tool-result',
      callId: obj.tool_id,
      name: toolNameFromId(obj.tool_id),
      ok,
      ...(summary !== undefined ? { summary } : {}),
    };
    return;
  }
  if (obj.type === 'result') {
    if (obj.status === 'error') {
      const msg =
        typeof obj.error === 'string'
          ? obj.error
          : obj.error?.message ?? 'gemini reported error result';
      yield { type: 'error', message: msg, recoverable: false };
      return;
    }
    // success — sessionId / finalText are patched in by the adapter (the
    // parser doesn't see them at line-parse time).
    yield {
      type: 'done',
      sessionId: '',
      finalText: '',
      ...(obj.stats
        ? {
            usage: {
              ...(obj.stats.input_tokens !== undefined
                ? { inputTokens: obj.stats.input_tokens }
                : {}),
              ...(obj.stats.output_tokens !== undefined
                ? { outputTokens: obj.stats.output_tokens }
                : {}),
            },
          }
        : {}),
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface GeminiAdapterOpts {
  cliPath?: string;
  /**
   * Use `-o stream-json` (default true). When false, the adapter falls
   * back to plain ANSI-stripped text-delta streaming — useful for
   * gemini versions older than 0.42 that lack the flag, or for ad-hoc
   * debugging.
   */
  jsonMode?: boolean;
  model?: string;
  extraArgs?: string[];
  appendSystemPrompt?: string;
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
    const jsonMode = this.opts.jsonMode ?? true;

    // gemini -p has no native system-instruction flag, so prepend
    // the system prompt to ctx.prompt with a '\n\n---\n\n' separator.
    const finalPrompt = this.opts.appendSystemPrompt
      ? `${this.opts.appendSystemPrompt}\n\n---\n\n${ctx.prompt}`
      : ctx.prompt;

    const args: string[] = [];
    if (jsonMode) args.push('-o', 'stream-json');
    // Bridge bots commonly run with cwds that aren't a trusted workspace;
    // --skip-trust avoids the per-session approval prompt that would
    // otherwise block headless runs.
    args.push('--skip-trust');
    args.push('--prompt', finalPrompt);
    if (this.opts.model) args.push('--model', this.opts.model);
    // Session continuation: gemini 0.44 accepts UUID for --resume even
    // though `--help` only documents "latest" / index. First-turn dispatches
    // omit --resume entirely so gemini auto-mints a new session_id (which
    // we capture from the `init` event and write back via session-start).
    //
    // Guard against legacy non-UUID sessionIds (the pre-0.44 adapter wrote
    // `gemini-${Date.now()}` into SessionStore as a placeholder). Passing
    // those to --resume would fail with "Session ID … not found"; treat
    // them as no-session so a real UUID is minted on this turn and
    // overwrites the placeholder via onSessionUpdate.
    if (ctx.sessionId && isUuid(ctx.sessionId)) args.push('--resume', ctx.sessionId);
    args.push(...(this.opts.extraArgs ?? []));

    let finalText = '';
    let sessionId = ctx.sessionId ?? '';
    let doneEmitted = false;

    try {
      for await (const line of spawnWithLifecycle(this.opts.cliPath ?? 'gemini', args, {
        cwd: ctx.cwd,
        env: { ...process.env, ...ctx.env },
        signal: ctx.signal,
        idleTimeoutMs: ctx.idleTimeoutMs,
      })) {
        if (jsonMode) {
          for (const ev of parseGeminiJsonLine(line)) {
            if (ev.type === 'session-start') sessionId = ev.sessionId;
            if (ev.type === 'text-delta') finalText += ev.text;
            if (ev.type === 'done') {
              doneEmitted = true;
              // Patch in the running sessionId + accumulated finalText —
              // result.success doesn't carry them per-line.
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
          for (const ev of chunkToEvents(line + '\n')) {
            if (ev.type === 'text-delta') finalText += ev.text;
            yield ev;
          }
        }
      }
      // Stream ended without `result`. In jsonMode this is unusual (gemini
      // always emits a final result event), but for plain mode it's
      // expected. Synthesize a `done` so card streamers can finalize.
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
