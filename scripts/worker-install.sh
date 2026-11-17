#!/bin/bash
set -euo pipefail

SHA="${1:-${SHA:-}}"
BUCKET="${2:-${BUCKET:-}}"
REGION="${3:-${AWS_REGION:-}}"

if [[ ! "$SHA" =~ ^[0-9a-f]{64}$ ]]; then
  echo "SHA must be 64 hex characters." >&2
  exit 1
fi
if [[ ! "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "BUCKET is required." >&2
  exit 1
fi
if [[ ! "$REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]$ ]]; then
  echo "AWS_REGION is required." >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "The AWS CLI is not installed on the instance." >&2
  exit 1
fi
if [[ ! -f /etc/systemd/system/dd-worker.service ]]; then
  echo "The dd-worker unit is missing; check /var/log/cloud-init-output.log" >&2
  exit 1
fi

dnf install -y nodejs24
test -x /usr/bin/node-24

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
aws s3 cp "s3://${BUCKET}/deploy/${SHA}.tar" "$TMP/worker.tar" --region "$REGION" --only-show-errors
echo "${SHA}  ${TMP}/worker.tar" | sha256sum -c -

tar -tf "$TMP/worker.tar" | LC_ALL=C sort >"$TMP/listing"
listing=$(cat "$TMP/listing")
expected=$(printf '%s\n' main.mjs pdf.worker.mjs)
if [[ "$listing" != "$expected" ]]; then
  echo "The archive must contain main.mjs and pdf.worker.mjs." >&2
  exit 1
fi

if [[ -f /opt/dd-worker/main.mjs ]]; then
  rm -rf /opt/dd-worker-previous
  install -d -o root -g root -m 0755 /opt/dd-worker-previous
  cp -a /opt/dd-worker/. /opt/dd-worker-previous/
fi

install -d -o root -g root -m 0755 /opt/dd-worker
tar -C /opt/dd-worker -xf "$TMP/worker.tar"
printf '%s\n' "$SHA" > /opt/dd-worker/REVISION
chown -R root:root /opt/dd-worker
find /opt/dd-worker -type d -exec chmod 0755 {} +
find /opt/dd-worker -type f -exec chmod 0644 {} +

systemctl enable dd-worker
systemctl restart dd-worker
restarts_before=$(systemctl show -p NRestarts --value dd-worker)
sleep 15
restarts_after=$(systemctl show -p NRestarts --value dd-worker)
if ! systemctl is-active --quiet dd-worker || [[ "$restarts_after" -gt "$restarts_before" ]]; then
  echo "dd-worker did not stay up." >&2
  journalctl -u dd-worker -n 30 --no-pager >&2
  exit 1
fi
systemctl is-active dd-worker
/usr/bin/node-24 -v
cat /opt/dd-worker/REVISION
