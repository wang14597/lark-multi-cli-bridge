// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { BOT_SKILL_PROMPT } from '../../src/prompts/lark-bot-skill.js';

describe('BOT_SKILL_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof BOT_SKILL_PROMPT).toBe('string');
    expect(BOT_SKILL_PROMPT.length).toBeGreaterThan(2000);
  });

  it('contains the project name substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('lark-multi-cli-bridge');
    expect(BOT_SKILL_PROMPT).not.toContain('lark-channel-bridge');
  });

  it('contains the generalised CLI substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('本地 CLI（claude / codex / gemini）');
  });

  it('teaches the key conventions the LLM needs', () => {
    expect(BOT_SKILL_PROMPT).toContain('<bridge_context>');
    expect(BOT_SKILL_PROMPT).toContain('quoted_message');
    expect(BOT_SKILL_PROMPT).toContain('interactive_card');
    expect(BOT_SKILL_PROMPT).toContain('__claude_cb');
    expect(BOT_SKILL_PROMPT).toContain('lark-cli auth login');
  });

  it('content is byte-stable (snapshot guard)', () => {
    const digest = createHash('sha256').update(BOT_SKILL_PROMPT, 'utf8').digest('hex');
    expect(digest).toMatchInlineSnapshot(`"5b0e59f18fef48559f1bc8cdc4d548535396172fd6b42c8b102eafa31f62ceed"`);
  });
});
