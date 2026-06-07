#!/usr/bin/env bash
# MANUAL snapshot refresh — copies the live RSL Helper DB into oracle/resources/ as a
# date-stamped snapshot, then STOPS. It does not analyze or push; run those yourself:
#   ./oracle/analytics/refresh.sh        # -> oracle/resources/<snapshot-date>-RSLHelper.db
#   node oracle/analytics/analyze.mjs    # -> oracle/analytics/out/<snapshot-date>-report.{md,json}
#
# Why copy first: RSL Helper keeps the live file open, so a direct sqlite open of it fails
# (SQLITE_NOTADB over the WSL drvfs mount). A sequential cp yields a consistent file; we then
# run PRAGMA integrity_check before keeping it. Override the source with RSLHELPER_DB=/path.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

src="${RSLHELPER_DB:-$(ls /mnt/c/Users/*/AppData/Roaming/RslHelper/Config/*_RSLHelper.db 2>/dev/null | head -1)}"
[ -n "${src:-}" ] && [ -f "$src" ] || { echo "live RSLHelper.db not found; set RSLHELPER_DB=/path/to/your_RSLHelper.db" >&2; exit 1; }

date="$(date -r "$src" +%F)"                                  # snapshot date = live DB's last-write day
dest="$here/../resources/${date}-RSLHelper.db"

cp -f "$src" "$dest"
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);const r=d.prepare('PRAGMA integrity_check').get();d.close();process.exit(r.integrity_check==='ok'?0:1)" "$dest" 2>/dev/null \
  || { rm -f "$dest"; echo "copy caught a mid-write — close RSL Helper (or wait for it to finish a sync) and re-run." >&2; exit 1; }

echo "snapshot saved: oracle/resources/${date}-RSLHelper.db  (live mtime $(date -r "$src" '+%F %T'))"
echo "next:  node oracle/analytics/analyze.mjs   # regenerates out/${date}-report.{md,json}"
