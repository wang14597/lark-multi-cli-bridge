// SPDX-License-Identifier: MIT
import type * as Lark from '@larksuiteoapi/node-sdk';
import { normalize } from '@larksuiteoapi/node-sdk';
import type { ApiMessageItem, RawMessageEvent } from '@larksuiteoapi/node-sdk';
import { extractPromptFromContent } from './message-parse.js';
import type { QuotedMessage } from './types.js';

/**
 * The single SDK message item we care about. Mirrors the slice of
 * `im.v1.message.get` response that's stable across SDK versions; everything
 * else on the wire is ignored.
 */
export interface QuoteApiMessageItem {
  message_id?: string;
  msg_type?: string;
  create_time?: string | number;
  chat_id?: string;
  sender?: { id?: string; id_type?: string; sender_name?: string };
  body?: { content?: string };
  mentions?: Array<{ key?: string; id?: string; name?: string }>;
}

/**
 * Minimal client interface for `im.v1.message.get`. Captured as a separate
 * type so unit tests can hand-roll a stub without dragging in the full SDK
 * Client, and the SDK's deeply-optional return shape doesn't leak into
 * downstream call sites.
 */
export interface MessageGetClient {
  im: {
    v1: {
      message: {
        get: (payload: {
          params?: { card_msg_content_type?: string };
          path: { message_id: string };
        }) => Promise<{ data?: { items?: QuoteApiMessageItem[] } }>;
      };
    };
  };
}

/**
 * Identity for the bot, threaded into `normalize`. Required by the SDK's
 * NormalizeOptions; the merge_forward converter uses it to label which
 * forwarded sub-messages were authored by the bot itself. Defaults are safe
 * if the worker hasn't resolved its open_id yet.
 */
export interface QuoteBotIdentity {
  openId: string;
  name: string;
}

/**
 * Pre-expand an interactive sub-message body so the SDK's merge_forward
 * converter (walkCard) renders something useful instead of the literal
 * `[interactive card]` placeholder.
 *
 * Mechanism: walkCard recognises `plain_text` / `lark_md` / `markdown` tags
 * as text-bearing. We wrap the pretty-printed card JSON inside a `plain_text`
 * node — same surface lmcb's live-card `<interactive_card>` block exposes —
 * so the LLM sees the actual card content quoted inside the merge_forward.
 */
function preExpandInteractive(item: QuoteApiMessageItem): QuoteApiMessageItem {
  if (item.msg_type !== 'interactive') return item;
  const raw = item.body?.content;
  if (typeof raw !== 'string' || raw.length === 0) return item;
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    pretty = raw;
  }
  const wrapped = JSON.stringify({
    tag: 'plain_text',
    content: `<interactive_card>\n${pretty}\n</interactive_card>`,
  });
  return { ...item, body: { ...item.body, content: wrapped } };
}

/**
 * Render a merge_forward parent through the SDK `normalize` pipeline so the
 * resulting `<forwarded_messages>` block carries the actual flattened
 * sub-messages instead of just a count marker.
 *
 * `fetchSubMessages` reuses the already-loaded `items` for the parent id (the
 * SDK fetches them again otherwise) and falls back to a fresh API call for
 * nested merge_forward layers. Interactive sub-messages get pre-expanded so
 * their content survives walkCard.
 */
async function renderMergeForward(
  client: MessageGetClient,
  parent: QuoteApiMessageItem,
  items: QuoteApiMessageItem[],
  botIdentity: QuoteBotIdentity,
): Promise<string | undefined> {
  const fakeRaw: RawMessageEvent = {
    sender: { sender_id: { open_id: parent.sender?.id ?? '' } },
    message: {
      message_id: parent.message_id!,
      // chat_id / chat_type aren't validated by normalize; empty + 'group'
      // are the safest defaults (matches the reference impl).
      chat_id: '',
      chat_type: 'group',
      message_type: 'merge_forward',
      content: parent.body?.content ?? '',
      ...(parent.create_time !== undefined
        ? { create_time: String(parent.create_time) }
        : {}),
      // The SDK's RawMention type expects `{ id: { open_id, ... } }` but the
      // get-response mentions are flat `{ id: string, id_type }`. The SDK
      // tolerates either at runtime; the cast just bypasses the type mismatch.
      // Cast to NonNullable so exactOptionalPropertyTypes doesn't reject the
      // possibly-undefined element type from RawMessageEvent's optional field.
      ...(parent.mentions
        ? { mentions: parent.mentions as unknown as NonNullable<RawMessageEvent['message']['mentions']> }
        : {}),
    },
  };

  const fetchSubMessages = async (mid: string): Promise<ApiMessageItem[]> => {
    if (mid === parent.message_id) {
      return items.map(preExpandInteractive) as unknown as ApiMessageItem[];
    }
    // Nested merge_forward: pull fresh from the API. Same card-content flag so
    // any v2 cards inside come back as their real schema-2.0 body.
    try {
      const r = await client.im.v1.message.get({
        path: { message_id: mid },
        params: { card_msg_content_type: 'user_card_content' },
      });
      return (r?.data?.items ?? []).map(preExpandInteractive) as unknown as ApiMessageItem[];
    } catch {
      return [];
    }
  };

  try {
    const normalized = await normalize(fakeRaw, {
      botIdentity,
      fetchSubMessages,
      // We want the raw forwarded text, not the trimmed @bot mention form.
      stripBotMentions: false,
    });
    return normalized.content;
  } catch {
    return undefined;
  }
}

