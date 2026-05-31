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
    expect(store.resolve('voice-agent')).toBe('/Users/me/projects/voice-agent');
    expect(store.list()).toEqual([{ name: 'voice-agent', path: '/Users/me/projects/voice-agent' }]);
    await store.remove('voice-agent');
    expect(store.resolve('voice-agent')).toBeUndefined();
  });
});
