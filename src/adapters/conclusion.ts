// SPDX-License-Identifier: MIT
// Shared schema + parsing for "conclusion mode": the CLI is asked to return a
// dedicated, self-contained conclusion that the bridge sends as the final message.

// No prompt text (user decision): the schema only adds a bare `conclusion` string field.
export const CONCLUSION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { conclusion: { type: 'string' } },
  required: ['conclusion'],
  additionalProperties: false,
};

export function parseConclusionJson(text: string): string | undefined {
  try {
    const v: unknown = JSON.parse(text);
    const c = (v as { conclusion?: unknown } | null)?.conclusion;
    return typeof c === 'string' && c.trim() ? c.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function looksLikeJson(text: string): boolean {
  return /^\s*[{[]/.test(text);
}
