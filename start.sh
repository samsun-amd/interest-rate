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

server_env_value() {
    local pid="$1"
    local name="$2"

    tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n "s/^${name}=//p" | tail -n 1
}

server_host() {
    local pid="$1"
    local value

    value="$(server_env_value "$pid" "HOST")"
    printf '%s\n' "${value:-127.0.0.1}"
}

server_port() {
    local pid="$1"
    local value

    value="$(server_env_value "$pid" "PORT")"
    printf '%s\n' "${value:-5173}"
}

is_same_endpoint() {
    local pid="$1"

    [[ "$(server_host "$pid")" == "$HOST" && "$(server_port "$pid")" == "$PORT" ]]
}

print_urls() {
    local prefix="$1"
    echo "${prefix} ${URL} (pid ${pid})"
    if [[ "$HOST" == "0.0.0.0" || "$HOST" == "::" ]]; then
        echo "Local: http://127.0.0.1:${PORT}"
        for ip in $(hostname -I 2>/dev/null || true); do
            [[ "$ip" == "127."* || "$ip" == "::1" ]] && continue
            echo "LAN: http://${ip}:${PORT}"
        done
    fi
    echo "Log: ${LOG_FILE}"
}

endpoint_conflict() {
    local pid="$1"
    echo "Server already running with HOST=$(server_host "$pid") PORT=$(server_port "$pid") (pid ${pid})."
    echo "Run ./stop.sh before starting with HOST=${HOST} PORT=${PORT}."
    echo "Log: ${LOG_FILE}"
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
        if is_same_endpoint "$pid"; then
            print_urls "Server already running at"
        else
            endpoint_conflict "$pid"
            exit 1
        fi
        exit 0
    fi
    rm -f "$PID_FILE"
fi

existing_pid="$(find_server_pids | head -n 1)"
if [[ -n "$existing_pid" ]]; then
    echo "$existing_pid" >"$PID_FILE"
    pid="$existing_pid"
    if is_same_endpoint "$pid"; then
        print_urls "Server already running at"
        exit 0
    fi
    endpoint_conflict "$pid"
    exit 1
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

print_urls "Server started at"
