// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { normalizeMarkdown } from '../../src/lark/markdown-normalize.js';

describe('normalizeMarkdown', () => {
  it('separates two prose lines that were joined by a single newline', () => {
    // The codex-density case: labeled lines on single newlines render as a
    // wall in Lark's markdown widget; a blank line makes them real paragraphs.
    expect(normalizeMarkdown('证据：foo\n影响：bar')).toBe('证据：foo\n\n影响：bar');
  });

  it('adds a blank line before a list but keeps the items tight', () => {
    expect(normalizeMarkdown('intro\n- a\n- b')).toBe('intro\n\n- a\n- b');
  });

  it('adds a blank line after a list before the following paragraph', () => {
    expect(normalizeMarkdown('- a\n- b\ntail')).toBe('- a\n- b\n\ntail');
  });

  it('keeps ordered-list items tight', () => {
    expect(normalizeMarkdown('1. a\n2. b')).toBe('1. a\n2. b');
  });

  it('adds a blank line before a heading and after it', () => {
    expect(normalizeMarkdown('para\n## Title\nbody')).toBe('para\n\n## Title\n\nbody');
  });

  it('keeps blockquote lines tight, blank before the block, lazy continuation attached', () => {
    // `r` after the quote is a CommonMark lazy continuation — keep it attached
    // rather than forcing it out into its own paragraph.
    expect(normalizeMarkdown('p\n> q1\n> q2\nr')).toBe('p\n\n> q1\n> q2\nr');
  });

  it('keeps an indented list-item continuation attached (does not split the list)', () => {
    // Regression for the codex review: a wrapped/continuation line under a
    // bullet must NOT be forced out of the list.
    expect(normalizeMarkdown('- a\n  cont\n- b')).toBe('- a\n  cont\n\n- b');
  });

  it('separates prose lines that merely contain a pipe (not a real table)', () => {
    // Regression for the codex review: `|` in shell pipes / TS unions / regex
    // alternation must not be treated as a table and glued together.
    expect(normalizeMarkdown('cat a | grep b\nsort | uniq')).toBe('cat a | grep b\n\nsort | uniq');
    expect(normalizeMarkdown('intro\ntype T = A | B\noutro')).toBe(
      'intro\n\ntype T = A | B\n\noutro',
    );
  });

  it('treats pipe lines as a table only with a real GFM delimiter row', () => {
    const input = 'h1 | h2\n--- | ---\n1 | 2\nafter';
    expect(normalizeMarkdown(input)).toBe('h1 | h2\n--- | ---\n1 | 2\n\nafter');
  });

  it('leaves fenced code blocks completely untouched inside, padding around', () => {
    const input = 'text\n```\na\nb\n\nc\n```\nmore';
    expect(normalizeMarkdown(input)).toBe('text\n\n```\na\nb\n\nc\n```\n\nmore');
  });

  it('does not split rows of a markdown table', () => {
    const input = 'head\n| a | b |\n| - | - |\n| 1 | 2 |\nafter';
    expect(normalizeMarkdown(input)).toBe('head\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter');
  });

  it('collapses runs of blank lines to a single blank line', () => {
    expect(normalizeMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims leading and trailing blank lines', () => {
    expect(normalizeMarkdown('\n\nfoo\n\n')).toBe('foo');
  });

  it('is idempotent', () => {
    const samples = [
      '证据：foo\n影响：bar',
      'intro\n- a\n- b\ntail',
      'text\n```\na\n\nb\n```\nmore',
      'head\n| a | b |\n| - | - |\n| 1 | 2 |\nafter',
      'para\n## Title\nbody',
    ];
    for (const s of samples) {
      const once = normalizeMarkdown(s);
      expect(normalizeMarkdown(once)).toBe(once);
    }
  });

  it('returns empty string unchanged', () => {
    expect(normalizeMarkdown('')).toBe('');
    expect(normalizeMarkdown('   \n  ')).toBe('');
  });

  it('preserves a single paragraph with no internal newlines', () => {
    expect(normalizeMarkdown('just one line')).toBe('just one line');
  });
});
