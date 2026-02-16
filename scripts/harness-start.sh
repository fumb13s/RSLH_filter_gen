#!/usr/bin/env bash
# Start the RSL Helper test harness (elevated, one UAC prompt).
# Usage: harness-start.sh [PID]
#   PID defaults to auto-detected RSLHelper process.
#
# The harness runs in a separate elevated PowerShell window.
# Send commands using harness-cmd.sh.

set -euo pipefail

TEST_DIR="${RSLH_TEST_DIR:-/mnt/e/downloads/browser/rslh-test}"
READY_FILE="$TEST_DIR/harness-ready"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Auto-detect PID if not provided
if [[ $# -ge 1 ]]; then
    PID="$1"
else
    PID=$(powershell.exe -NoProfile -Command '(Get-Process RSLHelper -ErrorAction SilentlyContinue).Id' | tr -d '\r\n')
    if [[ -z "$PID" ]]; then
        echo "Error: RSLHelper process not found. Provide PID manually." >&2
        exit 1
    fi
    echo "Auto-detected RSLHelper PID: $PID"
fi

# Convert WSL path to Windows path for the script
WIN_SCRIPT=$(wslpath -w "$SCRIPT_DIR/rslh-harness.ps1")

# Clean up stale ready file
rm -f "$READY_FILE"

echo "Launching elevated harness (approve UAC once)..."
powershell.exe -NoProfile -Command "Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-ExecutionPolicy Bypass -WindowStyle Hidden -File \"$WIN_SCRIPT\" -targetPid $PID'"

# Wait for ready signal
echo -n "Waiting for harness to start"
elapsed=0
while [[ ! -f "$READY_FILE" ]]; do
    echo -n "."
    sleep 0.5
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge 30 ]]; then
        echo ""
        echo "Error: Timeout waiting for harness to start (15s)" >&2
        exit 1
    fi
done
echo " ready!"
echo ""
echo "Harness is running. Send commands with:"
echo "  ./scripts/harness-cmd.sh '{\"action\":\"ping\"}'"
echo "  ./scripts/harness-cmd.sh '{\"action\":\"find\",\"name\":\"Sell Setup\"}'"
echo "  ./scripts/harness-cmd.sh '{\"action\":\"quit\"}'"
