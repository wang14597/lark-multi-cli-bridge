// SPDX-License-Identifier: MIT
import { looksLikeJson } from '../adapters/conclusion.js';
import { renderConclusionPost } from '../lark/conclusion-post.js';
import type { ReplySink } from './lark-sink.js';

export interface ConclusionStreamerOpts {
  sink: ReplySink;
  mentionOpenId?: string;
  log?: { warn(o: object, m: string): void };
}

const NO_CONCLUSION = '已完成，但没有返回结论';

const WORKING_EMOJI = 'OnIt';

/** /mode final: an OnIt reaction while running, then one plain reply with the conclusion. No card. */
export class ConclusionStreamer {
  private reactionId: string | undefined;
  private settled = false;

  constructor(private opts: ConclusionStreamerOpts) {}

  async start(): Promise<void> {
    try {
      this.reactionId = await this.opts.sink.react(WORKING_EMOJI);
    } catch (err) {
      this.opts.log?.warn({ err }, 'adding the working reaction failed');
    }
  }

  // Intermediate events are intentionally dropped in final mode.
  async onTextDelta(_text: string): Promise<void> {}
  onThinkingDelta(_text: string): void {}
  onToolCall(_callId: string, _name: string, _input: unknown): void {}
  onToolResult(_callId: string, _ok: boolean, _output?: string): void {}

  // /stop already replies "aborted current run"; just clear the reaction.
  async onInterrupted(_reason: 'preempt' | 'user_stop'): Promise<void> {
    if (this.settle()) await this.clearReaction();
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

  // Never throws: a failed send is logged, and the reaction is cleared either way.
  private async conclude(text: string): Promise<void> {
    try {
      await this.opts.sink.sendPost(renderConclusionPost(text, this.opts.mentionOpenId));
    } catch (err) {
      this.opts.log?.warn({ err }, 'sending conclusion failed');
    }
    await this.clearReaction();
  }

  private async clearReaction(): Promise<void> {
    if (!this.reactionId) return;
    try {
      await this.opts.sink.unreact(this.reactionId);
    } catch (err) {
      this.opts.log?.warn({ err }, 'removing the working reaction failed');
    }
  }
}
