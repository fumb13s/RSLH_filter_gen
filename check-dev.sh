#!/usr/bin/env bash
# Check if the vite dev server is running.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if ps -p "$PID" -o pid=,comm=,args= 2>/dev/null | grep -q .; then
    # Extract the port vite is listening on (ss -tlnp may need root for pid info)
    PORT=$(ss -tlnp 2>/dev/null | grep "pid=$PID" | grep -oP ':\K[0-9]+(?=\s)' | head -1 || true)
    PORT="${PORT:-5173}"
    echo "Dev server running (PID $PID) — http://localhost:$PORT/RSLH_filter_gen/"
    exit 0
  else
    echo "PID file exists ($PID) but process is not running — stale PID file"
    rm -f "$PID_FILE"
    exit 1
  fi
else
  echo "No PID file found"
  # Check if something is listening on the default vite port anyway
  if ss -tlnp 2>/dev/null | grep -q ':5173'; then
    echo "Warning: something is listening on port 5173 (not tracked by start-dev.sh) — http://localhost:5173/RSLH_filter_gen/"
    exit 2
  fi
  echo "Dev server not running"
  exit 1
fi
