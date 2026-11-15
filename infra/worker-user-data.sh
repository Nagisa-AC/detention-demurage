#!/bin/bash
set -euo pipefail
dnf install -y nodejs
install -d -m 0755 /opt/dd-worker
NODE=$(command -v node)
cat > /etc/systemd/system/dd-worker.service <<UNIT
[Unit]
Description=D and D Recovery worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/dd-worker
Environment=DD_BUCKET=${bucket}
ExecStart=$${NODE} /opt/dd-worker/main.mjs
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
