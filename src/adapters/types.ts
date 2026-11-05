// SPDX-License-Identifier: MIT
export type BackendType = 'claude' | 'codex' | 'gemini';

export interface Attachment {
  kind: 'image' | 'file';
  localPath: string;
  fileName: string;
  mimeType?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface RunContext {
  prompt: string;
  cwd: string;
  sessionId?: string;
  attachments?: Attachment[];
  signal: AbortSignal;
  env?: Record<string, string>;
  idleTimeoutMs: number;
  /** Ask the CLI for a dedicated final conclusion (see conclusion.ts). */
  conclusion?: boolean;
}

export type AdapterEvent =
  | { type: 'session-start'; sessionId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; name: string; input: unknown; callId: string }
  | { type: 'tool-result'; callId: string; name: string; ok: boolean; summary?: string }
  | { type: 'thinking'; text?: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | {
      type: 'done';
      finalText: string;
      sessionId: string;
      usage?: TokenUsage;
      conclusion?: string;
      isError?: boolean;
    };

export interface AdapterPreflight {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface Adapter {
  readonly backend: BackendType;
  preflight(): Promise<AdapterPreflight>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
