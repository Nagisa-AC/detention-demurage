#!/bin/bash
set -euo pipefail

# shellcheck source=scripts/worker-ssm.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worker-ssm.sh"

if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/rollback-worker.sh" >&2
  exit 1
fi

require_aws
read_worker_target
run_on_worker "$WORKER_ROOT/scripts/worker-rollback.sh" "roll back dd-worker"
