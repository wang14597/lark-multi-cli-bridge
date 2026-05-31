// SPDX-License-Identifier: MIT
import { buildStreamingCard, type ToolCallRow } from '../lark/card-builder.js';

export interface CardSink {
  create(card: unknown): Promise<string>;
  patch(cardId: string, card: unknown): Promise<void>;
}

export interface CardStreamerOpts {
  header: string;
  sink: CardSink;
  throttleMs: number;
  throttleChars: number;
}

export class CardStreamer {
  private cardId?: string;
  private buf = '';
  private toolCalls = new Map<string, ToolCallRow>();
  private flushTimer: NodeJS.Timeout | undefined;
  private startTime = Date.now();
  private state: 'thinking' | 'streaming' | 'done' | 'error' = 'thinking';
  private dirty = false;
  constructor(private opts: CardStreamerOpts) {}

  async start(): Promise<void> {
    const card = buildStreamingCard({ header: this.opts.header, bodyMarkdown: '', state: 'thinking' });
    this.cardId = await this.opts.sink.create(card);
  }

  async onTextDelta(text: string): Promise<void> {
    this.buf += text;
    this.state = 'streaming';
    this.dirty = true;
    if (this.buf.length >= this.opts.throttleChars) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.throttleMs);
      this.flushTimer.unref();
    }
  }

  onToolCall(callId: string, name: string, input: unknown): void {
    const summary = summarizeToolInput(name, input);
    this.toolCalls.set(callId, { name, ...(summary ? { summary } : {}), done: false });
    this.dirty = true;
  }

  onToolResult(callId: string, ok: boolean): void {
    const existing = this.toolCalls.get(callId);
    if (!existing) return;
    this.toolCalls.set(callId, { ...existing, done: true, ok });
    this.dirty = true;
  }

  async onError(message: string): Promise<void> {
    this.state = 'error';
    this.buf += `\n\n[error] ${message}`;
    this.dirty = true;
    await this.flush({ force: true });
  }

  async onDone(opts: { finalText: string; durationMs: number; usage?: { inputTokens?: number; outputTokens?: number } }): Promise<void> {
    this.state = 'done';
    if (opts.finalText.length > this.buf.length) this.buf = opts.finalText;
    const tokens = opts.usage?.outputTokens !== undefined ? `${(opts.usage.outputTokens / 1000).toFixed(1)}k tokens` : '';
    const duration = `${(opts.durationMs / 1000).toFixed(1)}s`;
    const footer = [duration, tokens].filter(Boolean).join(' | ');
    this.dirty = true;
    await this.flush({ force: true, footer });
  }

  private async flush(opts: { force?: boolean; footer?: string } = {}): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.cardId) return;
    if (!this.dirty && !opts.force) return;
    const card = buildStreamingCard({
      header: this.opts.header,
      bodyMarkdown: this.buf,
      state: this.state,
      toolCalls: Array.from(this.toolCalls.values()),
      ...(opts.footer ? { footer: opts.footer } : {}),
    });
    await this.opts.sink.patch(this.cardId, card);
    this.dirty = false;
  }
}

function summarizeToolInput(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj['file_path'] === 'string') return obj['file_path'];
    if (typeof obj['command'] === 'string') return obj['command'].slice(0, 80);
    if (typeof obj['path'] === 'string') return obj['path'];
  }
  return '';
}
