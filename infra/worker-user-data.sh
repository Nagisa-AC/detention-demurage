#!/bin/bash
set -euo pipefail
install -d -o root -g root -m 0755 /opt/dd-worker
cat > /etc/systemd/system/dd-worker.service <<UNIT
[Unit]
Description=D and D Recovery worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadOnlyPaths=/opt/dd-worker
MemoryMax=768M
WorkingDirectory=/opt/dd-worker
Environment=DD_BUCKET=${bucket}
ExecStart=/usr/bin/node-24 /opt/dd-worker/main.mjs
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

installed=0
for attempt in 1 2 3; do
  if dnf install -y nodejs24; then
    installed=1
    break
  fi
  if [[ "$attempt" -lt 3 ]]; then
    sleep 10
  fi
done
if [[ "$installed" -ne 1 ]]; then
  echo "nodejs24 did not install." >&2
  exit 1
fi
