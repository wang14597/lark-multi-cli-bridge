#!/usr/bin/env bash
set -euo pipefail
BACKEND="${1:-codex}"
SCENARIO="${2:-json-simple}"
PROMPT="${3:-say hi in 5 words}"
OUT_DIR="tests/adapters/__fixtures__/${BACKEND}"
mkdir -p "${OUT_DIR}"
case "${BACKEND}" in
  codex)
    if [ "${SCENARIO}" = "plain-simple" ]; then
      codex exec "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.txt"
    else
      codex exec --json "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.jsonl"
    fi
    ;;
  gemini)
    gemini --prompt "${PROMPT}" > "${OUT_DIR}/${SCENARIO}.txt"
    ;;
  *)
    echo "unsupported backend: ${BACKEND}" >&2
    exit 1
    ;;
esac
echo "wrote fixture: ${OUT_DIR}/${SCENARIO}"
