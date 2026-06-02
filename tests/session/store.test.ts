// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/session/store.js';

let dir: string;
let store: SessionStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-sess-'));
  store = new SessionStore(join(dir, 'sessions.json'));
  await store.load();
});

describe('SessionStore', () => {
  it('returns undefined for unknown chat', () => {
    expect(store.get('oc_unknown')).toBeUndefined();
  });

  it('upserts and persists a session', async () => {
    await store.upsert('oc_chat1', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
    const s = store.get('oc_chat1');
    expect(s).toMatchObject({ backend: 'claude', bot: 'claude-bot', cwd: '/tmp', messageCount: 1 });
    const reloaded = new SessionStore(join(dir, 'sessions.json'));
    await reloaded.load();
    expect(reloaded.get('oc_chat1')).toMatchObject({ backend: 'claude', bot: 'claude-bot' });
  });

  it('bumps messageCount on each upsert', async () => {
    await store.upsert('oc_chat2', { backend: 'codex', bot: 'codex-bot', cwd: '/tmp' });
    await store.upsert('oc_chat2', { backend: 'codex', bot: 'codex-bot', cwd: '/tmp', sessionId: 'rollout-abc' });
    expect(store.get('oc_chat2')?.messageCount).toBe(2);
    expect(store.get('oc_chat2')?.sessionId).toBe('rollout-abc');
  });

  it('reset clears sessionId while keeping cwd and bot', async () => {
    await store.upsert('oc_chat3', { backend: 'gemini', bot: 'gemini-bot', cwd: '/p', sessionId: 'gem-1' });
    await store.reset('oc_chat3');
    const s = store.get('oc_chat3');
    expect(s?.sessionId).toBeUndefined();
    expect(s?.cwd).toBe('/p');
  });

  describe('getForBot', () => {
    // Cross-backend session bleed regression: a chat used by multiple bots
    // over time MUST NOT hand bot A's sessionId to bot B. claude UUIDs are
    // not codex thread_ids; cross-feeding causes "no rollout found" or
    // silently inherited conversations.
    it('returns the entry only when bot matches', async () => {
      await store.upsert('oc_shared', {
        backend: 'claude',
        bot: 'claude-bot',
        cwd: '/home',
        sessionId: '49e2842f-claude-uuid',
      });
      expect(store.getForBot('oc_shared', 'claude-bot')?.sessionId).toBe('49e2842f-claude-uuid');
      // Same chat, different bot — must be invisible to codex-bot even
      // though .get() still returns the row.
      expect(store.getForBot('oc_shared', 'codex-bot')).toBeUndefined();
      expect(store.get('oc_shared')).toBeDefined();
    });

    it('returns undefined for chats never seen by any bot', () => {
      expect(store.getForBot('oc_brand_new', 'claude-bot')).toBeUndefined();
    });

    it('returns undefined when bot mismatches even on same backend', async () => {
      // Two claude bots (different lark identities, different cwds, different
      // system prompts) must not share sessions either.
      await store.upsert('oc_two_claudes', {
        backend: 'claude',
        bot: 'claude-prod-bot',
        cwd: '/prod',
        sessionId: 'prod-session',
      });
      expect(store.getForBot('oc_two_claudes', 'claude-dev-bot')).toBeUndefined();
    });
  });
});
