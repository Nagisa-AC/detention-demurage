#!/bin/bash
set -euo pipefail

if [[ ! -f /opt/dd-worker-previous/main.mjs ]]; then
  echo "There is no previous worker to restore." >&2
  exit 1
fi

systemctl stop dd-worker
rm -rf /opt/dd-worker.rollback-new
mv /opt/dd-worker /opt/dd-worker.rollback-new
mv /opt/dd-worker-previous /opt/dd-worker
mv /opt/dd-worker.rollback-new /opt/dd-worker-previous
chown -R root:root /opt/dd-worker
find /opt/dd-worker -type d -exec chmod 0755 {} +
find /opt/dd-worker -type f -exec chmod 0644 {} +
systemctl start dd-worker
systemctl is-active dd-worker
cat /opt/dd-worker/REVISION
