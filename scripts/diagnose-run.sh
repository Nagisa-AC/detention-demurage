#!/bin/bash
set -euo pipefail

# shellcheck source=scripts/worker-ssm.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worker-ssm.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/diagnose-run.sh <run-id>" >&2
  exit 1
fi

run_id=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Run id must be a UUID." >&2
  exit 1
fi

require_aws
read_worker_target
run_on_worker "$WORKER_ROOT/scripts/worker-diagnose.sh" "diagnose one run" RUN_ID "$run_id"
