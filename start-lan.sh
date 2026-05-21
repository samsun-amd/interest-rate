#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${HOST:-0.0.0.0}" PORT="${PORT:-5173}" "${APP_DIR}/start.sh"
