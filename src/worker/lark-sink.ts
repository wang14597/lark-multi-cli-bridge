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

/** What ConclusionStreamer needs: a status reaction on the user's message and one reply. */
export interface ReplySink {
  /** Returns the reaction id, or undefined when there is no user message to react to. */
  react(emojiType: string): Promise<string | undefined>;
  unreact(reactionId: string): Promise<void>;
  sendPost(content: object): Promise<void>;
}

/**
 * LarkReplySink — backs /mode final. Reacts on and quote-replies to `replyTo`
 * (the user's message); without it (synthesized card-click runs) there is
 * nothing to react to and the reply goes out top-level.
 */
export class LarkReplySink implements ReplySink {
  constructor(
    private client: Lark.Client,
    private chatId: string,
    private replyTo?: string,
  ) {}

  async react(emojiType: string): Promise<string | undefined> {
    if (!this.replyTo) return undefined;
    const res = await this.client.im.messageReaction.create({
      path: { message_id: this.replyTo },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    return (res as unknown as { data?: { reaction_id?: string } }).data?.reaction_id;
  }

  async unreact(reactionId: string): Promise<void> {
    if (!this.replyTo) return;
    await this.client.im.messageReaction.delete({
      path: { message_id: this.replyTo, reaction_id: reactionId },
    });
  }

  async sendPost(content: object): Promise<void> {
    const data = { content: JSON.stringify(content), msg_type: 'post' };
    if (this.replyTo) {
      await this.client.im.message.reply({ path: { message_id: this.replyTo }, data });
    } else {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: this.chatId, ...data },
      });
    }
  }
}
