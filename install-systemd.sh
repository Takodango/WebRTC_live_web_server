#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/takodango/videoliveserver/larix-webrtc"
SERVICE_NAME="larix-webrtc.service"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command was not found. Install Docker first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin was not found. Install Docker Compose plugin first."
  exit 1
fi

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env. Edit ADMIN_TOKEN and PUBLISH_TOKEN before public use."
fi

sudo install -D -m 0644 "$APP_DIR/systemd/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
sudo systemctl daemon-reload
sudo systemctl enable docker.service
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "$SERVICE_NAME is enabled and running."
echo "Viewer: https://your-domain.example/"
echo "Admin:  https://your-domain.example/admin.html"
echo "Publisher: https://your-domain.example/publish.html"
