// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  buildStatusCard,
  buildHelpCard,
  buildWorkspacesCard,
  buildAccessCard,
} from '../../src/lark/command-cards.js';
import type { CommandHandler } from '../../src/commands/types.js';

// Minimal stub to satisfy CommandHandler interface in tests.
function makeHandler(name: string, description: string, adminOnly?: boolean): CommandHandler {
  return {
    name,
    description,
    ...(adminOnly ? { adminOnly: true } : {}),
    async run() {},
  };
}

describe('schema 2.0 compatibility', () => {
  // Schema 2.0 cards reject the legacy `tag: 'action'` wrapper with Lark
  // error 230099 / 200861. Buttons must be top-level elements or wrapped
  // in `column_set`. Regression guard against the v0.6.0 bug.
  it('command cards must not emit tag:"action" anywhere', () => {
    const cards = [
      buildStatusCard({ chatId: 'oc_x', cwd: '/tmp', agentName: 'bot' }),
      buildHelpCard([makeHandler('help', 'h'), makeHandler('status', 's')]),
      buildWorkspacesCard('/a', { w1: '/a' }),
      buildAccessCard({ allowed_users: [], allowed_chats: [], admins: [] }),
    ];
    for (const card of cards) {
      const json = JSON.stringify(card);
      expect(json).not.toMatch(/"tag"\s*:\s*"action"/);
    }
  });
});

describe('buildStatusCard', () => {
  it('produces schema 2.0 with expected header and content', () => {
    const card = buildStatusCard({
      chatId: 'oc_chat1',
      cwd: '/home/user/projects',
      sessionId: 'sess_abc123xyz',
      agentName: 'my-bot',
    });
    const json = JSON.stringify(card);
    expect((card as Record<string, unknown>)['schema']).toBe('2.0');
    expect(json).toContain('📊 当前状态');
    expect(json).toContain('oc_chat1');
    expect(json).toContain('/home/user/projects');
    // sessionId should appear (truncated to 8 chars + ellipsis)
    expect(json).toContain('sess_abc');
    expect(json).toContain('my-bot');
    // action row should have the 4 expected buttons
    expect(json).toContain('🆕 新会话');
    expect(json).toContain('🔁 恢复会话');
    expect(json).toContain('📂 工作空间');
    expect(json).toContain('💡 帮助');
  });

  it('shows (无) when sessionId is missing', () => {
    const card = buildStatusCard({
      chatId: 'oc_chat2',
      cwd: '/tmp',
      agentName: 'bot',
    });
    const json = JSON.stringify(card);
    expect(json).toContain('无');
  });
});

describe('buildHelpCard', () => {
  it('produces schema 2.0 with expected header and command list', () => {
    const handlers: CommandHandler[] = [
      makeHandler('help', 'show help'),
      makeHandler('status', 'show status'),
      makeHandler('new', 'start new session'),
      makeHandler('cd', 'change directory'),
      makeHandler('ws', 'workspaces'),
      makeHandler('access', 'show access', true),
    ];
    const card = buildHelpCard(handlers);
    const json = JSON.stringify(card);
    expect((card as Record<string, unknown>)['schema']).toBe('2.0');
    expect(json).toContain('💡 使用帮助');
    expect(json).toContain('/status');
    expect(json).toContain('/help');
    expect(json).toContain('/cd');
    expect(json).toContain('/ws');
    // Admin command should also appear when all handlers passed.
    expect(json).toContain('/access');
  });

  it('includes bottom action row with status/ws/new buttons', () => {
    const card = buildHelpCard([makeHandler('status', 'desc')]);
    const json = JSON.stringify(card);
    expect(json).toContain('📊 状态');
    expect(json).toContain('🆕 新会话');
  });
});

describe('buildWorkspacesCard', () => {
  it('produces schema 2.0 with expected header and empty state message', () => {
    const card = buildWorkspacesCard('/home/user', {});
    const json = JSON.stringify(card);
    expect((card as Record<string, unknown>)['schema']).toBe('2.0');
    expect(json).toContain('📂 工作空间');
    expect(json).toContain('暂无命名工作空间');
    expect(json).toContain('/home/user');
  });

  it('shows named workspaces with switch/delete buttons', () => {
    const card = buildWorkspacesCard('/home/user/a', {
      proj1: '/home/user/a',
      proj2: '/home/user/b',
    });
    const json = JSON.stringify(card);
    expect(json).toContain('proj1');
    expect(json).toContain('proj2');
    expect(json).toContain('切换到此处');
    expect(json).toContain('删除');
    // Current marker
    expect(json).toContain('当前');
  });

  it('handles undefined current cwd gracefully', () => {
    const card = buildWorkspacesCard(undefined, { ws1: '/tmp/ws1' });
    const json = JSON.stringify(card);
    expect(json).toContain('未设置');
  });
});

describe('buildAccessCard', () => {
  it('produces schema 2.0 with expected header and all three fields', () => {
    const access = {
      allowed_users: ['ou_abc', 'ou_def'],
      allowed_chats: [],
      admins: ['ou_admin'],
    };
    const card = buildAccessCard(access);
    const json = JSON.stringify(card);
    expect((card as Record<string, unknown>)['schema']).toBe('2.0');
    expect(json).toContain('🔒 访问控制');
    expect(json).toContain('ou_abc');
    expect(json).toContain('ou_def');
    expect(json).toContain('ou_admin');
    // allowed_chats is empty → 所有群
    expect(json).toContain('所有群');
  });

  it('shows empty labels when all lists are empty', () => {
    const access = {
      allowed_users: [],
      allowed_chats: [],
      admins: [],
    };
    const card = buildAccessCard(access);
    const json = JSON.stringify(card);
    expect(json).toContain('所有人');
    expect(json).toContain('所有群');
    expect(json).toContain('无');
  });
});