/**
 * Fetch and render the content of a message the user is reply-quoting.
 *
 * Strategy:
 * 1. Call `im.v1.message.get` with `card_msg_content_type=user_card_content` so
 *    interactive cards come back as their original schema-2.0 body, not the
 *    "[请升级客户端]" v1 fallback the platform double-emits.
 * 2. For `interactive` parents, surface the raw card JSON unchanged — same
 *    shape the bridge already injects for the current-turn `<interactive_card>`
 *    block, so the LLM-side conventions stay symmetric.
 * 3. For `merge_forward` parents, route through SDK `normalize` with a
 *    `fetchSubMessages` callback so the resulting `<forwarded_messages>` block
 *    is expanded with the actual sub-message contents (text + interactive
 *    cards), not just a count marker.
 * 4. For everything else, run through `extractPromptFromContent` — the same
 *    pure function the live-event parser uses. text/post get flattened, audio
 *    gets a `[audio N seconds]` marker.
 *
 * Returns `undefined` on any API/parse failure — the caller should still pass
 * the user's message through; the only loss is the quoted-block.
 */
export async function fetchQuotedContext(
  client: MessageGetClient,
  messageId: string,
  botIdentity: QuoteBotIdentity = { openId: '', name: '' },
): Promise<QuotedMessage | undefined> {
  let items: QuoteApiMessageItem[] = [];
  try {
    const r = await client.im.v1.message.get({
      path: { message_id: messageId },
      params: { card_msg_content_type: 'user_card_content' },
    });
    items = r?.data?.items ?? [];
  } catch {
    return undefined;
  }

  const parent = items[0];
  if (!parent?.message_id) return undefined;

  const msgType = parent.msg_type ?? 'text';
  const rawContent = parent.body?.content ?? '';

  // Render content according to the parent's message type.
  let content: string;
  if (msgType === 'interactive') {
    // Mirror the live-card path: pretty-print the JSON so the LLM can read
    // structure, fall back to raw on parse error.
    try {
      content = JSON.stringify(JSON.parse(rawContent), null, 2);
    } catch {
      content = rawContent;
    }
  } else if (msgType === 'merge_forward') {
    const expanded = await renderMergeForward(client, parent, items, botIdentity);
    // normalize failure / empty output → fall back to the count marker so the
    // LLM at least knows what was quoted.
    content = expanded && expanded.length > 0
      ? expanded
      : (extractPromptFromContent(msgType, rawContent, []).text || '[merge_forward messages]');
  } else {
    const { text } = extractPromptFromContent(msgType, rawContent, []);
    // For empty extractor output (audio/image/file with no metadata), leave a
    // bare type marker so the LLM at least knows what was quoted.
    content = text.length > 0 ? text : `[${msgType}]`;
  }

  // sender.id may be open_id / union_id / user_id depending on id_type;
  // open_id is what bridge_context conventions assume — callers should pass a
  // client whose default id_type is open_id (the SDK default).
  const senderId = parent.sender?.id ?? '';
  const senderName = parent.sender?.sender_name;

  const createMs =
    parent.create_time !== undefined
      ? Number.parseInt(String(parent.create_time), 10)
      : 0;
  const createdAt =
    Number.isFinite(createMs) && createMs > 0
      ? new Date(createMs).toISOString()
      : '';

  return {
    id: parent.message_id,
    senderOpenId: senderId,
    ...(senderName ? { senderName } : {}),
    createdAt,
    type: msgType,
    content,
  };
}

/**
 * Cast helper for callers holding a full SDK `Lark.Client`. The SDK's full
 * type is deeply optional; this narrows it to the shape `fetchQuotedContext`
 * actually depends on without making every call site repeat the cast.
 */
export function asMessageGetClient(client: Lark.Client): MessageGetClient {
  return client as unknown as MessageGetClient;
}
