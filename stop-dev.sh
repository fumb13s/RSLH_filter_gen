#!/usr/bin/env bash
# Stop the vite dev server started by dev-start.sh.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found — dev server not running?"
  exit 1
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  # Kill the entire process group (npm + sh + node vite)
  kill -- -"$PID" 2>/dev/null || kill "$PID"
  echo "Dev server stopped (PID $PID)"
else
  echo "Process $PID not running"
fi
rm -f "$PID_FILE"
