"""Inspect the top-level structure of an .hsf file and pretty-print sample rules."""

import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/panda_ultraendgame_farming_v1.hsf"

with open(path, "rb") as f:
    raw = f.read()

if raw[:3] == b"\xef\xbb\xbf":
    print("Has BOM: yes")
    raw = raw[3:]
else:
    print("Has BOM: no")

d = json.loads(raw)
print("Top-level keys:", list(d.keys()))
print("Number of rules:", len(d.get("Rules", [])))

print("\nFirst rule:")
print(json.dumps(d["Rules"][0], indent=2))

print("\nSecond rule:")
print(json.dumps(d["Rules"][1], indent=2))
