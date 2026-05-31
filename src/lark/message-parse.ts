// SPDX-License-Identifier: MIT
import type { IngressMessage } from './types.js';

interface LarkMention {
  key?: string;
  id?: { open_id?: string };
  name?: string;
}

export interface ParseOpts {
  stripMentionOpenIds?: string[];
}

// Safe property accessor helpers to handle unknown-typed raw events.
function asObj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asArr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function asMention(v: unknown): LarkMention | undefined {
  const o = asObj(v);
  if (!o) return undefined;
  const id = asObj(o['id']);
  const openId = id !== undefined ? asStr(id['open_id']) : undefined;
  const mention: LarkMention = {};
  const key = asStr(o['key']);
  if (key !== undefined) mention.key = key;
  if (id !== undefined) {
    mention.id = openId !== undefined ? { open_id: openId } : {};
  }
  const name = asStr(o['name']);
  if (name !== undefined) mention.name = name;
  return mention;
}

export function parseIngressEvent(raw: unknown, opts: ParseOpts = {}): IngressMessage | undefined {
  const rawObj = asObj(raw);
  const event = asObj(rawObj?.['event']);
  const sender = asObj(event?.['sender']);
  const senderId = asStr(asObj(sender?.['sender_id'])?.['open_id']);
  const msg = asObj(event?.['message']);

  if (!msg || !senderId) return undefined;

  const chatId = asStr(msg['chat_id']);
  const messageId = asStr(msg['message_id']);
  if (!chatId || !messageId) return undefined;

  const rawMentions = asArr(msg['mentions']) ?? [];
  const mentions = rawMentions
    .map(asMention)
    .filter((m): m is LarkMention & { id: { open_id: string } } => {
      return m !== undefined && typeof m.id?.open_id === 'string' && m.id.open_id.length > 0;
    })
    .map((m) => ({ openId: m.id.open_id, name: m.name, key: m.key }));

  let text = '';
  const messageType = asStr(msg['message_type']);
  if (messageType === 'text') {
    try {
      const content = asStr(msg['content']) ?? '{}';
      const parsed: unknown = JSON.parse(content);
      text = asStr(asObj(parsed)?.['text']) ?? '';
    } catch {
      text = '';
    }
  }

  if (opts.stripMentionOpenIds !== undefined && opts.stripMentionOpenIds.length > 0) {
    for (const m of mentions) {
      const key = m.key;
      if (opts.stripMentionOpenIds.includes(m.openId) && key !== undefined) {
        text = text.split(key).join('').replace(/^\s+/, '');
      }
    }
  }

  const rawType: IngressMessage['rawType'] = ((): IngressMessage['rawType'] => {
    switch (messageType) {
      case 'text':
      case 'post':
      case 'interactive':
      case 'image':
      case 'file':
      case 'merge_forward':
      case 'audio':
        return messageType;
      default:
        return 'unknown';
    }
  })();

  const chatType: 'p2p' | 'group' = asStr(msg['chat_type']) === 'group' ? 'group' : 'p2p';

  const attachments: import('./types.js').RawAttachment[] = [];
  let cardJson: string | undefined;
  try {
    const content = asStr(msg['content']) !== undefined ? JSON.parse(asStr(msg['content'])!) : {};
    if (messageType === 'image' && typeof (content as Record<string, unknown>)['image_key'] === 'string') {
      const imageKey = (content as Record<string, unknown>)['image_key'] as string;
      attachments.push({
        fileKey: imageKey,
        fileName: `image-${imageKey}.png`,
        type: 'image',
      });
    }
    if (messageType === 'file' && typeof (content as Record<string, unknown>)['file_key'] === 'string') {
      const fileKey = (content as Record<string, unknown>)['file_key'] as string;
      const rawFileName = (content as Record<string, unknown>)['file_name'];
      attachments.push({
        fileKey,
        fileName: typeof rawFileName === 'string' ? rawFileName : `file-${fileKey}`,
        type: 'file',
      });
    }
    if (messageType === 'interactive') {
      const rawContent = asStr(msg['content']);
      if (rawContent !== undefined) cardJson = rawContent;
    }
  } catch {
    // leave attachments empty / cardJson undefined
  }

  return {
    chatId,
    chatType,
    senderOpenId: senderId,
    messageId,
    text,
    mentions: mentions.map(({ openId, name }) => {
      if (name !== undefined) {
        return { openId, name };
      }
      return { openId };
    }),
    rawType,
    attachments,
    ...(cardJson !== undefined ? { cardJson } : {}),
    receivedAt: new Date().toISOString(),
  };
}
