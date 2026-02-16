#!/usr/bin/env bash
# Send a command to the elevated RSL Helper harness and get the result.
# Usage:
#   harness-cmd.sh '{"action":"ping"}'
#   harness-cmd.sh '{"action":"click","x":-1182,"y":527}'
#   harness-cmd.sh '{"action":"find","name":"Sell Setup"}'
#   harness-cmd.sh '{"action":"screenshot","x":-910,"y":660,"w":900,"h":200,"filename":"test.png"}'
#   harness-cmd.sh '{"action":"quit"}'
#
# Requires: harness server running (rslh-harness.ps1 in server mode)

set -euo pipefail

TEST_DIR="${RSLH_TEST_DIR:-/mnt/e/downloads/browser/rslh-test}"
CMD_FILE="$TEST_DIR/harness-cmd.json"
RESULT_FILE="$TEST_DIR/harness-result.json"
READY_FILE="$TEST_DIR/harness-ready"
TIMEOUT="${HARNESS_TIMEOUT:-30}"

if [[ $# -lt 1 ]]; then
    echo "Usage: harness-cmd.sh '<json command>'" >&2
    exit 1
fi

# Check server is running
if [[ ! -f "$READY_FILE" ]]; then
    echo "Error: Harness server not running (no ready file at $READY_FILE)" >&2
    echo "Start it with: harness-start.sh <PID>" >&2
    exit 1
fi

# Remove stale result
rm -f "$RESULT_FILE"

# Write command
echo "$1" > "$CMD_FILE"

# Wait for result
elapsed=0
while [[ ! -f "$RESULT_FILE" ]]; do
    sleep 0.3
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $((TIMEOUT * 3)) ]]; then
        echo "Error: Timeout waiting for harness result (${TIMEOUT}s)" >&2
        exit 1
    fi
done

# Small delay to ensure file is fully written
sleep 0.1
cat "$RESULT_FILE"
