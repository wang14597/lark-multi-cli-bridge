// SPDX-License-Identifier: MIT

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolEntry {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry };

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null;
export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout';

export interface RunState {
  blocks: Block[];
  reasoning: { content: string; active: boolean };
  footer: FooterStatus;
  terminal: Terminal;
  errorMsg?: string;
  idleTimeoutMinutes?: number;
}

export function createRunState(): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    footer: 'thinking',
    terminal: 'running',
  };
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  );
}

export function appendThinking(state: RunState, delta: string): void {
  state.reasoning = { content: state.reasoning.content + delta, active: true };
  state.footer = 'thinking';
}

export function appendText(state: RunState, delta: string): void {
  const last = state.blocks[state.blocks.length - 1];
  if (last && last.kind === 'text' && last.streaming) {
    state.blocks[state.blocks.length - 1] = { ...last, content: last.content + delta };
  } else {
    state.blocks = [
      ...closeStreamingText(state.blocks),
      { kind: 'text', content: delta, streaming: true },
    ];
  }
  state.reasoning = { ...state.reasoning, active: false };
  state.footer = 'streaming';
}

export function addTool(state: RunState, opts: { id: string; name: string; input: unknown }): void {
  const tool: ToolEntry = { id: opts.id, name: opts.name, input: opts.input, status: 'running' };
  state.blocks = [...closeStreamingText(state.blocks), { kind: 'tool', tool }];
  state.reasoning = { ...state.reasoning, active: false };
  state.footer = 'tool_running';
}

export function finishTool(state: RunState, id: string, status: 'done' | 'error', output?: string): void {
  state.blocks = state.blocks.map((b) => {
    if (b.kind !== 'tool' || b.tool.id !== id) return b;
    return {
      ...b,
      tool: {
        ...b.tool,
        status,
        ...(output !== undefined ? { output } : {}),
      },
    };
  });
}

export interface FinalizeOpts {
  kind: 'done' | 'error' | 'interrupted' | 'idle_timeout';
  errorMsg?: string;
  idleTimeoutMinutes?: number;
}

export function finalize(state: RunState, opts: FinalizeOpts): void {
  state.blocks = closeStreamingText(state.blocks);
  state.reasoning = { ...state.reasoning, active: false };
  state.terminal = opts.kind;
  state.footer = null;
  if (opts.kind === 'error' && opts.errorMsg !== undefined) {
    state.errorMsg = opts.errorMsg;
  }
  if (opts.kind === 'idle_timeout' && opts.idleTimeoutMinutes !== undefined) {
    state.idleTimeoutMinutes = opts.idleTimeoutMinutes;
  }
}
