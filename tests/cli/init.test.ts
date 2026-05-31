// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { validateAppId, validateBotName, parseBackendChoice } from '../../src/cli/commands/init.js';

describe('init wizard helpers', () => {
  it('validateAppId accepts cli_<alnum>', () => {
    expect(validateAppId('cli_abc123XYZ')).toBeUndefined();
  });
  it('validateAppId rejects garbage', () => {
    expect(validateAppId('not-an-app')).toBeDefined();
    expect(validateAppId('')).toBeDefined();
  });
  it('validateBotName accepts lowercase kebab', () => {
    expect(validateBotName('claude-bot')).toBeUndefined();
  });
  it('validateBotName rejects uppercase', () => {
    expect(validateBotName('ClaudeBot')).toBeDefined();
  });
  it('parseBackendChoice accepts number and name', () => {
    expect(parseBackendChoice('1')).toBe('claude');
    expect(parseBackendChoice('codex')).toBe('codex');
    expect(parseBackendChoice('GEMINI')).toBe('gemini');
    expect(parseBackendChoice('garbage')).toBeUndefined();
  });
});
