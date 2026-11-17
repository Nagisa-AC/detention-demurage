#!/bin/bash
set -euo pipefail

# shellcheck source=scripts/worker-ssm.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worker-ssm.sh"

if [[ $# -gt 1 ]]; then
  echo "Usage: scripts/worker-logs.sh [lines]" >&2
  exit 1
fi

lines=${1:-200}
if [[ ! "$lines" =~ ^[1-9][0-9]{0,4}$ ]]; then
  echo "Lines must be a positive integer." >&2
  exit 1
fi

require_aws
read_worker_target
run_on_worker "$WORKER_ROOT/scripts/worker-journal.sh" "dd-worker journal" LINES "$lines"
