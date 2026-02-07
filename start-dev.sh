#!/usr/bin/env bash
# Start the vite dev server for the web UI.
# Shows output until the server is ready, then backgrounds it.
# Writes the PID to .dev.pid so stop-dev.sh can kill it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/.dev.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dev server already running (PID $(cat "$PID_FILE"))"
  exit 1
fi

cd "$ROOT_DIR"

# Start dev server, tee output to a temp file so we can watch for ready
LOGFILE="$(mktemp)"
setsid npm run dev > "$LOGFILE" 2>&1 &
DEV_PID=$!
echo $DEV_PID > "$PID_FILE"

# Wait for vite to print its "ready" line, then show the output
for _ in $(seq 1 50); do
  if grep -q "ready in" "$LOGFILE" 2>/dev/null; then
    cat "$LOGFILE"
    break
  fi
  sleep 0.1
done

rm -f "$LOGFILE"
echo ""
echo "Dev server backgrounded (PID $DEV_PID)"
