#!/usr/bin/env bash
# Emergency stop for the RSL Helper harness.
# Creates the stop sentinel (instant abort between clicks), sends quit,
# then force-kills if still running.
#
# Usage: ./scripts/harness-stop.sh

set -euo pipefail

TEST_DIR="${RSLH_TEST_DIR:-/mnt/e/downloads/browser/rslh-test}"
STOP_FILE="$TEST_DIR/harness-stop"
CMD_FILE="$TEST_DIR/harness-cmd.json"
READY_FILE="$TEST_DIR/harness-ready"

# 1. Create stop sentinel immediately — harness checks this between clicks
echo "abort" > "$STOP_FILE"
echo "Stop sentinel created."

if [[ ! -f "$READY_FILE" ]]; then
    echo "Harness not running (no ready file). Cleaning up."
    rm -f "$STOP_FILE"
    exit 0
fi

# 2. Also send quit command via file protocol
echo '{"action":"quit"}' > "$CMD_FILE"
echo -n "Waiting for shutdown..."

# 3. Wait up to 3 seconds for graceful shutdown
for i in $(seq 1 6); do
    sleep 0.5
    if [[ ! -f "$READY_FILE" ]]; then
        echo " stopped."
        rm -f "$STOP_FILE"
        exit 0
    fi
done
echo " timed out."

# 4. Force-kill: find the harness PowerShell process and terminate it
echo -n "Force-killing harness process..."
powershell.exe -NoProfile -Command '
    Get-Process powershell -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*rslh-harness*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
' 2>/dev/null || true

# Clean up
rm -f "$READY_FILE" "$STOP_FILE"
echo " done."
