#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${APP_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"

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

stop_pid() {
    local pid="$1"

    if ! is_running "$pid"; then
        return 0
    fi

    kill "$pid" 2>/dev/null || true

    for _ in {1..40}; do
        if ! is_running "$pid"; then
            return 0
        fi
        sleep 0.25
    done

    kill -9 "$pid" 2>/dev/null || true
}

pids=()
if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if is_running "$pid"; then
        pids+=("$pid")
    else
        rm -f "$PID_FILE"
    fi
fi

if [[ "${#pids[@]}" -eq 0 ]]; then
    while read -r pid; do
        [[ -n "$pid" ]] && pids+=("$pid")
    done < <(find_server_pids)
fi

if [[ "${#pids[@]}" -eq 0 ]]; then
    echo "Server is not running."
    exit 0
fi

for pid in "${pids[@]}"; do
    stop_pid "$pid"
    echo "Stopped server process ${pid}."
done

rm -f "$PID_FILE"
