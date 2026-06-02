#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Test fixture: simulates codex 0.130.0's "stale rollout" failure on the
# first invocation when called with a SESSION_ID positional arg, then
# succeeds on subsequent invocations.
#
# Invocation count is tracked in $CODEX_FAKE_COUNT_FILE (set by the test).
# Behaviour:
#   - count == 0 AND argv contains 'resume' -> write the canonical
#     "thread/resume failed: no rollout found" to stderr and exit 1
#   - otherwise -> emit a minimal valid codex-0.130.0 JSON event stream
#     for a fresh session and exit 0
count_file="${CODEX_FAKE_COUNT_FILE:?CODEX_FAKE_COUNT_FILE must be set}"
count=$(cat "$count_file" 2>/dev/null || echo 0)
echo $((count + 1)) > "$count_file"

resume=0
for a in "$@"; do
  if [ "$a" = "resume" ]; then resume=1; fi
done

if [ "$count" = "0" ] && [ "$resume" = "1" ]; then
  echo "Error: thread/resume: thread/resume failed: no rollout found for thread id stale-thread-deadbeef (code -32600)" >&2
  exit 1
fi

cat <<'EOF'
{"type":"thread.started","thread_id":"fresh-thread-789"}
{"type":"item.completed","item":{"id":"m0","type":"agent_message","text":"ok"}}
{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}
EOF
exit 0
