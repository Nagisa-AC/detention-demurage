#!/bin/bash
set -euo pipefail

RUN_ID="${1:-${RUN_ID:-}}"
if [[ ! "$RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Run id must be a UUID." >&2
  exit 1
fi
if [[ ! -x /usr/bin/node-24 || ! -f /opt/dd-worker/main.mjs ]]; then
  echo "The worker program is missing." >&2
  exit 1
fi

/usr/bin/node-24 /opt/dd-worker/main.mjs --requeue "$RUN_ID"
