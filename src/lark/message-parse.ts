// SPDX-License-Identifier: MIT
import type { IngressMessage, RawAttachment } from './types.js';

interface LarkMention {
  key?: string;
  id?: { open_id?: string };
  name?: string;
}

export interface ParsedMention {
  openId: string;
  name?: string;
  key?: string;
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

/**
 * Flatten a single `post` paragraph (inner array of inline elements) to a
 * Markdown string.  Images push a RawAttachment into `attachmentsOut` and
 * emit a `[image]` marker in the text stream.
 */
function flattenPostParagraph(
  nodes: unknown[],
  attachmentsOut: RawAttachment[],
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const n = asObj(node);
    if (!n) continue;
    const tag = asStr(n['tag']);
    switch (tag) {
      case 'text': {
        const t = asStr(n['text']);
        if (t !== undefined) parts.push(t);
        break;
      }
      case 'at': {
        const name = asStr(n['user_name']) ?? asStr(n['name']) ?? '';
        parts.push(`@${name}`);
        break;
      }
      case 'a': {
        const text = asStr(n['text']) ?? '';
        const href = asStr(n['href']) ?? '';
        parts.push(`[${text}](${href})`);
        break;
      }
      case 'img': {
        const imageKey = asStr(n['image_key']);
        if (imageKey !== undefined) {
          attachmentsOut.push({
            fileKey: imageKey,
            fileName: `image-${imageKey}.png`,
            type: 'image',
          });
          parts.push('[image]');
        }
        break;
      }
      case 'code_inline': {
        const t = asStr(n['text']) ?? '';
        parts.push(`\`${t}\``);
        break;
      }
      case 'code_block': {
        const t = asStr(n['text']) ?? '';
        parts.push(`\`\`\`\n${t}\n\`\`\``);
        break;
      }
      default: {
        // Unknown tag — render .text if any
        const t = asStr(n['text']);
        if (t !== undefined) parts.push(t);
        break;
      }
    }
  }
  return parts.join('');
}

/**
 * Pure function: given a Lark message_type + raw content string + parsed
 * mentions, return a { text, attachments } pair.
 *
 * - `text`   is the flattened prompt string (may be empty for truly empty
 *             messages — caller decides what to do with it).
 * - `attachments` collects any inline images found inside `post` content.
 *
 * This function does NOT strip bot mentions; the caller does that after
 * receiving the return value so the strip logic is centralised in one place.
 */
export function extractPromptFromContent(
  messageType: string,
  content: string,
  _mentions: ParsedMention[],
): { text: string; attachments: RawAttachment[] } {
  const attachments: RawAttachment[] = [];

  switch (messageType) {
    case 'text': {
      try {
        const parsed: unknown = JSON.parse(content);
        const text = asStr(asObj(parsed)?.['text']) ?? '';
        return { text, attachments };
      } catch {
        return { text: '', attachments };
      }
    }

    case 'post': {
      try {
        const parsed = asObj(JSON.parse(content));
        if (!parsed) return { text: '', attachments };
        // Lark post content is: { "title": "...", "content": [[...], [...]] }
        // The outer array is paragraphs; each inner array is inline elements.
        const paragraphsRaw = asArr(parsed['content']) ?? [];
        const paragraphStrings: string[] = [];
        for (const para of paragraphsRaw) {
          const nodes = asArr(para) ?? [];
          const paraText = flattenPostParagraph(nodes, attachments);
          paragraphStrings.push(paraText);
        }
        const text = paragraphStrings.join('\n');
        return { text, attachments };
      } catch {
        return { text: '', attachments };
      }
    }

    case 'image': {
      // Image attachment is handled separately in the main parser;
      // text is empty for standalone image messages.
      return { text: '', attachments };
    }

    case 'file': {
      // File attachment is handled separately in the main parser;
      // text is empty for standalone file messages.
      return { text: '', attachments };
    }

    case 'audio': {
      // Lark doesn't provide a transcript. Emit a text marker so the worker
      // doesn't silently drop the message.
      try {
        const parsed = asObj(JSON.parse(content));
        const duration = parsed ? (asStr(parsed['duration']) ?? '') : '';
        const marker = duration ? `[audio ${duration} seconds]` : '[audio]';
        return { text: marker, attachments };
      } catch {
        return { text: '[audio]', attachments };
      }
    }

    case 'merge_forward': {
      // TODO: full flatten of inner messages requires an extra Lark API call
      // (get_messages_by_root_id or similar) which is not available in the
      // current LarkWsClient. For now, emit a text marker so the message is
      // not silently dropped.
      try {
        const parsed = asObj(JSON.parse(content));
        const count =
          parsed !== undefined
            ? (asArr(parsed['message_list'])?.length ?? asArr(parsed['messages'])?.length)
            : undefined;
        const marker =
          count !== undefined ? `[merge_forward ${count} messages]` : '[merge_forward messages]';
        return { text: marker, attachments };
      } catch {
        return { text: '[merge_forward messages]', attachments };
      }
    }

    default:
      return { text: '', attachments };
  }
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

  const messageType = asStr(msg['message_type']) ?? '';
  const rawContentStr = asStr(msg['content']) ?? '{}';

  // ------------------------------------------------------------------
  // Parse text + inline attachments from the message content.
  // ------------------------------------------------------------------
  const parsedMentions: ParsedMention[] = mentions.map((m) => ({
    openId: m.openId,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.key !== undefined ? { key: m.key } : {}),
  }));
  const { text: extractedText, attachments: contentAttachments } = extractPromptFromContent(
    messageType,
    rawContentStr,
    parsedMentions,
  );

  // Strip bot @-mention tokens from the text so the prompt stays clean.
  let text = extractedText;
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

  // ------------------------------------------------------------------
  // Handle standalone image/file attachments and interactive card JSON.
  // ------------------------------------------------------------------
  const attachments: RawAttachment[] = [...contentAttachments];
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
