// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../../src/session/workspace.js';

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'lmcb-ws-')), 'workspaces.json');
});

describe('WorkspaceStore', () => {
  it('save/use/list/remove round-trip', async () => {
    const store = new WorkspaceStore(path);
    await store.load();
    await store.save('voice-agent', '/Users/me/projects/voice-agent');
    expect(await store.resolve('voice-agent')).toBe('/Users/me/projects/voice-agent');
    expect(await store.list()).toEqual([
      { name: 'voice-agent', path: '/Users/me/projects/voice-agent' },
    ]);
    await store.remove('voice-agent');
    expect(await store.resolve('voice-agent')).toBeUndefined();
  });

  // The file is shared by every per-bot worker. Each store used to load once at
  // startup and then write its whole in-memory snapshot back, so a sibling
  // worker's save was silently reverted to the snapshot this worker booted with.
  it('does not clobber a sibling store’s save', async () => {
    const a = new WorkspaceStore(path);
    const b = new WorkspaceStore(path);
    await a.load();
    await b.load();

    await a.save('alpha', '/srv/alpha');
    await b.save('beta', '/srv/beta');

    const fresh = new WorkspaceStore(path);
    await fresh.load();
    expect(await fresh.resolve('alpha')).toBe('/srv/alpha');
    expect(await fresh.resolve('beta')).toBe('/srv/beta');
  });

  it('does not resurrect an entry a sibling store removed', async () => {
    const a = new WorkspaceStore(path);
    await a.load();
    await a.save('alpha', '/srv/alpha');
    await a.save('beta', '/srv/beta');

    const b = new WorkspaceStore(path);
    await b.load();

    await a.remove('alpha');
    await b.save('gamma', '/srv/gamma');

    const fresh = new WorkspaceStore(path);
    await fresh.load();
    expect(await fresh.resolve('alpha')).toBeUndefined();
    expect(await fresh.resolve('beta')).toBe('/srv/beta');
    expect(await fresh.resolve('gamma')).toBe('/srv/gamma');
  });

  it('reads through to disk so a sibling’s save is visible without a reload', async () => {
    const a = new WorkspaceStore(path);
    const b = new WorkspaceStore(path);
    await a.load();
    await b.load();

    await a.save('alpha', '/srv/alpha');

    expect(await b.resolve('alpha')).toBe('/srv/alpha');
    expect(await b.list()).toEqual([{ name: 'alpha', path: '/srv/alpha' }]);
  });
});
