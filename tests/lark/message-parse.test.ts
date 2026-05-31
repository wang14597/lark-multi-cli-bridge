// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseIngressEvent } from '../../src/lark/message-parse.js';

const sampleP2pText = {
  event: {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_chat1',
      chat_type: 'p2p',
      message_type: 'text',
      create_time: '1700000000000',
      content: JSON.stringify({ text: 'hello bot' }),
      mentions: [],
    },
  },
};

const groupTextWithMention = {
  event: {
    sender: { sender_id: { open_id: 'ou_user2' } },
    message: {
      message_id: 'om_2',
      chat_id: 'oc_group1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1700000001000',
      content: JSON.stringify({ text: '@_user_1 do something' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

describe('parseIngressEvent', () => {
  it('parses a p2p text message', () => {
    const m = parseIngressEvent(sampleP2pText);
    expect(m).toMatchObject({
      chatId: 'oc_chat1',
      chatType: 'p2p',
      text: 'hello bot',
      rawType: 'text',
      messageId: 'om_1',
    });
  });

  it('parses a group message and exposes mentions', () => {
    const m = parseIngressEvent(groupTextWithMention);
    expect(m?.chatType).toBe('group');
    expect(m?.mentions).toEqual([{ openId: 'ou_bot', name: 'mybot' }]);
  });

  it('strips the bot mention prefix when stripMentionOpenIds is provided', () => {
    const m = parseIngressEvent(groupTextWithMention, { stripMentionOpenIds: ['ou_bot'] });
    expect(m?.text).toBe('do something');
  });

  it('returns undefined for unsupported event shape', () => {
    expect(parseIngressEvent({ event: {} })).toBeUndefined();
  });
});
