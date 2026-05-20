#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${APP_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
URL="http://${HOST}:${PORT}"

mkdir -p "$RUNTIME_DIR"

is_running() {
    local pid="${1:-}"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

find_server_pids() {
    local pid
    local cwd
    local cmdline

    while read -r pid; do
        [[ -n "$pid" ]] || continue
        [[ "$pid" == "$$" ]] && continue

        cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
        cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"

        if [[ "$cwd" == "$APP_DIR" || "$cmdline" == *"${APP_DIR}/server.js"* ]]; then
            printf '%s\n' "$pid"
        fi
    done < <(pgrep -f "node .*server.js" 2>/dev/null || true)
}

if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_running "$pid"; then
        echo "Server already running at ${URL} (pid ${pid})"
        echo "Log: ${LOG_FILE}"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

existing_pid="$(find_server_pids | head -n 1)"
if [[ -n "$existing_pid" ]]; then
    echo "$existing_pid" >"$PID_FILE"
    echo "Server already running at ${URL} (pid ${existing_pid})"
    echo "Log: ${LOG_FILE}"
    exit 0
fi

if command -v setsid >/dev/null 2>&1; then
    setsid env HOST="$HOST" PORT="$PORT" node "${APP_DIR}/server.js" >"$LOG_FILE" 2>&1 </dev/null &
else
    nohup env HOST="$HOST" PORT="$PORT" node "${APP_DIR}/server.js" >"$LOG_FILE" 2>&1 </dev/null &
fi
pid="$!"
echo "$pid" >"$PID_FILE"

sleep 1
if ! is_running "$pid"; then
    rm -f "$PID_FILE"
    echo "Server failed to start."
    echo "Log: ${LOG_FILE}"
    tail -40 "$LOG_FILE" 2>/dev/null || true
    exit 1
fi

echo "Server started at ${URL} (pid ${pid})"
echo "Log: ${LOG_FILE}"
