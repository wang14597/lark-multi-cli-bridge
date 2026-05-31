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
  resolveIdleTimeoutMs?: (chatId: string) => number | undefined;
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
  windowTimer: NodeJS.Timeout | undefined;
  current: { ac: AbortController; promise: Promise<void> } | undefined;
  windowResolver: (() => void) | undefined;
  windowPromise: Promise<void> | undefined;
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

  async enqueue(req: DispatchRequest): Promise<void> {
    const lane = this.getLane(req.chatId);

    if (lane.current) {
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
      lane = { pending: [], windowTimer: undefined, current: undefined, windowResolver: undefined, windowPromise: undefined };
      this.lanes.set(chatId, lane);
    }
    return lane;
  }

  private async dispatchOne(req: DispatchRequest, signal: AbortSignal): Promise<void> {
    const streamer = this.opts.makeStreamer(req.chatId);
    await streamer.start();
    const startedAt = Date.now();
    const overrideIdle = this.opts.resolveIdleTimeoutMs?.(req.chatId);
    const idleMs = overrideIdle ?? req.idleTimeoutMs;
    const prompt = this.opts.prefixPrompt?.(req.chatId, req.prompt) ?? req.prompt;

    try {
      for await (const ev of this.opts.adapter.run({
        prompt,
        cwd: req.cwd,
        ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
        signal,
        idleTimeoutMs: idleMs,
        ...(req.env !== undefined ? { env: req.env } : {}),
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
              ...(ev.usage !== undefined ? { usage: ev.usage } : {}),
            });
            break;
        }
      }
    } catch (err) {
      await streamer.onError((err as Error).message);
    }
  }
}
