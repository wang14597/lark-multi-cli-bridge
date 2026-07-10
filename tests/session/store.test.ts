// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

  describe('idleTimeoutMs override', () => {
    it('setIdleTimeout persists the override and reload sees it', async () => {
      await store.upsert('oc_to', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
      await store.setIdleTimeout('oc_to', 'claude-bot', 1_200_000);
      expect(store.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBe(1_200_000);
      const reloaded = new SessionStore(join(dir, 'sessions.json'));
      await reloaded.load();
      expect(reloaded.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBe(1_200_000);
    });

    it('setIdleTimeout(undefined) clears the override', async () => {
      await store.upsert('oc_to', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
      await store.setIdleTimeout('oc_to', 'claude-bot', 1_200_000);
      await store.setIdleTimeout('oc_to', 'claude-bot', undefined);
      expect(store.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBeUndefined();
    });

    it('throws when the slot is not initialized', async () => {
      await expect(store.setIdleTimeout('oc_missing', 'claude-bot', 1000)).rejects.toThrow(
        /not initialized/i,
      );
    });

    it('survives reset and setCwd (it is a chat preference, not per-session)', async () => {
      await store.upsert('oc_to', {
        backend: 'claude',
        bot: 'claude-bot',
        cwd: '/a',
        sessionId: 'sid-1',
      });
      await store.setIdleTimeout('oc_to', 'claude-bot', 900_000);
      await store.reset('oc_to', 'claude-bot');
      expect(store.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBe(900_000);
      await store.setCwd('oc_to', 'claude-bot', '/b', false);
      expect(store.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBe(900_000);
      expect(store.get('oc_to', 'claude-bot')?.cwd).toBe('/b');
    });

    it('upsert preserves an existing override when not re-specified', async () => {
      await store.upsert('oc_to', { backend: 'claude', bot: 'claude-bot', cwd: '/a' });
      await store.setIdleTimeout('oc_to', 'claude-bot', 720_000);
      await store.upsert('oc_to', { backend: 'claude', bot: 'claude-bot', cwd: '/a' });
      expect(store.get('oc_to', 'claude-bot')?.idleTimeoutMs).toBe(720_000);
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

  describe('per-bot file isolation (fixes cross-worker clobber)', () => {
    // Root cause of session cross-talk: three per-bot workers shared ONE
    // sessions.json; each loaded it once at startup and rewrote the WHOLE
    // blob on every upsert, so a sibling worker's write reverted another
    // bot's newer slots. Per-bot files give each worker its own file →
    // single writer → no clobber.
    it('two per-bot stores do not clobber each other across reloads', async () => {
      const claudePath = join(dir, 'sessions', 'claude-bot.json');
      const codexPath = join(dir, 'sessions', 'codex-bot.json');

      // Two long-lived stores, one per bot (as the workers construct them).
      const claude = new SessionStore(claudePath, { botName: 'claude-bot' });
      const codex = new SessionStore(codexPath, { botName: 'codex-bot' });
      await claude.load();
      await codex.load();

      await claude.upsert('oc_x', { backend: 'claude', bot: 'claude-bot', cwd: '/h', sessionId: 'claude-S1' });
      await codex.upsert('oc_x', { backend: 'codex', bot: 'codex-bot', cwd: '/p', sessionId: 'codex-S2' });

      // A fresh reload of each bot's file (simulating a worker restart) still
      // sees its own latest sessionId — no sibling clobbered it.
      const claudeReload = new SessionStore(claudePath, { botName: 'claude-bot' });
      const codexReload = new SessionStore(codexPath, { botName: 'codex-bot' });
      await claudeReload.load();
      await codexReload.load();
      expect(claudeReload.get('oc_x', 'claude-bot')?.sessionId).toBe('claude-S1');
      expect(codexReload.get('oc_x', 'codex-bot')?.sessionId).toBe('codex-S2');
    });
  });

  describe('one-time migration from the legacy shared file', () => {
    it('extracts only this bot\'s slots from the legacy shared sessions.json', async () => {
      const legacyPath = join(dir, 'sessions.json');
      const shared = {
        chats: {
          oc_g: {
            'claude-bot': { backend: 'claude', bot: 'claude-bot', sessionId: 'c-1', cwd: '/h', lastUsedAt: '2026-06-01T00:00:00Z', messageCount: 3 },
            'codex-bot': { backend: 'codex', bot: 'codex-bot', sessionId: 'x-1', cwd: '/p', lastUsedAt: '2026-06-01T00:00:00Z', messageCount: 5 },
          },
        },
      };
      writeFileSync(legacyPath, JSON.stringify(shared));

      const claudePath = join(dir, 'sessions', 'claude-bot.json');
      const claude = new SessionStore(claudePath, { botName: 'claude-bot', legacyPath });
      await claude.load();
      // This bot's slot migrated in.
      expect(claude.get('oc_g', 'claude-bot')?.sessionId).toBe('c-1');
      // The sibling bot's slot is NOT pulled into this bot's file.
      expect(claude.get('oc_g', 'codex-bot')).toBeUndefined();
      // Persisted to the per-bot file; a reload without legacyPath still sees it.
      const reload = new SessionStore(claudePath, { botName: 'claude-bot' });
      await reload.load();
      expect(reload.get('oc_g', 'claude-bot')?.sessionId).toBe('c-1');
      expect(reload.get('oc_g', 'codex-bot')).toBeUndefined();
    });

    it('ignores the legacy file once the per-bot file already has data', async () => {
      const legacyPath = join(dir, 'sessions.json');
      writeFileSync(legacyPath, JSON.stringify({
        chats: { oc_g: { 'claude-bot': { backend: 'claude', bot: 'claude-bot', sessionId: 'legacy', cwd: '/h', lastUsedAt: '2026-06-01T00:00:00Z', messageCount: 1 } } },
      }));
      const claudePath = join(dir, 'sessions', 'claude-bot.json');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      writeFileSync(claudePath, JSON.stringify({
        chats: { oc_g: { 'claude-bot': { backend: 'claude', bot: 'claude-bot', sessionId: 'current', cwd: '/h', lastUsedAt: '2026-07-01T00:00:00Z', messageCount: 9 } } },
      }));
      const claude = new SessionStore(claudePath, { botName: 'claude-bot', legacyPath });
      await claude.load();
      // Per-bot file wins; legacy is not re-migrated over it.
      expect(claude.get('oc_g', 'claude-bot')?.sessionId).toBe('current');
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
