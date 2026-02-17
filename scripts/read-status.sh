#!/usr/bin/env bash
# Read the Sell Test status text via screenshot + OCR.
# Returns the full status line on stdout.
# Exit code 0 if status was read, 1 on error.
#
# Usage:
#   result=$(./scripts/read-status.sh)
#   if echo "$result" | grep -q "is sold"; then echo "SOLD"; fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="${RSLH_TEST_DIR:-/mnt/e/downloads/browser/rslh-test}"
STATUS_IMG="$TEST_DIR/status.png"

# Capture status area via harness
result=$("$SCRIPT_DIR/harness-cmd.sh" '{"action":"read_status"}')
ok=$(echo "$result" | sed 's/^\xEF\xBB\xBF//' | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

if [[ "$ok" != "True" ]]; then
    echo "Error: read_status failed: $result" >&2
    exit 1
fi

# OCR the status image (single line mode)
text=$(tesseract "$STATUS_IMG" - --psm 7 2>/dev/null)

if [[ -z "$text" ]]; then
    echo "Error: OCR returned empty text" >&2
    exit 1
fi

echo "$text"
