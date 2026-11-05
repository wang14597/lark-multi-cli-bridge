#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Test fixture: print the file named by FIXTURE_FILE (a recorded CLI stream),
# ignoring argv. If ECHO_ARGS_OUT is set, also record argv like echo-args.sh.
if [ -n "${ECHO_ARGS_OUT:-}" ]; then
  : > "$ECHO_ARGS_OUT"
  for a in "$@"; do printf '%s\0' "$a" >> "$ECHO_ARGS_OUT"; done
fi
cat "${FIXTURE_FILE:?FIXTURE_FILE must be set}"
