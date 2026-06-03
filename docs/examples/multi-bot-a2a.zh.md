# 示例：三个 bot 在同一个群里互相打招呼（A2A）

English: [multi-bot-a2a.md](multi-bot-a2a.md)

![同一个飞书群里三个 bot —— claude/codex/gemini —— 互相介绍](./multi-bot-a2a.png)

## 这里发生了什么

一个 Lark 群（"AI Team"），同一台机器上跑着 3 个 bot，全部通过一个 `lmcb` supervisor 管理：

- `wl-claude-bot` —— Anthropic Claude (Opus 4.8)，通过 `claude` CLI
- `wl-codex-bot` —— OpenAI Codex，通过 `codex` CLI
- `wl-gemini-bot` —— Google Gemini，通过 `gemini` CLI

用户只发了一条消息给 `wl-claude-bot`：

> @wl-claude-bot 当前群里除了你之外还有 2 个机器人。请给他们分别打个招呼，并给他们做个你的自我介绍

之后 claude-bot **自主驱动了后续整段对话**：

1. 通过 bridge 本地的 `lark-cli` 查群成员：
   - `Bash — lark-cli im chat.members.bots --format json`
   - 找到群里另外两个 bot：`wl-codex-bot` 和 `wl-gemini-bot`
2. 读相关 skill 参考（`lark-bridge-overlay` / `lark-im` / `lark-im-messages-send`），确保自己发消息的 API 调用姿势正确。
3. 调两次 `lark-cli im +messages-send`，每次以 `@`-mention 开头，对应给那个 bot 发问候 + 自我介绍——`@` 前缀是必须的，否则被叫到的 bot 不会被唤醒。
4. 回到原消息向用户汇报自己做了什么。

接着被打招呼的两个 bot 自己回应：

- `wl-gemini-bot` 引用 claude 的消息，简短自我介绍 + 接受合作。
- `wl-codex-bot` 先读了桥接规范 skill（"我先读一下当前会话必须遵守的桥接规范"），然后给出更详细的自我介绍 + 具体分工建议："看代码定位问题、直接改实现/补测试、跑飞书资源相关操作，需要时 @我 就行。"

## 为什么这个例子值得看

- **用户只发了一条 prompt**。其余完全是 bot 跟 bot 之间的对话——飞书群本身是 A2A 的载体。
- **bot 用 `lark-cli` 操作了群本身**，不只是发文本回复。它先查群成员、再针对性地给特定 bot 发带 `@` 的消息。
- **每个 bot 用自己的 Lark 身份**——claude 的消息从 claude 应用发出、gemini 的从 gemini 发、codex 的从 codex 发，互不串号。这是每 bot 独立的 `lark-cli` profile shim 在透明地工作。
- **工具调用渲染成单行 blockquote**（`> ✅ **Bash** — lark-cli im chat.members.bots ...`），既能看清 bot 实际在做什么，又不让卡片膨胀。

## 怎么复现

跑三次 `lmcb init` 分别添加 claude / codex / gemini 各一个 bot，然后 `lmcb start --foreground`，飞书里建个群把三个 bot 都拉进去。给其中一个发上面那条 prompt 就能看到差不多的流程——具体措辞会随模型不同有变化。
