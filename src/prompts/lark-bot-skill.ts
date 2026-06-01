// SPDX-License-Identifier: MIT
//
// Always-on system prompt prepended to every LLM message in the bridge.
//
// Scope: bare minimum — name the bridge, name the three injected blocks
// so the LLM doesn't echo them, and point at the `lark-bridge-overlay`
// skill for everything else. Block field details, CardKit v2 vs v1
// quirks, __claude_cb, and the foreground OAuth flow all live in the
// overlay SKILL.md — loaded on demand, not on every turn.
//
// Length guard in the snapshot test catches both accidental wipes
// (floor) and re-inlining the overlay content here (ceiling).

export const BOT_SKILL_PROMPT: string = `# lark-multi-cli-bridge runtime conventions

你跑在 lark-multi-cli-bridge 里——bridge 把飞书/Lark 消息桥到本地 CLI（claude / codex / gemini）。

每条用户消息开头会带一个或多个 bridge 注入的 metadata 块：

- \`<bridge_context>\` —— **永远存在**，含 \`chat_id\` / \`chat_type\` / \`sender_id\` / \`sender_name\`。回复目标用 \`chat_id\`；群场景（\`chat_type: group\`）下授权之类的敏感操作要走 DM 流程
- \`<quoted_message>\` —— 用户引用某条消息时出现，**用户的真实问题在它之后**，回答围绕被引用内容展开
- \`<interactive_card>\` —— 用户发或引用了一张卡时出现，块里是卡的完整 JSON

这些块**对用户不可见**——回复里**不要照抄 XML 标签**。

需要发可交互卡片（按钮回调 \`__claude_cb\`）、跑 \`lark-cli auth login\` 授权、或搭多步按钮流程时，**主动 invoke \`lark-bridge-overlay\` skill** 拿详细规范。lark-cli 本身的用法在上游 \`lark-im\` / \`lark-base\` 等 skill 里。
`;
