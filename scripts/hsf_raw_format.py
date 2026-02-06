"""Inspect raw byte-level format of an .hsf file and check ArtifactSet types."""

import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/panda_ultraendgame_farming_v1.hsf"

with open(path, "rb") as f:
    full = f.read()

print(f"File size: {len(full)} bytes")
print(f"First 200 bytes (repr): {repr(full[:200])}")
print(f"Last 50 bytes (repr): {repr(full[-50:])}")

raw = full[3:] if full[:3] == b"\xef\xbb\xbf" else full
d = json.loads(raw)
rules = d["Rules"]

# Check ArtifactSet type when present
for i, r in enumerate(rules):
    if "ArtifactSet" in r:
        if not isinstance(r["ArtifactSet"], list):
            print(f"Rule {i}: ArtifactSet is {type(r['ArtifactSet']).__name__}: {r['ArtifactSet']}")
            break
else:
    print("ArtifactSet is always an array when present")

# Print a sample rule without ArtifactSet
for i, r in enumerate(rules):
    if "ArtifactSet" not in r:
        print(f"\nFirst rule without ArtifactSet (index {i}):")
        print(json.dumps(r, indent=2))
        break

# Print a sample rule with substat conditions
for i, r in enumerate(rules):
    for s in r.get("Substats", []):
        if s["Condition"] != "":
            print(f"\nFirst rule with substat conditions (index {i}):")
            print(json.dumps(r, indent=2))
            break
    else:
        continue
    break
