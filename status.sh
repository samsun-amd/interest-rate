#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-interest-rate.service}"

if systemctl --user list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
    systemctl --user --no-pager --full status "$SERVICE_NAME"
    exit 0
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${APP_DIR}/.runtime/server.pid"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    pid="$(cat "$PID_FILE")"
    echo "Server running via start.sh (pid ${pid})."
    echo "Log: ${APP_DIR}/.runtime/server.log"
    exit 0
fi

echo "Server is not running."
