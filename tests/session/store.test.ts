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
});
