// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { buildTeamRoster, makeChatBotsLookup } from '../../src/worker/team-roster.js';

describe('buildTeamRoster', () => {
  it('empty roster → no block', () => {
    expect(buildTeamRoster('claude-bot', {})).toBe('');
  });

  it('shows own role and the other members', () => {
    expect(
      buildTeamRoster('claude-bot', {
        'claude-bot': { role: '开发' },
        'codex-bot': { role: 'review' },
        'gemini-bot': { role: 'docker 启动 / 测试' },
      }),
    ).toBe(
      [
        '<team_roster>',
        'you: claude-bot — 开发',
        'members:',
        '- codex-bot — review',
        '- gemini-bot — docker 启动 / 测试',
        '</team_roster>',
      ].join('\n'),
    );
  });

  it('a bot with no role still sees its teammates', () => {
    const out = buildTeamRoster('gemini-bot', { 'codex-bot': { role: 'review' } });
    expect(out).toContain('you: gemini-bot — (no role assigned)');
    expect(out).toContain('- codex-bot — review');
  });

  it('a lone member sees no members list', () => {
    expect(buildTeamRoster('claude-bot', { 'claude-bot': { role: '开发' } })).not.toContain(
      'members:',
    );
  });
});

describe('buildTeamRoster mention tags', () => {
  const chatBots = [
    { openId: 'ou_codex', name: 'wl-codex-bot' },
    { openId: 'ou_self', name: 'wl-claude-bot' },
  ];

  it('adds an <at> tag for teammates matched by display name, none for the rest', () => {
    const out = buildTeamRoster(
      'claude-bot',
      {
        'claude-bot': { role: '开发' },
        'codex-bot': { role: 'review' },
        'gemini-bot': { role: '测试' },
      },
      chatBots,
    );
    expect(out).toContain(
      '- codex-bot — review — mention: <at user_id="ou_codex">wl-codex-bot</at>',
    );
    expect(out).toContain('- gemini-bot — 测试\n');
    expect(out).not.toContain('ou_self');
  });
});

describe('makeChatBotsLookup', () => {
  it('caches successes, retries failures sooner', async () => {
    let t = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ openId: 'ou_x', name: 'n' }]);
    const lookup = makeChatBotsLookup(fetch, () => t);
    expect(await lookup('oc_1')).toEqual([]);
    await lookup('oc_1');
    expect(fetch).toHaveBeenCalledTimes(1); // failure cached for 60s
    t = 61_000;
    expect(await lookup('oc_1')).toHaveLength(1);
    t = 62_000;
    await lookup('oc_1');
    expect(fetch).toHaveBeenCalledTimes(2); // success cached 10min
  });
});
