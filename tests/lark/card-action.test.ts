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

describe('parseCardActionEvent — schema 2.0 cards (context-nested IDs)', () => {
  // Real Lark `card.action.trigger` events for CardKit 2.0 cards (which is
  // what we render — schema: "2.0" in card-builder.ts) put open_chat_id and
  // open_message_id INSIDE `context`, not at the top level. The SDK flattens
  // the outer `event` wrapper but leaves `context` nested. Missing this path
  // is what made the ⏹ stop button silently fail in production — parser
  // returned undefined, ws.ts `if (parsed) emit` swallowed it, dispatcher
  // was never aborted. See SDK's own normalizeCardAction in node-sdk for
  // the reference fallback chain.
  it('extracts IDs from event.context when top-level absent (schema 2.0 shape)', () => {
    const raw = {
      // No top-level open_chat_id / open_message_id — they're nested.
      operator: { open_id: 'ou_user', tenant_key: 'tk' },
      action: { tag: 'button', value: { cmd: 'stop' } },
      context: {
        open_chat_id: 'oc_schema_v2',
        open_message_id: 'om_schema_v2',
      },
      host: 'im_message',
      delivery_type: 'lark_oapi_card_v2',
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed).toMatchObject({
      chatId: 'oc_schema_v2',
      messageId: 'om_schema_v2',
      operatorOpenId: 'ou_user',
      cmd: 'stop',
      value: { cmd: 'stop' },
    });
  });

  it('prefers top-level IDs over context when both are present (legacy compat)', () => {
    const raw = {
      operator: { open_id: 'ou_user' },
      open_chat_id: 'oc_top_wins',
      open_message_id: 'om_top_wins',
      context: { open_chat_id: 'oc_nested', open_message_id: 'om_nested' },
      action: { value: { cmd: 'stop' } },
    };
    const parsed = parseCardActionEvent(raw);
    expect(parsed?.chatId).toBe('oc_top_wins');
    expect(parsed?.messageId).toBe('om_top_wins');
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
