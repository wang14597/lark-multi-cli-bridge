// SPDX-License-Identifier: MIT
export interface IngressMessage {
  chatId: string;
  chatType: 'p2p' | 'group';
  senderOpenId: string;
  senderName?: string;
  messageId: string;
  text: string;
  mentions: Array<{ openId: string; name?: string }>;
  rawType: 'text' | 'post' | 'interactive' | 'image' | 'file' | 'merge_forward' | 'audio' | 'unknown';
  /**
   * Set when the user reply-quoted another message (raw event's
   * `message.parent_id`). The actual quoted content is fetched lazily in the
   * worker via `fetchQuotedContext` — parser only extracts the id.
   */
  parentMessageId?: string;
  quoted?: QuotedMessage;
  cardJson?: string;
  attachments: RawAttachment[];
  receivedAt: string;
}

export interface QuotedMessage {
  id: string;
  senderOpenId: string;
  senderName?: string;
  createdAt: string;
  type: string;
  content: string;
}

export interface RawAttachment {
  fileKey: string;
  fileName: string;
  type: 'image' | 'file';
  mimeType?: string;
  size?: number;
}
