// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { renderConclusionPost, toPostMarkdown } from '../../src/lark/conclusion-post.js';

type Post = { zh_cn: { content: { tag: string; text?: string; user_id?: string }[][] } };

describe('renderConclusionPost', () => {
  it('puts the conclusion in a single md paragraph', () => {
    const post = renderConclusionPost('卡片 **WIZLYNN-1** 已创建') as Post;
    expect(post.zh_cn.content).toEqual([[{ tag: 'md', text: '卡片 **WIZLYNN-1** 已创建' }]]);
  });

  it('adds an @mention line first when given', () => {
    const post = renderConclusionPost('ok', 'ou_x') as Post;
    expect(post.zh_cn.content[0]).toEqual([{ tag: 'at', user_id: 'ou_x' }]);
    expect(post.zh_cn.content[1]).toEqual([{ tag: 'md', text: 'ok' }]);
  });

  it('caps a huge body at 8000 chars plus an ellipsis', () => {
    const post = renderConclusionPost('x'.repeat(20_000)) as Post;
    expect(post.zh_cn.content[0]![0]!.text).toBe('x'.repeat(8000) + '…');
  });
});

describe('toPostMarkdown', () => {
  it('turns headings into bold lines', () => {
    expect(toPostMarkdown('# 标题\n## 第 1 步：ruff ##\n正文')).toBe('**标题**\n**第 1 步：ruff**\n正文');
  });

  it('turns a table into a bold header line plus one bullet per row', () => {
    const md = '| # | 检查项 | 阈值 |\n|---|:---:|---|\n| 1 | 函数分支太多 | > 12 个 |\n| 2 | 参数太多 | > 5 个 |\n\n下一段';
    expect(toPostMarkdown(md)).toBe(
      '**# · 检查项 · 阈值**\n- 1 · 函数分支太多 · > 12 个\n- 2 · 参数太多 · > 5 个\n\n下一段',
    );
  });

  it('leaves lists, bold, pipes in prose and fenced code untouched', () => {
    const md = '- **a**: x\n1. y\nrun `a | b`\n```\n# not a heading\n| a | b |\n|---|---|\n```';
    expect(toPostMarkdown(md)).toBe(md);
  });
});
