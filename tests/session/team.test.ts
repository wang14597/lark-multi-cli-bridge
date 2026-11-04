// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamStore } from '../../src/session/team.js';

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'lmcb-team-')), 'teams.json');
});

describe('TeamStore', () => {
  it('set / update / remove round-trip, scoped per chat', async () => {
    const s = new TeamStore(path);
    await s.set('oc_a', 'claude-bot', '开发');
    await s.set('oc_a', 'claude-bot', '开发+集成');
    await s.set('oc_b', 'codex-bot', 'review');
    expect(await s.get('oc_a')).toEqual({ 'claude-bot': { role: '开发+集成' } });
    expect(await s.get('oc_b')).toEqual({ 'codex-bot': { role: 'review' } });
    expect(await s.remove('oc_a', 'claude-bot')).toBe(true);
    expect(await s.remove('oc_a', 'claude-bot')).toBe(false);
    expect(await s.get('oc_a')).toEqual({});
    expect(await s.get('oc_b')).toEqual({ 'codex-bot': { role: 'review' } });
  });

  it('clear drops only that chat', async () => {
    const s = new TeamStore(path);
    await s.set('oc_a', 'x', 'r');
    await s.set('oc_b', 'y', 'r');
    await s.clear('oc_a');
    expect(await s.get('oc_a')).toEqual({});
    expect(await s.get('oc_b')).toEqual({ y: { role: 'r' } });
  });

  // Three workers share the file; a sibling's write must be visible with no restart.
  it('is read-through: sees a sibling store’s write and does not clobber it', async () => {
    const a = new TeamStore(path);
    const b = new TeamStore(path);
    await a.get('oc_a');
    await b.set('oc_a', 'codex-bot', 'review');
    await a.set('oc_a', 'claude-bot', '开发');
    expect(Object.keys(await b.get('oc_a')).sort()).toEqual(['claude-bot', 'codex-bot']);
  });

  it('a missing or corrupt file reads as empty', async () => {
    const s = new TeamStore(path);
    expect(await s.get('oc_a')).toEqual({});
    writeFileSync(path, '[1,2]');
    expect(await s.get('oc_a')).toEqual({});
  });
});
