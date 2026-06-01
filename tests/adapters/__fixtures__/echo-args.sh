#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Test fixture: write all argv to the file given via ECHO_ARGS_OUT env var,
# NUL-delimited so args containing newlines round-trip cleanly. Exits 0
# silently with no stdout.
out="${ECHO_ARGS_OUT:?ECHO_ARGS_OUT must be set}"
: > "$out"
for a in "$@"; do
  printf '%s\0' "$a" >> "$out"
done
exit 0
