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
 * Lark's SDK may deliver the payload in two shapes depending on version:
 *   Shape A (common): fields at top level — open_chat_id, open_message_id,
 *                     operator.open_id, action.value
 *   Shape B (older):  fields at top level with snake_case — chat_id,
 *                     message_id, operator.open_id, action.value
 *
 * We try both and return undefined for payloads that are missing required fields.
 */
export function parseCardActionEvent(raw: unknown): CardActionEvent | undefined {
  const top = asObj(raw);
  if (!top) return undefined;

  // Resolve operator open_id.
  const operator = asObj(top['operator']);
  const operatorOpenId = asStr(operator?.['open_id']);
  if (!operatorOpenId) return undefined;

  // Resolve chatId — try open_chat_id first, then chat_id fallback.
  const chatId = asStr(top['open_chat_id']) ?? asStr(top['chat_id']);
  if (!chatId) return undefined;

  // Resolve messageId — try open_message_id first, then message_id fallback.
  const messageId = asStr(top['open_message_id']) ?? asStr(top['message_id']);
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
