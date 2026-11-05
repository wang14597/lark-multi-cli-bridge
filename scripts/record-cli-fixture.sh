#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Usage: record-cli-fixture.sh <backend> <scenario> <prompt> [extra CLI args...]
# Runs in the current directory (cd to a scratch dir first); writes the
# fixture into the repo. stdin is closed: `codex exec` otherwise blocks on it.
set -euo pipefail
BACKEND="${1:-codex}"
SCENARIO="${2:-json-simple}"
PROMPT="${3:-say hi in 5 words}"
shift $(( $# < 3 ? $# : 3 ))
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/tests/adapters/__fixtures__/${BACKEND}"
mkdir -p "${OUT_DIR}"
case "${BACKEND}" in
  codex)
    if [ "${SCENARIO}" = "plain-simple" ]; then
      codex exec "$@" "${PROMPT}" < /dev/null > "${OUT_DIR}/${SCENARIO}.txt"
    else
      # Same flags the bridge's CodexAdapter passes.
      codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
        -c allow_login_shell=false "$@" "${PROMPT}" < /dev/null > "${OUT_DIR}/${SCENARIO}.jsonl"
    fi
    ;;
  gemini)
    gemini --prompt "${PROMPT}" "$@" < /dev/null > "${OUT_DIR}/${SCENARIO}.txt"
    ;;
  *)
    echo "unsupported backend: ${BACKEND}" >&2
    exit 1
    ;;
esac
echo "wrote fixture: ${OUT_DIR}/${SCENARIO}"
