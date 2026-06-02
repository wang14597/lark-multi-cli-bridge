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

// A group post message: @bot mention + multi-line text (Bug 1 scenario)
const groupPostWithMention = {
  event: {
    sender: { sender_id: { open_id: 'ou_user3' } },
    message: {
      message_id: 'om_3',
      chat_id: 'oc_group2',
      chat_type: 'group',
      message_type: 'post',
      create_time: '1700000002000',
      content: JSON.stringify({
        title: '',
        content: [
          [
            { tag: 'at', user_id: 'ou_bot', user_name: 'mybot' },
            { tag: 'text', text: ' please summarise' },
          ],
          [
            { tag: 'text', text: 'this is the second paragraph' },
          ],
        ],
      }),
      mentions: [{ key: '@_user_bot', id: { open_id: 'ou_bot' }, name: 'mybot' }],
    },
  },
};

// A post message with an inline img tag
const postWithImage = {
  event: {
    sender: { sender_id: { open_id: 'ou_user4' } },
    message: {
      message_id: 'om_4',
      chat_id: 'oc_chat2',
      chat_type: 'p2p',
      message_type: 'post',
      create_time: '1700000003000',
      content: JSON.stringify({
        title: 'title here',
        content: [
          [
            { tag: 'text', text: 'look at this: ' },
            { tag: 'img', image_key: 'img_v3_abc123' },
          ],
        ],
      }),
      mentions: [],
    },
  },
};

// An audio message
const audioMsg = {
  event: {
    sender: { sender_id: { open_id: 'ou_user5' } },
    message: {
      message_id: 'om_5',
      chat_id: 'oc_chat3',
      chat_type: 'p2p',
      message_type: 'audio',
      create_time: '1700000004000',
      content: JSON.stringify({ duration: '12', file_key: 'audio_key_1' }),
      mentions: [],
    },
  },
};

// An audio message without duration
const audioMsgNoDuration = {
  event: {
    sender: { sender_id: { open_id: 'ou_user5' } },
    message: {
      message_id: 'om_5b',
      chat_id: 'oc_chat3',
      chat_type: 'p2p',
      message_type: 'audio',
      create_time: '1700000004001',
      content: JSON.stringify({ file_key: 'audio_key_2' }),
      mentions: [],
    },
  },
};

// A merge_forward message
const mergeForwardMsg = {
  event: {
    sender: { sender_id: { open_id: 'ou_user6' } },
    message: {
      message_id: 'om_6',
      chat_id: 'oc_chat4',
      chat_type: 'p2p',
      message_type: 'merge_forward',
      create_time: '1700000005000',
      content: JSON.stringify({
        message_list: [
          { message_id: 'om_a', content: '{}' },
          { message_id: 'om_b', content: '{}' },
          { message_id: 'om_c', content: '{}' },
        ],
      }),
      mentions: [],
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

  // -----------------------------------------------------------------------
  // Post (rich-text) message tests — Bug 1 regression coverage
  // -----------------------------------------------------------------------

  it('flattens a post message with @at + multi-line text to a non-empty prompt', () => {
    const m = parseIngressEvent(groupPostWithMention);
    expect(m).toBeDefined();
    expect(m?.rawType).toBe('post');
    // Should contain the actual text content (not empty)
    expect(m?.text).toContain('please summarise');
    expect(m?.text).toContain('this is the second paragraph');
    // The two paragraphs should be joined by a newline
    expect(m?.text).toMatch(/please summarise\nthis is the second paragraph/);
  });

  it('strips the bot @-mention in a post message when stripMentionOpenIds is provided', () => {
    const m = parseIngressEvent(groupPostWithMention, {
      stripMentionOpenIds: ['ou_bot'],
    });
    expect(m?.text).not.toContain('@_user_bot');
    // The substantive text is still present
    expect(m?.text).toContain('please summarise');
  });

  it('flattens a post message with inline img to [image] marker + RawAttachment', () => {
    const m = parseIngressEvent(postWithImage);
    expect(m).toBeDefined();
    expect(m?.rawType).toBe('post');
    expect(m?.text).toContain('[image]');
    expect(m?.text).toContain('look at this:');
    expect(m?.attachments).toEqual([
      { fileKey: 'img_v3_abc123', fileName: 'image-img_v3_abc123.png', type: 'image' },
    ]);
  });

  // -----------------------------------------------------------------------
  // Audio message tests
  // -----------------------------------------------------------------------

  it('produces an [audio N seconds] marker for audio messages with duration', () => {
    const m = parseIngressEvent(audioMsg);
    expect(m).toBeDefined();
    expect(m?.rawType).toBe('audio');
    expect(m?.text).toBe('[audio 12 seconds]');
    // text is non-empty so the worker will not silently drop it
    expect(m?.text.trim().length).toBeGreaterThan(0);
  });

  it('produces a generic [audio] marker when duration is absent', () => {
    const m = parseIngressEvent(audioMsgNoDuration);
    expect(m?.text).toBe('[audio]');
  });

  // -----------------------------------------------------------------------
  // merge_forward message tests
  // -----------------------------------------------------------------------

  it('produces a non-empty text marker for merge_forward messages', () => {
    const m = parseIngressEvent(mergeForwardMsg);
    expect(m).toBeDefined();
    expect(m?.rawType).toBe('merge_forward');
    // Must be non-empty so the worker doesn't silently drop it
    expect(m?.text.trim().length).toBeGreaterThan(0);
    // Should mention the count
    expect(m?.text).toContain('3');
  });

  // -----------------------------------------------------------------------
  // Reply-quote (parent_id) tests
  // -----------------------------------------------------------------------

  it('extracts parentMessageId when the message reply-quotes another message', () => {
    const replyQuoteMsg = {
      event: {
        sender: { sender_id: { open_id: 'ou_user7' } },
        message: {
          message_id: 'om_reply_1',
          parent_id: 'om_parent_1',
          chat_id: 'oc_chat5',
          chat_type: 'group',
          message_type: 'text',
          create_time: '1700000006000',
          content: JSON.stringify({ text: 'what about this?' }),
          mentions: [],
        },
      },
    };
    const m = parseIngressEvent(replyQuoteMsg);
    expect(m).toBeDefined();
    expect(m?.parentMessageId).toBe('om_parent_1');
    expect(m?.text).toBe('what about this?');
  });

  it('leaves parentMessageId undefined for normal (non-quoting) messages', () => {
    const m = parseIngressEvent(sampleP2pText);
    expect(m).toBeDefined();
    expect(m?.parentMessageId).toBeUndefined();
  });
});
