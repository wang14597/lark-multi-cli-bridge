// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { BOT_SKILL_PROMPT } from '../../src/prompts/lark-bot-skill.js';

describe('BOT_SKILL_PROMPT', () => {
  it('is a non-empty string within the always-on budget', () => {
    expect(typeof BOT_SKILL_PROMPT).toBe('string');
    // After slimming the prompt to only always-on essentials (the three
    // injected blocks); deeper protocols moved into the lark-bridge-overlay
    // agent skill. Floor guards against accidental content wipe; ceiling
    // catches anyone tempted to re-inline the overlay content here.
    expect(BOT_SKILL_PROMPT.length).toBeGreaterThan(1000);
    expect(BOT_SKILL_PROMPT.length).toBeLessThan(2500);
  });

  it('contains the project name substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('lark-multi-cli-bridge');
    expect(BOT_SKILL_PROMPT).not.toContain('lark-channel-bridge');
  });

  it('contains the generalised CLI substitution', () => {
    expect(BOT_SKILL_PROMPT).toContain('本地 CLI（claude / codex / gemini）');
  });

  it('teaches the key conventions the LLM needs to recognize', () => {
    // The prompt no longer inlines protocol details for __claude_cb and
    // `lark-cli auth login` — but it MUST still mention them by name so
    // the LLM knows these scenarios exist and the overlay skill is where
    // to find the rules.
    expect(BOT_SKILL_PROMPT).toContain('<bridge_context>');
    expect(BOT_SKILL_PROMPT).toContain('quoted_message');
    expect(BOT_SKILL_PROMPT).toContain('interactive_card');
    expect(BOT_SKILL_PROMPT).toContain('__claude_cb');
    expect(BOT_SKILL_PROMPT).toContain('lark-cli auth login');
    expect(BOT_SKILL_PROMPT).toContain('lark-bridge-overlay');
  });

  it('content is byte-stable (snapshot guard)', () => {
    const digest = createHash('sha256').update(BOT_SKILL_PROMPT, 'utf8').digest('hex');
    expect(digest).toMatchInlineSnapshot(`"645a131260bf814e90c1f6d9197906f4f5205da23f936ac249bc5448bc409869"`);
  });
});
