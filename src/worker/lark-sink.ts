// SPDX-License-Identifier: MIT
import type * as Lark from '@larksuiteoapi/node-sdk';
import type { CardSink } from './card-streamer.js';

export class LarkCardSink implements CardSink {
  constructor(private client: Lark.Client, private chatId: string) {}

  async create(card: unknown): Promise<string> {
    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: this.chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    });
    const msgId = (res as unknown as { data?: { message_id?: string } }).data?.message_id;
    if (!msgId) throw new Error('Lark create card returned no message_id');
    return msgId;
  }

  async patch(cardId: string, card: unknown): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: cardId },
      data: { content: JSON.stringify(card) },
    });
  }
}
