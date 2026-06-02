// SPDX-License-Identifier: MIT
import type * as Lark from '@larksuiteoapi/node-sdk';
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
 * Fetch and render the content of a message the user is reply-quoting.
 *
 * Strategy:
 * 1. Call `im.v1.message.get` with `card_msg_content_type=user_card_content` so
 *    interactive cards come back as their original schema-2.0 body, not the
 *    "[请升级客户端]" v1 fallback the platform double-emits.
 * 2. For `interactive` messages, surface the raw card JSON unchanged — same
 *    shape the bridge already injects for the current-turn `<interactive_card>`
 *    block, so the LLM-side conventions stay symmetric.
 * 3. For everything else, run through `extractPromptFromContent` — the same
 *    pure function the live-event parser uses. text/post get flattened, audio
 *    gets a `[audio N seconds]` marker, merge_forward gets a count marker.
 *
 * Returns `undefined` on any API/parse failure — the caller should still pass
 * the user's message through; the only loss is the quoted-block.
 */
export async function fetchQuotedContext(
  client: MessageGetClient,
  messageId: string,
): Promise<QuotedMessage | undefined> {
  let parent: QuoteApiMessageItem | undefined;
  try {
    const r = await client.im.v1.message.get({
      path: { message_id: messageId },
      // Ask for the original card body (incl. v2 user_dsl) instead of the
      // legacy v1-canonical fallback. SDK ≥ 1.65.0 supports this.
      params: { card_msg_content_type: 'user_card_content' },
    });
    parent = r?.data?.items?.[0];
  } catch {
    return undefined;
  }

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
  } else {
    const { text } = extractPromptFromContent(msgType, rawContent, []);
    // For empty extractor output (audio/merge_forward/image/file with no
    // metadata), leave a bare type marker so the LLM at least knows what was
    // quoted.
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
