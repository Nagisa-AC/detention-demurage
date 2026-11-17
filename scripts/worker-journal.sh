#!/bin/bash
set -euo pipefail

LINES="${1:-${LINES:-200}}"
if [[ ! "$LINES" =~ ^[1-9][0-9]{0,4}$ ]]; then
  echo "Lines must be a positive integer." >&2
  exit 1
fi
journalctl -u dd-worker -n "$LINES" --no-pager
