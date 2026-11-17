#!/bin/bash
set -euo pipefail
dnf install -y nodejs24
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
WorkingDirectory=/opt/dd-worker
Environment=DD_BUCKET=${bucket}
ExecStart=/usr/bin/node-24 /opt/dd-worker/main.mjs
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
