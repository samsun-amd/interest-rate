#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-interest-rate.service}"
USER_SYSTEMD_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${USER_SYSTEMD_DIR}/${SERVICE_NAME}"
NODE_BIN="$(command -v node)"

mkdir -p "$USER_SYSTEMD_DIR"
sed \
    -e "s#__APP_DIR__#${APP_DIR}#g" \
    -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    "${APP_DIR}/interest-rate.service" >"$SERVICE_PATH"

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo "Installed and started ${SERVICE_NAME}."
systemctl --user --no-pager --full status "$SERVICE_NAME" || true
