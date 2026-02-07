#!/usr/bin/env bash
# Start the vite dev server for the web UI.
# Writes the PID to .dev.pid so dev-stop.sh can kill it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dev server already running (PID $(cat "$PID_FILE"))"
  exit 1
fi

cd "$ROOT_DIR"
npm run dev &
echo $! > "$PID_FILE"
echo "Dev server started (PID $!)"
