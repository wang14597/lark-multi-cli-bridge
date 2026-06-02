// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  it('returns undefined for unknown (chat, bot)', () => {
    expect(store.get('oc_unknown', 'claude-bot')).toBeUndefined();
  });

  it('upserts and persists a session under (chatId, botName)', async () => {
    await store.upsert('oc_chat1', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
    expect(store.get('oc_chat1', 'claude-bot')).toMatchObject({
      backend: 'claude',
      bot: 'claude-bot',
      cwd: '/tmp',
      messageCount: 1,
    });
    const reloaded = new SessionStore(join(dir, 'sessions.json'));
    await reloaded.load();
    expect(reloaded.get('oc_chat1', 'claude-bot')).toMatchObject({
      backend: 'claude',
      bot: 'claude-bot',
    });
  });

  it('bumps messageCount on each upsert', async () => {
    await store.upsert('oc_chat2', { backend: 'codex', bot: 'codex-bot', cwd: '/tmp' });
    await store.upsert('oc_chat2', {
      backend: 'codex',
      bot: 'codex-bot',
      cwd: '/tmp',
      sessionId: 'rollout-abc',
    });
    expect(store.get('oc_chat2', 'codex-bot')?.messageCount).toBe(2);
    expect(store.get('oc_chat2', 'codex-bot')?.sessionId).toBe('rollout-abc');
  });

  it('reset clears sessionId while keeping cwd and bot', async () => {
    await store.upsert('oc_chat3', {
      backend: 'gemini',
      bot: 'gemini-bot',
      cwd: '/p',
      sessionId: 'gem-1',
    });
    await store.reset('oc_chat3', 'gemini-bot');
    const s = store.get('oc_chat3', 'gemini-bot');
    expect(s?.sessionId).toBeUndefined();
    expect(s?.cwd).toBe('/p');
  });

  describe('per-bot scoping', () => {
    // Two bots active in the same chat must keep independent sessions.
    // Before this scoping, a chat slot was a single ChatSession keyed by
    // chatId, so codex-bot upserting would clobber claude-bot's sessionId
    // and the next claude turn would either restart fresh or pass codex's
    // thread_id to claude (causing weird failures).
    it('lets two bots in the same chat each keep their own session', async () => {
      await store.upsert('oc_group', {
        backend: 'claude',
        bot: 'claude-bot',
        cwd: '/home',
        sessionId: 'claude-uuid-aaa',
      });
      await store.upsert('oc_group', {
        backend: 'codex',
        bot: 'codex-bot',
        cwd: '/proj',
        sessionId: 'codex-thread-bbb',
      });
      // Neither bot's slot was clobbered by the other.
      expect(store.get('oc_group', 'claude-bot')?.sessionId).toBe('claude-uuid-aaa');
      expect(store.get('oc_group', 'claude-bot')?.cwd).toBe('/home');
      expect(store.get('oc_group', 'codex-bot')?.sessionId).toBe('codex-thread-bbb');
      expect(store.get('oc_group', 'codex-bot')?.cwd).toBe('/proj');
    });

    it('reset only touches the targeted bot slot', async () => {
      await store.upsert('oc_group', {
        backend: 'claude',
        bot: 'claude-bot',
        cwd: '/h',
        sessionId: 'claude-aaa',
      });
      await store.upsert('oc_group', {
        backend: 'codex',
        bot: 'codex-bot',
        cwd: '/p',
        sessionId: 'codex-bbb',
      });
      await store.reset('oc_group', 'codex-bot');
      expect(store.get('oc_group', 'claude-bot')?.sessionId).toBe('claude-aaa');
      expect(store.get('oc_group', 'codex-bot')?.sessionId).toBeUndefined();
    });

    it('setCwd only touches the targeted bot slot', async () => {
      await store.upsert('oc_group', {
        backend: 'claude',
        bot: 'claude-bot',
        cwd: '/h',
        sessionId: 'claude-aaa',
      });
      await store.upsert('oc_group', {
        backend: 'codex',
        bot: 'codex-bot',
        cwd: '/p',
      });
      await store.setCwd('oc_group', 'codex-bot', '/newcodex', false);
      expect(store.get('oc_group', 'claude-bot')?.cwd).toBe('/h');
      expect(store.get('oc_group', 'codex-bot')?.cwd).toBe('/newcodex');
    });
  });

  describe('list()', () => {
    it('returns one entry per (chatId, botName) pair', async () => {
      await store.upsert('oc_a', { backend: 'claude', bot: 'claude-bot', cwd: '/x' });
      await store.upsert('oc_a', { backend: 'codex', bot: 'codex-bot', cwd: '/y' });
      await store.upsert('oc_b', { backend: 'claude', bot: 'claude-bot', cwd: '/z' });
      const all = store.list();
      expect(all).toHaveLength(3);
      const keys = all.map((e) => `${e.chatId}::${e.botName}`).sort();
      expect(keys).toEqual(['oc_a::claude-bot', 'oc_a::codex-bot', 'oc_b::claude-bot']);
    });
  });

  describe('legacy v1 schema migration', () => {
    // v1 stored a flat ChatSession per chatId; v2 nests by botName so two
    // bots in the same chat each get their own slot. Sessions written under
    // v0.7.1 or earlier MUST survive an upgrade without manual intervention.
    it('promotes a flat v1 file into nested v2 on load() and persists', async () => {
      const filePath = join(dir, 'legacy.json');
      const legacy = {
        chats: {
          oc_legacy: {
            backend: 'claude',
            bot: 'claude-bot',
            sessionId: 'legacy-uuid',
            cwd: '/legacy',
            lastUsedAt: '2026-06-01T00:00:00Z',
            messageCount: 7,
          },
        },
      };
      writeFileSync(filePath, JSON.stringify(legacy));
      const migrated = new SessionStore(filePath);
      await migrated.load();
      // Original (chatId, botName) lookup works.
      expect(migrated.get('oc_legacy', 'claude-bot')).toMatchObject({
        sessionId: 'legacy-uuid',
        cwd: '/legacy',
        messageCount: 7,
      });
      // Other bot in same chat still empty.
      expect(migrated.get('oc_legacy', 'codex-bot')).toBeUndefined();
      // File on disk now in v2 shape.
      const reloaded = new SessionStore(filePath);
      await reloaded.load();
      expect(reloaded.get('oc_legacy', 'claude-bot')?.sessionId).toBe('legacy-uuid');
    });

    it('leaves a v2 file untouched on load()', async () => {
      const filePath = join(dir, 'v2.json');
      const v2 = {
        chats: {
          oc_v2: {
            'codex-bot': {
              backend: 'codex',
              bot: 'codex-bot',
              sessionId: 'codex-id',
              cwd: '/p',
              lastUsedAt: '2026-06-02T00:00:00Z',
              messageCount: 1,
            },
          },
        },
      };
      writeFileSync(filePath, JSON.stringify(v2));
      const s = new SessionStore(filePath);
      await s.load();
      expect(s.get('oc_v2', 'codex-bot')?.sessionId).toBe('codex-id');
    });
  });
});
