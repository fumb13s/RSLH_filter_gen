#!/usr/bin/env bash
# Check if the vite dev server is running.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if ps -p "$PID" -o pid=,comm=,args= 2>/dev/null | grep -q .; then
    echo "Dev server running (PID $PID)"
    ps -p "$PID" -o pid=,comm=,args=
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
    echo "Warning: something is listening on port 5173 (not tracked by start-dev.sh)"
    ss -tlnp 2>/dev/null | grep ':5173'
    exit 2
  fi
  echo "Dev server not running"
  exit 1
fi
