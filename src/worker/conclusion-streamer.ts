// SPDX-License-Identifier: MIT
import { looksLikeJson } from '../adapters/conclusion.js';
import { renderConclusionCard, renderNoteCard, renderPendingCard } from '../lark/conclusion-card.js';
import type { CardSink } from './card-streamer.js';

export interface ConclusionStreamerOpts {
  sink: CardSink;
  mentionOpenId?: string;
  log?: { warn(o: object, m: string): void };
}

const NO_CONCLUSION = '已完成，但没有返回结论';

/** /mode final: one pending card, rewritten in place into the conclusion (no recall — users found it jarring). */
export class ConclusionStreamer {
  private statusId?: string;
  private settled = false;

  constructor(private opts: ConclusionStreamerOpts) {}

  async start(): Promise<void> {
    this.statusId = await this.opts.sink.create(renderPendingCard());
  }

  // Intermediate events are intentionally dropped in final mode.
  async onTextDelta(_text: string): Promise<void> {}
  onThinkingDelta(_text: string): void {}
  onToolCall(_callId: string, _name: string, _input: unknown): void {}
  onToolResult(_callId: string, _ok: boolean, _output?: string): void {}

  async onInterrupted(_reason: 'preempt' | 'user_stop'): Promise<void> {
    if (this.settle() && this.statusId) {
      await this.opts.sink.patch(this.statusId, renderNoteCard('已停止'));
    }
  }

  async onError(message: string): Promise<void> {
    if (this.settle()) await this.conclude(`⚠️ 没办成：${message}`);
  }

  async onDone(opts: {
    finalText: string;
    durationMs: number;
    usage?: { inputTokens?: number; outputTokens?: number };
    conclusion?: string;
    isError?: boolean;
  }): Promise<void> {
    if (!this.settle()) return;
    if (opts.isError) {
      const detail = looksLikeJson(opts.finalText) ? '' : opts.finalText;
      return this.conclude(`⚠️ 没办成：${detail || '未知错误'}`);
    }
    const fallback = opts.finalText.trim();
    await this.conclude(opts.conclusion || (fallback && !looksLikeJson(fallback) ? fallback : NO_CONCLUSION));
  }

  /** First terminal event wins: a failed claude run emits done(isError) and then error(exit 1). */
  private settle(): boolean {
    if (this.settled) return false;
    this.settled = true;
    return true;
  }

  // Never throws. Edits in place (no push); falls back to a new message so the result is still visible.
  private async conclude(text: string): Promise<void> {
    const { sink, mentionOpenId, log } = this.opts;
    const card = renderConclusionCard(text, mentionOpenId);
    if (this.statusId) {
      try {
        await sink.patch(this.statusId, card);
        return;
      } catch (err) {
        log?.warn({ err }, 'patching status card with the conclusion failed; sending it as a new message');
      }
    }
    try {
      await sink.create(card);
    } catch (err) {
      log?.warn({ err }, 'sending conclusion message failed');
    }
  }
}
