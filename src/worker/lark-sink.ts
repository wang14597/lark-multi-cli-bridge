// SPDX-License-Identifier: MIT
import type * as Lark from '@larksuiteoapi/node-sdk';
import type { CardSink } from './card-streamer.js';

/**
 * LarkCardSink — backs CardStreamer with real Lark message API calls.
 *
 * When `replyTo` is set, the first card is sent via `im.message.reply`
 * against that message_id, so the card renders as a "回复 <user>:" quoted
 * reply (and the original message gets a "N 条回复" badge). Subsequent
 * patches still target the new message_id returned by reply().
 *
 * When `replyTo` is omitted, the first card is sent as a plain top-level
 * message via `im.message.create`. This is the right posture for
 * synthesized events (card-button callbacks via `__claude_cb`) where
 * there's no user message to quote.
 */
export class LarkCardSink implements CardSink {
  constructor(
    private client: Lark.Client,
    private chatId: string,
    private replyTo?: string,
  ) {}

  async create(card: unknown): Promise<string> {
    const content = JSON.stringify(card);
    const res = this.replyTo
      ? await this.client.im.message.reply({
          path: { message_id: this.replyTo },
          data: { content, msg_type: 'interactive' },
        })
      : await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: this.chatId, msg_type: 'interactive', content },
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
