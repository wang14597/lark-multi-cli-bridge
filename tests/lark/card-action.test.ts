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
