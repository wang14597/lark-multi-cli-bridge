# Configuration

中文版: [configuration.zh.md](configuration.zh.md)

Reference for the `bot.yaml` knobs you'll actually want to tune. Most bots run fine on defaults — this is here for when you need to override something.

Agent-skill installation is **not** in this doc — it's part of the `lmcb init` interactive flow. See [the quickstart](quickstart.md) → Step 5 for what skills do, what happens if you skip them, and how to install them later.

## Skill prompt injection

Every bot, regardless of backend, gets a bundled bot-skill prompt injected by default. It teaches the LLM about the bridge's `<bridge_context>` / `<quoted_message>` / `<interactive_card>` blocks, how to send interactive cards via the local `lark-cli` (including button callbacks via the `__claude_cb` marker), and how to drive `lark-cli auth login` device flow safely.

Two per-backend YAML fields control injection:

```yaml
backend:
  type: codex
  codex:
    extra_args: []
  injectSkillPrompt: true        # default; set to false to disable
  appendSystemPrompt: |          # optional, concatenated AFTER the skill prompt
    Additional instructions specific to this bot.
```

Injection mechanism per backend:
- `claude`: `--append-system-prompt <text>` flag.
- `codex`, `gemini`: prepended to the prompt with `\n\n---\n\n` separator.

## LLM card-button callbacks (`__claude_cb`)

When the LLM emits an interactive card with a button whose `value` contains `__claude_cb: true`, clicking the button re-enters the same LLM session with a synthetic `[card-click] {...}` message (the marker is stripped before forwarding). This lets the LLM build multi-step flows where the user picks from buttons.

Example button (CardKit 2.0):

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

Buttons **without** `__claude_cb` (for example the bridge's own `/status` buttons) continue to dispatch through the internal command router as before — they are not seen by the LLM.

## codex: `skip_git_repo_check`

`codex exec` refuses to run outside a Git repository (or a directory explicitly trusted in `~/.codex/config.toml`) unless invoked with `--skip-git-repo-check`. Because bridge bots commonly point at `$HOME` or other non-repo cwds, the bridge passes this flag by default for every codex bot. You can opt out per bot:

```yaml
backend:
  type: codex
  codex:
    skip_git_repo_check: false   # default true; set false to enforce codex's trust check
```
