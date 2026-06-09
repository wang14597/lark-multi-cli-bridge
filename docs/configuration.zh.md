# 配置

English: [configuration.md](configuration.md)

`bot.yaml` 里你最可能想调的开关。绝大多数 bot 默认值就够用——这里是给你想 override 某些行为时用的参考。

Agent skill 的安装**不在**这份文档里——它是 `lmcb init` 交互流程的一部分。详见 [quickstart](quickstart.zh.md) → 第 5 步：作用是什么、跳过会怎样、后补怎么装。

## Skill prompt 注入

不管什么后端，每个 bot 默认都会被注入一段 bot-skill prompt，教 LLM 怎么处理 bridge 注入的 `<bridge_context>` / `<quoted_message>` / `<interactive_card>` 块、怎么通过本地 `lark-cli` 发交互卡片（含通过 `__claude_cb` 标记做按钮回调）、怎么安全地走 `lark-cli auth login` 的 device flow。

两个 per-backend YAML 字段控制注入：

```yaml
backend:
  type: codex
  codex:
    extra_args: []
  injectSkillPrompt: true        # 默认 true，设为 false 可关闭
  appendSystemPrompt: |          # 可选，会拼接在 skill prompt 之后
    针对这个 bot 的额外指令。
```

各后端的注入机制：
- `claude`：通过 `--append-system-prompt <text>` flag 传入。
- `codex` / `gemini`：直接前置到 prompt，与用户输入之间用 `\n\n---\n\n` 分隔。

## LLM 卡片按钮回调（`__claude_cb`）

如果 LLM 发了一张交互卡片，按钮的 `value` 里带 `__claude_cb: true`，那用户点这个按钮时会重新触发同一个 LLM session，注入一条合成的 `[card-click] {...}` 消息（`__claude_cb` 标记会先剥掉再转发）。LLM 可以借此实现"用户点按钮 → bot 接着处理"的多步流程。

示例按钮（CardKit 2.0）：

```json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__claude_cb": true, "choice": "a" }
  }]
}
```

**不带** `__claude_cb` 的按钮（比如 bridge 自己 `/status` 卡片上的按钮）仍走内部命令路由，跟以前一样——LLM 看不到这种点击。

## codex：`skip_git_repo_check`

`codex exec` 默认拒绝在非 Git 仓库目录（或没在 `~/.codex/config.toml` 里显式信任的目录）下运行，除非加 `--skip-git-repo-check`。bridge bot 常指向 `$HOME` 等非仓库目录，所以默认会为每个 codex bot 加这个 flag。如果你确实想让 codex 自己的 trust 检查生效，可以 per bot 关掉：

```yaml
backend:
  type: codex
  codex:
    skip_git_repo_check: false   # 默认 true，设为 false 走 codex 自己的 trust 检查
```

## codex：`bypass_sandbox`

`codex exec` 跑在 OS 沙箱里（macOS 是 Apple Seatbelt，Linux 是 Landlock），
默认禁止联网、只许写工作目录。这个沙箱会拦住 bot 联网、`git push`、调用
`lark-cli`——而 claude backend 这些全能做，因为 `ClaudeAdapter` 默认
`--permission-mode bypassPermissions`。

为对齐这个默认，bridge 会给每个 codex bot 传
`--dangerously-bypass-approvals-and-sandbox`，授予同等的完整机器 + 网络访问权。
该选项**默认开启**（`lmcb bot add` 会把 `bypass_sandbox: true` 写进生成的 yaml）。
可 per bot 关掉以保留 codex 原生沙箱：

```yaml
backend:
  type: codex
  codex:
    bypass_sandbox: false   # 默认 true，设为 false 保留 codex 的 OS 沙箱
```

若你想要细粒度控制，把自己的沙箱/审批 flag 放进 `extra_args`
（`--sandbox workspace-write`、`--ask-for-approval on-request` 等）：bridge 会
检测到并**不再**叠加 bypass flag。

> ⚠️ 当 `bypass_sandbox: true`（默认）时，bot 产出的任何命令都能动整台机器和
> 网络，且任何能给 bot 发消息的人都能触发它。请据此收敛 bot 的 `default_cwd`。
