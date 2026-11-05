// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { LarkCardSink } from '../../src/worker/lark-sink.js';
import type * as Lark from '@larksuiteoapi/node-sdk';

interface FakeIm {
  message: {
    create: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
  };
}

function makeClient(overrides?: Partial<FakeIm['message']>): {
  client: Lark.Client;
  im: FakeIm;
} {
  const im: FakeIm = {
    message: {
      create:
        overrides?.create ?? vi.fn().mockResolvedValue({ data: { message_id: 'msg_new_top' } }),
      reply:
        overrides?.reply ?? vi.fn().mockResolvedValue({ data: { message_id: 'msg_new_reply' } }),
      patch: overrides?.patch ?? vi.fn().mockResolvedValue({}),
    },
  };
  return { client: { im } as unknown as Lark.Client, im };
}

describe('LarkCardSink', () => {
  it('without replyTo: first card uses im.message.create against chatId', async () => {
    const { client, im } = makeClient();
    const sink = new LarkCardSink(client, 'oc_chat_1');
    const card = { schema: '2.0', body: { elements: [] } };
    const id = await sink.create(card);
    expect(id).toBe('msg_new_top');
    expect(im.message.create).toHaveBeenCalledOnce();
    expect(im.message.reply).not.toHaveBeenCalled();
    const arg = im.message.create.mock.calls[0]![0];
    expect(arg).toMatchObject({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_chat_1', msg_type: 'interactive' },
    });
    expect(JSON.parse(arg.data.content)).toEqual(card);
  });

  it('with replyTo: first card uses im.message.reply against that message_id', async () => {
    const { client, im } = makeClient();
    const sink = new LarkCardSink(client, 'oc_chat_1', 'om_user_msg_42');
    const card = { schema: '2.0', body: { elements: [] } };
    const id = await sink.create(card);
    expect(id).toBe('msg_new_reply');
    expect(im.message.reply).toHaveBeenCalledOnce();
    expect(im.message.create).not.toHaveBeenCalled();
    const arg = im.message.reply.mock.calls[0]![0];
    expect(arg).toMatchObject({
      path: { message_id: 'om_user_msg_42' },
      data: { msg_type: 'interactive' },
    });
    expect(JSON.parse(arg.data.content)).toEqual(card);
  });

  it('patch always targets the new message_id, irrespective of replyTo', async () => {
    const { client, im } = makeClient();
    const sink = new LarkCardSink(client, 'oc_chat_1', 'om_user_msg_42');
    await sink.patch('msg_card_1', { foo: 'bar' });
    expect(im.message.patch).toHaveBeenCalledOnce();
    const arg = im.message.patch.mock.calls[0]![0];
    expect(arg.path.message_id).toBe('msg_card_1');
    expect(JSON.parse(arg.data.content)).toEqual({ foo: 'bar' });
  });

  it('throws when create response carries no message_id', async () => {
    const { client } = makeClient({
      create: vi.fn().mockResolvedValue({ data: {} }),
    });
    const sink = new LarkCardSink(client, 'oc_chat_1');
    await expect(sink.create({})).rejects.toThrow(/no message_id/);
  });

  it('throws when reply response carries no message_id', async () => {
    const { client } = makeClient({
      reply: vi.fn().mockResolvedValue({ data: {} }),
    });
    const sink = new LarkCardSink(client, 'oc_chat_1', 'om_user_msg_42');
    await expect(sink.create({})).rejects.toThrow(/no message_id/);
  });
});
