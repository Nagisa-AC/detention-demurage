#!/bin/bash
set -euo pipefail

# Runs on the worker instance. stdout is the SSM command output, not the journal.
RUN_ID="${1:-${RUN_ID:-}}"
if [[ ! "$RUN_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Run id must be a UUID." >&2
  exit 1
fi
if [[ ! -x /usr/bin/node-24 || ! -f /opt/dd-worker/main.mjs ]]; then
  echo "The worker program is missing." >&2
  exit 1
fi
if [[ ! -f /etc/systemd/system/dd-worker.service ]]; then
  echo "The dd-worker unit is missing." >&2
  exit 1
fi

environment=$(systemctl show dd-worker.service -p Environment --value)
bucket=""
for item in $environment; do
  case "$item" in
    DD_BUCKET=*) bucket=${item#DD_BUCKET=} ;;
  esac
done
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "DD_BUCKET is not set on the worker unit." >&2
  exit 1
fi

# --pipe keeps the process output on this command. The transient unit matches dd-worker.
systemd-run \
  --quiet \
  --pipe \
  --wait \
  --collect \
  --property=DynamicUser=yes \
  --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=PrivateTmp=yes \
  --property=ReadOnlyPaths=/opt/dd-worker \
  --property=MemoryMax=768M \
  --property=WorkingDirectory=/opt/dd-worker \
  --setenv="DD_BUCKET=${bucket}" \
  /usr/bin/node-24 /opt/dd-worker/main.mjs --diagnose "$RUN_ID"
