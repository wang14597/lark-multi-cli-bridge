#!/usr/bin/env bash
set -euo pipefail

# install-skills.sh — install lark-cli agent skills for the bridge.
#
# Layered install:
#   1. Upstream larksuite/cli skills — teach the agent how lark-cli works
#      (subcommands, response shapes, identity flags). Default selection
#      keeps the agent context lean; override with $UPSTREAM_SKILLS.
#   2. lark-bridge-overlay (this repo) — teach the agent the bridge-only
#      conventions (bridge_context blocks, __claude_cb, foreground OAuth).
#
# Usage:
#   scripts/install-skills.sh                              # defaults
#   UPSTREAM_SKILLS=lark-im,lark-base scripts/install-skills.sh
#   UPSTREAM_SKILLS='*' scripts/install-skills.sh          # all 26 upstream
#
# Extra args are passed through to `npx skills add`, e.g. -g for global,
# -a claude-code/codex/gemini-cli to pick an agent, -y to skip prompts.
#
#   scripts/install-skills.sh -g -y                        # global, no prompts
#   scripts/install-skills.sh -g -a '*' -y                 # all agents, global
#
# Note: `npx skills add` accepts only ONE --skill name per invocation
# (comma-separated lists fall through to interactive selection), so this
# script loops over $UPSTREAM_SKILLS and invokes once per name.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERLAY="$REPO_ROOT/skills/lark-bridge-overlay"
UPSTREAM_SKILLS="${UPSTREAM_SKILLS:-lark-im,lark-shared}"

if [[ "$UPSTREAM_SKILLS" == "*" ]]; then
  echo "==> Installing ALL upstream larksuite/cli skills"
  npx -y skills add larksuite/cli --all "$@"
else
  IFS=',' read -ra SKILL_LIST <<< "$UPSTREAM_SKILLS"
  for skill in "${SKILL_LIST[@]}"; do
    skill="${skill// /}"
    [[ -z "$skill" ]] && continue
    echo "==> Installing upstream skill: $skill"
    npx -y skills add larksuite/cli --skill "$skill" "$@"
    echo
  done
fi

echo "==> Installing lark-bridge-overlay from $OVERLAY"
npx -y skills add "$OVERLAY" "$@"

echo
echo "Done. Verify with: npx skills list"
