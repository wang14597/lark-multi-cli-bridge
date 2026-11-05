// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  CONCLUSION_SCHEMA,
  CONCLUSION_GUIDANCE,
  CONCLUSION_PROMPT_HINT,
  parseConclusionJson,
  looksLikeJson,
} from '../../src/adapters/conclusion.js';

describe('parseConclusionJson', () => {
  it('returns the trimmed conclusion', () => {
    expect(parseConclusionJson('{"conclusion":" 好了 "}')).toBe('好了');
  });
  it.each(['{"conclusion":""}', '{"x":1}', '{"conclusion":', 'plain text'])(
    'returns undefined for %s',
    (t) => {
      expect(parseConclusionJson(t)).toBeUndefined();
    },
  );
});

describe('looksLikeJson', () => {
  it('detects leading { or [', () => {
    expect(looksLikeJson(' {"a"')).toBe(true);
    expect(looksLikeJson('[1]')).toBe(true);
    expect(looksLikeJson('卡片已建')).toBe(false);
  });
});

describe('CONCLUSION_SCHEMA', () => {
  it('is strict and requires conclusion', () => {
    expect(CONCLUSION_SCHEMA.additionalProperties).toBe(false);
    expect(CONCLUSION_SCHEMA.required).toEqual(['conclusion']);
    expect(CONCLUSION_SCHEMA).toMatchObject({
      type: 'object',
      properties: { conclusion: { type: 'string', description: CONCLUSION_GUIDANCE } },
    });
  });
  it('hint embeds the guidance', () => {
    expect(CONCLUSION_PROMPT_HINT).toContain(CONCLUSION_GUIDANCE);
  });
});
