// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { fetchQuotedContext, type MessageGetClient } from '../../src/lark/fetch-quote.js';

function stubClient(item: unknown): {
  client: MessageGetClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue({ data: { items: item === null ? [] : [item] } });
  const client: MessageGetClient = {
    im: { v1: { message: { get: spy } } },
  };
  return { client, spy };
}

function stubClientItems(items: unknown[]): {
  client: MessageGetClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue({ data: { items } });
  const client: MessageGetClient = {
    im: { v1: { message: { get: spy } } },
  };
  return { client, spy };
}

describe('fetchQuotedContext', () => {
  it('flattens a text parent message and surfaces sender + timestamp', async () => {
    const { client, spy } = stubClient({
      message_id: 'om_parent',
      msg_type: 'text',
      create_time: '1700000000000',
      sender: { id: 'ou_alice', id_type: 'open_id', sender_name: 'Alice' },
      body: { content: JSON.stringify({ text: 'original message' }) },
    });
    const q = await fetchQuotedContext(client, 'om_parent');
    expect(q).toBeDefined();
    expect(q?.id).toBe('om_parent');
    expect(q?.senderOpenId).toBe('ou_alice');
    expect(q?.senderName).toBe('Alice');
    expect(q?.type).toBe('text');
    expect(q?.content).toBe('original message');
    expect(q?.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(spy).toHaveBeenCalledWith({
      path: { message_id: 'om_parent' },
      params: { card_msg_content_type: 'user_card_content' },
    });
  });

  it('flattens a post parent message (multi-paragraph) into newline-joined text', async () => {
    const { client } = stubClient({
      message_id: 'om_post',
      msg_type: 'post',
      sender: { id: 'ou_bob' },
      body: {
        content: JSON.stringify({
          title: '',
          content: [
            [{ tag: 'text', text: 'line one' }],
            [{ tag: 'text', text: 'line two' }],
          ],
        }),
      },
    });
    const q = await fetchQuotedContext(client, 'om_post');
    expect(q?.type).toBe('post');
    expect(q?.content).toBe('line one\nline two');
  });

  it('preserves interactive card JSON pretty-printed', async () => {
    const card = { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'hi' }] } };
    const { client } = stubClient({
      message_id: 'om_card',
      msg_type: 'interactive',
      sender: { id: 'ou_carol' },
      body: { content: JSON.stringify(card) },
    });
    const q = await fetchQuotedContext(client, 'om_card');
    expect(q?.type).toBe('interactive');
    // Pretty-printed, so parsing it back gives us the original object.
    expect(JSON.parse(q!.content)).toEqual(card);
    // And it actually has newlines (pretty-print, not compact).
    expect(q?.content).toContain('\n');
  });

  it('falls back to a [type] marker for content the extractor returns empty', async () => {
    // Standalone image yields empty text from extractPromptFromContent.
    const { client } = stubClient({
      message_id: 'om_img',
      msg_type: 'image',
      sender: { id: 'ou_dan' },
      body: { content: JSON.stringify({ image_key: 'img_xyz' }) },
    });
    const q = await fetchQuotedContext(client, 'om_img');
    expect(q?.type).toBe('image');
    expect(q?.content).toBe('[image]');
  });

  it('returns undefined when the API call rejects', async () => {
    const client: MessageGetClient = {
      im: {
        v1: {
          message: {
            get: vi.fn().mockRejectedValue(new Error('network')),
          },
        },
      },
    };
    const q = await fetchQuotedContext(client, 'om_missing');
    expect(q).toBeUndefined();
  });

  it('returns undefined when the response has no items', async () => {
    const { client } = stubClient(null);
    const q = await fetchQuotedContext(client, 'om_empty');
    expect(q).toBeUndefined();
  });

  it('returns undefined when the parent item lacks a message_id', async () => {
    const { client } = stubClient({ msg_type: 'text', body: { content: '{}' } });
    const q = await fetchQuotedContext(client, 'om_broken');
    expect(q).toBeUndefined();
  });

  it('leaves senderName off when the SDK does not provide it', async () => {
    const { client } = stubClient({
      message_id: 'om_anon',
      msg_type: 'text',
      sender: { id: 'ou_eve' },
      body: { content: JSON.stringify({ text: 'hi' }) },
    });
    const q = await fetchQuotedContext(client, 'om_anon');
    expect(q?.senderOpenId).toBe('ou_eve');
    expect(q?.senderName).toBeUndefined();
  });

  it('expands merge_forward parents into a <forwarded_messages> block via SDK normalize', async () => {
    // im.v1.message.get on a merge_forward parent returns: the parent itself
    // plus all sub-messages (linked via upper_message_id). The SDK normalize
    // pipeline walks that list and emits a <forwarded_messages> envelope.
    const items = [
      {
        message_id: 'om_parent',
        msg_type: 'merge_forward',
        create_time: '1700000010000',
        sender: { id: 'ou_forwarder' },
        body: { content: JSON.stringify({ message_list: [] }) },
      },
      {
        message_id: 'om_sub_a',
        upper_message_id: 'om_parent',
        msg_type: 'text',
        create_time: '1700000011000',
        sender: { id: 'ou_alice', sender_name: 'Alice' },
        body: { content: JSON.stringify({ text: 'sub message one' }) },
      },
      {
        message_id: 'om_sub_b',
        upper_message_id: 'om_parent',
        msg_type: 'interactive',
        create_time: '1700000012000',
        sender: { id: 'ou_bob' },
        body: {
          content: JSON.stringify({
            schema: '2.0',
            body: { elements: [{ tag: 'markdown', content: 'a card body' }] },
          }),
        },
      },
    ];
    const { client } = stubClientItems(items);
    const q = await fetchQuotedContext(client, 'om_parent', {
      openId: 'ou_bot',
      name: 'mybot',
    });
    expect(q).toBeDefined();
    expect(q?.type).toBe('merge_forward');
    // The expanded content carries the SDK's forwarded envelope and the
    // sub-message texts (text directly; interactive routed through our
    // preExpandInteractive helper as an <interactive_card> block).
    expect(q?.content).toContain('<forwarded_messages>');
    expect(q?.content).toContain('sub message one');
    expect(q?.content).toContain('<interactive_card>');
    expect(q?.content).toContain('a card body');
  });

  it('handles missing create_time by emitting an empty createdAt', async () => {
    const { client } = stubClient({
      message_id: 'om_nots',
      msg_type: 'text',
      sender: { id: 'ou_f' },
      body: { content: JSON.stringify({ text: 'no time' }) },
    });
    const q = await fetchQuotedContext(client, 'om_nots');
    expect(q?.createdAt).toBe('');
  });
});
