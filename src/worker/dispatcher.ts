// SPDX-License-Identifier: MIT
import type { Adapter } from '../adapters/types.js';
import type { CardStreamer } from './card-streamer.js';

export class UserStopError extends Error {
  readonly userStop = true;
  constructor() {
    super('user /stop');
    this.name = 'UserStopError';
  }
}

export interface DispatcherOpts {
  adapter: Adapter;
  makeStreamer: (chatId: string) => Pick<
    CardStreamer,
    'start' | 'onTextDelta' | 'onToolCall' | 'onToolResult' | 'onError' | 'onDone' | 'onInterrupted'
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
  pending: DispatchRequest[];
  processing: boolean;
  current: { ac: AbortController; promise: Promise<void> } | undefined;
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
    lane.current.ac.abort(new UserStopError());
    return true;
  }

  async enqueue(req: DispatchRequest): Promise<void> {
    const lane = this.getLane(req.chatId);
    lane.pending.push(req);
    if (!lane.processing) {
      void this.kickProcessor(lane);
    }
  }

  private async kickProcessor(lane: ChatLane): Promise<void> {
    if (lane.processing) return;
    lane.processing = true;
    try {
      while (lane.pending.length > 0) {
        // Wait the batch window so rapid follow-ups can coalesce.
        await new Promise<void>((resolve) => setTimeout(resolve, this.windowMs).unref());
        if (lane.pending.length === 0) continue;

        const batch = lane.pending.splice(0, lane.pending.length);
        const head = batch[0]!;
        const merged: DispatchRequest = { ...head, prompt: batch.map((b) => b.prompt).join('\n\n') };

        const ac = new AbortController();
        lane.current = { ac, promise: this.dispatchOne(merged, ac.signal) };
        try {
          await lane.current.promise;
        } catch {
          // dispatchOne handles errors via streamer; swallow here so the loop continues.
        } finally {
          lane.current = undefined;
        }
      }
    } finally {
      lane.processing = false;
    }
  }

  private getLane(chatId: string): ChatLane {
    let lane = this.lanes.get(chatId);
    if (!lane) {
      lane = { pending: [], processing: false, current: undefined };
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
            if (signal.aborted && signal.reason instanceof UserStopError) {
              await streamer.onInterrupted('user_stop');
            } else {
              await streamer.onError(ev.message);
            }
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
      if (err instanceof UserStopError) {
        await streamer.onInterrupted('user_stop');
      } else {
        await streamer.onError((err as Error).message);
      }
    }
  }
}
