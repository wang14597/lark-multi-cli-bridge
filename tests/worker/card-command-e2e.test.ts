// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { CommandRouter } from '../../src/commands/router.js';
import { wsHandler } from '../../src/commands/handlers/ws.js';
import { SessionStore } from '../../src/session/store.js';
import { WorkspaceStore } from '../../src/session/workspace.js';
import { makeDispatchCommand } from '../../src/worker/dispatch-command.js';
import { cmdToCommand } from '../../src/worker/card-action-handler.js';
import type { CommandCtx } from '../../src/commands/types.js';

const silentLog = pino({ level: 'silent' });

function makeBot(overrides: Partial<CommandCtx['bot']> = {}): CommandCtx['bot'] {
  return {
    name: 'claude-bot',
    backend: { type: 'claude' },
    access: { allowed_users: [], allowed_chats: [], admins: [] },
    ...overrides,
  } as CommandCtx['bot'];
}

/**
 * The F1 fix (structured routing) is otherwise only proven seam-by-seam:
 * `cmdToCommand` emits one arg, and `dispatchParsed` forwards it unsplit. This
 * test chains the REAL `cmdToCommand → makeDispatchCommand → CommandRouter →
 * wsHandler → WorkspaceStore/SessionStore` so a future wsHandler refactor that
 * re-truncated the name (the original bug) would fail here, not slip through.
 */
describe('card ws.use click — end to end through the real router + wsHandler', () => {
  let dir: string;
  let sessions: SessionStore;
  let workspaces: WorkspaceStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lmcb-e2e-'));
    sessions = new SessionStore(join(dir, 'sessions.json'));
    workspaces = new WorkspaceStore(join(dir, 'workspaces.json'));
    await sessions.load();
    await workspaces.load();
  });

  it('routes a whitespace workspace name to the exact target, not the truncated prefix', async () => {
    const targetPath = '/Users/me/projects/foo bar';
    await workspaces.save('foo bar', targetPath);
    // Decoy named exactly the prefix the old slash round-trip truncated to.
    await workspaces.save('foo', '/Users/me/projects/foo');

    const router = new CommandRouter([wsHandler]);
    const replies: string[] = [];
    const dispatch = makeDispatchCommand({
      router,
      bot: makeBot(),
      sessions,
      workspaces,
      makeReplies: () => ({
        reply: async (t) => void replies.push(t),
        replyCard: async () => {},
      }),
      log: silentLog,
    });

    const cmd = cmdToCommand('ws.use', { name: 'foo bar' });
    expect(cmd).toEqual({ name: 'ws', args: ['use', 'foo bar'] });

    await dispatch(cmd!, { chatId: 'oc_chat', operatorOpenId: 'ou_alice' });

    // The session landed on the 'foo bar' path — NOT the 'foo' decoy.
    expect(sessions.get('oc_chat', 'claude-bot')?.cwd).toBe(targetPath);
    expect(replies).toEqual([`switched to foo bar (${targetPath}); session reset`]);
  });
});
