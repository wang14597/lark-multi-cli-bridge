// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { renderConclusionPost } from '../../src/lark/conclusion-post.js';

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
