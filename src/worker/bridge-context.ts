// SPDX-License-Identifier: MIT
import type { IngressMessage } from '../lark/types.js';

export function buildBridgeContext(msg: IngressMessage): string {
  const parts: string[] = [];
  parts.push('<bridge_context>');
  parts.push(`chat_id: ${msg.chatId}`);
  parts.push(`chat_type: ${msg.chatType}`);
  parts.push(`sender_id: ${msg.senderOpenId}`);
  if (msg.senderName) parts.push(`sender_name: ${msg.senderName}`);
  parts.push('</bridge_context>');

  if (msg.quoted) {
    const q = msg.quoted;
    parts.push('');
    parts.push(
      `<quoted_message id="${q.id}" sender_id="${q.senderOpenId}"${
        q.senderName ? ` sender_name="${q.senderName}"` : ''
      } created_at="${q.createdAt}" type="${q.type}">`,
    );
    parts.push(q.content);
    parts.push('</quoted_message>');
  }

  if (msg.cardJson) {
    parts.push('');
    parts.push('<interactive_card>');
    try {
      parts.push(JSON.stringify(JSON.parse(msg.cardJson), null, 2));
    } catch {
      parts.push(msg.cardJson);
    }
    parts.push('</interactive_card>');
  }

  return parts.join('\n');
}
