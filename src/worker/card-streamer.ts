// SPDX-License-Identifier: MIT
import { renderRunCard } from '../lark/card-builder.js';
import { createRunState, appendText, appendThinking, addTool, finishTool, finalize } from '../lark/run-state.js';
import type { RunState } from '../lark/run-state.js';

export interface CardSink {
  create(card: unknown): Promise<string>;
  patch(cardId: string, card: unknown): Promise<void>;
}

export interface CardStreamerOpts {
  sink: CardSink;
  throttleMs: number;
  throttleChars: number;
}

export class CardStreamer {
  private cardId?: string;
  private state: RunState = createRunState();
  private flushTimer: NodeJS.Timeout | undefined;
  private dirty = false;
  private charsSinceFlush = 0;

  constructor(private opts: CardStreamerOpts) {}

  async start(): Promise<void> {
    this.state = createRunState();
    const card = renderRunCard(this.state);
    this.cardId = await this.opts.sink.create(card);
    this.dirty = false;
    this.charsSinceFlush = 0;
  }

  async onTextDelta(text: string): Promise<void> {
    appendText(this.state, text);
    this.dirty = true;
    this.charsSinceFlush += text.length;
    if (this.charsSinceFlush >= this.opts.throttleChars) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref?.();
    }
  }

  onThinkingDelta(text: string): void {
    appendThinking(this.state, text);
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref?.();
    }
  }

  onToolCall(callId: string, name: string, input: unknown): void {
    addTool(this.state, { id: callId, name, input });
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref?.();
    }
  }

  onToolResult(callId: string, ok: boolean, output?: string): void {
    finishTool(this.state, callId, ok ? 'done' : 'error', output);
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref?.();
    }
  }

  async onError(message: string): Promise<void> {
    finalize(this.state, { kind: 'error', errorMsg: message });
    this.dirty = true;
    await this.flush({ force: true });
  }

  async onDone(opts: { finalText: string; durationMs: number; usage?: { inputTokens?: number; outputTokens?: number } }): Promise<void> {
    // If the final text is longer than what we've accumulated, replace last text block.
    if (opts.finalText) {
      const lastBlock = this.state.blocks[this.state.blocks.length - 1];
      if (!lastBlock || lastBlock.kind !== 'text' || lastBlock.content !== opts.finalText) {
        // Only override if significantly different (finalText is the ground truth)
        if (opts.finalText.length > 0) {
          const textBlocks = this.state.blocks.filter((b) => b.kind === 'text');
          if (textBlocks.length === 0) {
            this.state.blocks = [{ kind: 'text', content: opts.finalText, streaming: false }];
          }
        }
      }
    }
    finalize(this.state, { kind: 'done' });
    this.dirty = true;
    await this.flush({ force: true });
  }

  private async flush(opts: { force?: boolean } = {}): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.cardId) return;
    if (!this.dirty && !opts.force) return;
    const card = renderRunCard(this.state);
    await this.opts.sink.patch(this.cardId, card);
    this.dirty = false;
    this.charsSinceFlush = 0;
  }
}
