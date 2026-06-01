// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { renderRunCard } from '../../src/lark/card-builder.js';
import { createRunState, appendText, addTool, finishTool, finalize } from '../../src/lark/run-state.js';

describe('renderRunCard', () => {
  it('streaming mode + stop button while running, no header bar', () => {
    const s = createRunState();
    appendText(s, 'Hello');
    const card = renderRunCard(s);
    expect(card.schema).toBe('2.0');
    const json = JSON.stringify(card);
    expect(json).toContain('streaming_mode');
    expect(json).toContain('Hello');
    expect(json).toContain('终止');
    // No top-level header bar
    expect(json).not.toContain('"template"');
  });

  it('done state: no stop button, summary says 已完成', () => {
    const s = createRunState();
    appendText(s, 'Hi');
    finalize(s, { kind: 'done' });
    const card = renderRunCard(s);
    const json = JSON.stringify(card);
    expect(json).not.toContain('终止');
    expect(json).toContain('已完成');
  });

  it('error state shows the agent failed line', () => {
    const s = createRunState();
    finalize(s, { kind: 'error', errorMsg: 'context length exceeded' });
    const card = renderRunCard(s);
    expect(JSON.stringify(card)).toContain('context length exceeded');
  });

  it('collapses 3+ tool calls into a summary panel', () => {
    const s = createRunState();
    addTool(s, { id: 't1', name: 'Read', input: { file_path: 'a.ts' } });
    finishTool(s, 't1', 'done');
    addTool(s, { id: 't2', name: 'Write', input: { file_path: 'b.ts' } });
    finishTool(s, 't2', 'done');
    addTool(s, { id: 't3', name: 'Bash', input: { command: 'ls' } });
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('个工具调用');
  });

  it('streaming_mode is false in terminal state', () => {
    const s = createRunState();
    appendText(s, 'content');
    finalize(s, { kind: 'done' });
    const card = renderRunCard(s) as Record<string, unknown>;
    const config = card['config'] as Record<string, unknown>;
    expect(config['streaming_mode']).toBe(false);
  });

  it('streaming_mode is true while running', () => {
    const s = createRunState();
    appendText(s, 'partial');
    const card = renderRunCard(s) as Record<string, unknown>;
    const config = card['config'] as Record<string, unknown>;
    expect(config['streaming_mode']).toBe(true);
  });

  it('interrupted state shows 已被中断 notation', () => {
    const s = createRunState();
    finalize(s, { kind: 'interrupted' });
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('已被中断');
    expect(json).toContain('已中断');
  });

  it('idle_timeout state shows minutes and 已超时', () => {
    const s = createRunState();
    finalize(s, { kind: 'idle_timeout', idleTimeoutMinutes: 5 });
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('5');
    expect(json).toContain('已超时');
  });

  it('done with no content shows 未返回内容', () => {
    const s = createRunState();
    finalize(s, { kind: 'done' });
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('未返回内容');
  });

  it('reasoning panel appears when thinking text is present', () => {
    const s = createRunState();
    s.reasoning = { content: 'deep thought', active: true };
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('思考中');
    expect(json).toContain('deep thought');
  });

  it('footer status shows 正在思考 when footer is thinking', () => {
    const s = createRunState();
    // Default footer is thinking
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('正在思考');
  });

  it('footer status shows 正在输出 when text is streaming', () => {
    const s = createRunState();
    appendText(s, 'some text');
    const json = JSON.stringify(renderRunCard(s));
    expect(json).toContain('正在输出');
  });
});
