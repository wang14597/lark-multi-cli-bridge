// SPDX-License-Identifier: MIT
// Shared schema + parsing for "conclusion mode": the CLI is asked to return a
// dedicated, self-contained conclusion that the bridge sends as the final message.

// No length or form limits (user decision): only "this is the full final reply".
export const CONCLUSION_GUIDANCE =
  '给用户的最终回复：就是你平时会给出的完整回答，保留原有的 Markdown 排版（标题、列表、换行等）。' +
  '必须能独立阅读，不要依赖本次运行中之前输出的文字。';

export const CONCLUSION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { conclusion: { type: 'string', description: CONCLUSION_GUIDANCE } },
  required: ['conclusion'],
  additionalProperties: false,
};

export const CONCLUSION_PROMPT_HINT = `\n\n请在回复的最后单独给出一段结论：${CONCLUSION_GUIDANCE}`;

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
