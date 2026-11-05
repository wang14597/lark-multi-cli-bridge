// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { renderConclusionCard } from '../../src/lark/conclusion-card.js';

describe('renderConclusionCard', () => {
  it('caps a huge body at 8000 chars plus an ellipsis', () => {
    const card = renderConclusionCard('x'.repeat(20_000)) as {
      body: { elements: { content: string }[] };
    };
    expect(card.body.elements[0]!.content).toBe('x'.repeat(8000) + '…');
  });

  it('leaves a short body untouched', () => {
    const card = renderConclusionCard('ok') as { body: { elements: { content: string }[] } };
    expect(card.body.elements[0]!.content).toBe('ok');
  });
});
