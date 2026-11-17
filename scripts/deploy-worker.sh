#!/bin/bash
set -euo pipefail

# shellcheck source=scripts/worker-ssm.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worker-ssm.sh"

if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/deploy-worker.sh" >&2
  exit 1
fi

cd "$WORKER_ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree is dirty. Commit or stash before deploying." >&2
  exit 1
fi

require_aws
read_worker_target

tar_path="$WORKER_ROOT/dist/dd-worker.tar"
sha_path="$WORKER_ROOT/dist/dd-worker.sha256"
if [[ ! -f "$tar_path" || ! -f "$sha_path" ]]; then
  echo "Run pnpm worker:bundle first." >&2
  exit 1
fi

sha=$(tr -d '[:space:]' <"$sha_path")
if [[ ! "$sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo "dist/dd-worker.sha256 is not 64 hex characters." >&2
  exit 1
fi
actual=$(shasum -a 256 "$tar_path" | awk '{print $1}')
if [[ "$actual" != "$sha" ]]; then
  echo "dist/dd-worker.tar does not match dist/dd-worker.sha256." >&2
  exit 1
fi

aws s3 cp "$tar_path" "s3://${WORKER_BUCKET}/deploy/${sha}.tar" --region "$WORKER_REGION" --only-show-errors
run_on_worker "$WORKER_ROOT/scripts/worker-install.sh" "install dd-worker" SHA "$sha" BUCKET "$WORKER_BUCKET"
