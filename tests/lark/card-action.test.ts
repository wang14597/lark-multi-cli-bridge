// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseCardActionEvent } from '../../src/lark/card-action.js';

describe('parseCardActionEvent', () => {
  it('extracts chatId, messageId, cmd', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_chat1',
      open_message_id: 'om_msg1',
      action: { tag: 'button', value: { cmd: 'stop' }, name: 'stop_btn' },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed).toMatchObject({
      chatId: 'oc_chat1',
      messageId: 'om_msg1',
      operatorOpenId: 'ou_user',
      cmd: 'stop',
      value: { cmd: 'stop' },
    });
  });

  it('returns undefined for malformed payloads', () => {
    expect(parseCardActionEvent({})).toBeUndefined();
    expect(parseCardActionEvent({ operator: {} })).toBeUndefined();
  });

  it('also accepts the alternate shape with chat_id', () => {
    const raw = {
      operator: { open_id: 'ou_x' },
      chat_id: 'oc_chat2',
      message_id: 'om_msg2',
      action: { value: { cmd: 'new' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed?.chatId).toBe('oc_chat2');
    expect(parsed?.cmd).toBe('new');
  });
});

describe('parseCardActionEvent — __claude_cb buttons (no cmd)', () => {
  it('parses a button whose value has only __claude_cb (no cmd)', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_chat3',
      open_message_id: 'om_msg3',
      action: { tag: 'button', value: { __claude_cb: true, choice: 'a' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed).toBeDefined();
    expect(parsed?.chatId).toBe('oc_chat3');
    expect(parsed?.cmd).toBeUndefined();
    expect(parsed?.value).toEqual({ __claude_cb: true, choice: 'a' });
  });

  it('still parses a button with both cmd and __claude_cb', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_chat4',
      open_message_id: 'om_msg4',
      action: { value: { __claude_cb: true, cmd: 'something' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed?.cmd).toBe('something');
    expect(parsed?.value).toEqual({ __claude_cb: true, cmd: 'something' });
  });
});
