// SPDX-License-Identifier: MIT

export interface CardActionEvent {
  chatId: string;
  messageId: string;
  operatorOpenId: string;
  cmd?: string;                          // value.cmd (optional — absent for LLM-emitted __claude_cb buttons)
  value: Record<string, unknown>;       // full value object for context
  receivedAt: string;
}

// Safe property accessor helpers (mirrors message-parse.ts conventions).
function asObj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parse a raw `card.action.trigger` event payload into a typed CardActionEvent.
 *
 * Lark's SDK may deliver the payload in three shapes depending on the card
 * schema version and SDK age:
 *   Shape A (legacy v1, top-level): open_chat_id, open_message_id at top
 *   Shape B (older snake_case):     chat_id, message_id at top
 *   Shape C (CardKit 2.0):          open_chat_id, open_message_id NESTED
 *                                   under `context` (this is what real
 *                                   schema:"2.0" cards deliver — see SDK's
 *                                   normalizeCardAction for the same chain)
 *
 * We probe all three. Missing the Shape C path made the ⏹ stop button
 * silently no-op in production: parser returned undefined, ws.ts's
 * `if (parsed) emit` swallowed it, dispatcher was never aborted.
 *
 * Returns undefined for payloads that are missing required fields.
 */
export function parseCardActionEvent(raw: unknown): CardActionEvent | undefined {
  const top = asObj(raw);
  if (!top) return undefined;

  // Resolve operator open_id.
  const operator = asObj(top['operator']);
  const operatorOpenId = asStr(operator?.['open_id']);
  if (!operatorOpenId) return undefined;

  const context = asObj(top['context']);

  // Resolve chatId — top-level open/snake variants first, then nested context
  // (CardKit 2.0 shape).
  const chatId =
    asStr(top['open_chat_id']) ??
    asStr(top['chat_id']) ??
    asStr(context?.['open_chat_id']);
  if (!chatId) return undefined;

  // Resolve messageId — same precedence as chatId.
  const messageId =
    asStr(top['open_message_id']) ??
    asStr(top['message_id']) ??
    asStr(context?.['open_message_id']);
  if (!messageId) return undefined;

  // Resolve action value object.
  const action = asObj(top['action']);
  if (!action) return undefined;

  const value = asObj(action['value']);
  if (!value) return undefined;

  const cmd = asStr(value['cmd']);

  return {
    chatId,
    messageId,
    operatorOpenId,
    ...(cmd !== undefined ? { cmd } : {}),
    value,
    receivedAt: new Date().toISOString(),
  };
}
