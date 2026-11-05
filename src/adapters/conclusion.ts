// SPDX-License-Identifier: MIT
// Shared schema + parsing for "conclusion mode": the CLI is asked to return a
// dedicated, self-contained conclusion that the bridge sends as the final message.

export const CONCLUSION_GUIDANCE =
  '写给用户看的最终结论，可使用 Markdown，必须能独立阅读，不要依赖本次运行中之前输出的文字。' +
  '默认简短（1-5 句话）：成功时写出关键结果（如 ID、链接、标题）；失败时写明卡在了哪一步、用户需要做什么。' +
  '如果用户要求了格式或内容（如按点列出、给出清单或全文），按用户的要求完整给出，用 Markdown 列表分行，不要压成一段话。';

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
