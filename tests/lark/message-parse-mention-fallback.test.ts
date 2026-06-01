// SPDX-License-Identifier: MIT
/**
 * Tests for the defensive leading-mention + slash-command fallback in
 * parseIngressEvent. This covers the case where botSelfOpenId was not
 * resolved (so stripMentionOpenIds is empty / undefined), but the user
 * types "@bot /status" in a group chat.
 */
import { describe, it, expect } from 'vitest';
import { parseIngressEvent } from '../../src/lark/message-parse.js';

// Group message: @bot /status — the mention key is "@_user_bot"
const groupSlashWithMention = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_100',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000000000',
      content: JSON.stringify({ text: '@_user_bot /status' }),
      mentions: [{ key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

// Group message: @bot some non-slash text — should NOT be stripped by fallback.
const groupNonSlashWithMention = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_101',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000001000',
      content: JSON.stringify({ text: '@_user_bot hello there' }),
      mentions: [{ key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

// Group message: @bot /status but stripMentionOpenIds IS provided — normal stripping should still work.
const groupSlashWithStrip = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_102',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000002000',
      content: JSON.stringify({ text: '@_user_bot /status' }),
      mentions: [{ key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

// Group message: @bot /status with whitespace between mention and slash
const groupSlashWithSpace = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_103',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000003000',
      content: JSON.stringify({ text: '@_user_bot   /help' }),
      mentions: [{ key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

describe('parseIngressEvent — leading-mention slash-command fallback', () => {
  it('strips leading @-mention when followed by slash command (no stripMentionOpenIds)', () => {
    const m = parseIngressEvent(groupSlashWithMention);
    // The fallback should strip "@_user_bot" and leave "/status"
    expect(m?.text).toBe('/status');
  });

  it('does NOT strip leading @-mention when NOT followed by slash command', () => {
    const m = parseIngressEvent(groupNonSlashWithMention);
    // Fallback only activates when rest starts with '/', so text remains unchanged.
    expect(m?.text).toBe('@_user_bot hello there');
  });

  it('handles extra whitespace between mention and slash command', () => {
    const m = parseIngressEvent(groupSlashWithSpace);
    expect(m?.text).toBe('/help');
  });

  it('normal stripMentionOpenIds path still strips mention for slash commands', () => {
    const m = parseIngressEvent(groupSlashWithStrip, {
      stripMentionOpenIds: ['ou_bot'],
    });
    expect(m?.text).toBe('/status');
  });

  it('p2p messages without mentions are not affected', () => {
    const p2p = {
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'om_104',
          chat_id: 'oc_p2p1',
          chat_type: 'p2p',
          message_type: 'text',
          create_time: '1700000004000',
          content: JSON.stringify({ text: '/status' }),
          mentions: [],
        },
      },
    };
    const m = parseIngressEvent(p2p);
    expect(m?.text).toBe('/status');
  });
});
