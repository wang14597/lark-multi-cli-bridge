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
        ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
        signal: ac.signal,
        idleTimeoutMs: req.idleTimeoutMs,
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
