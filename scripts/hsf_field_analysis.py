"""Analyse all field values across every rule in an .hsf file."""

import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/panda_ultraendgame_farming_v1.hsf"

with open(path, "rb") as f:
    raw = f.read()
if raw[:3] == b"\xef\xbb\xbf":
    raw = raw[3:]
d = json.loads(raw)
rules = d["Rules"]

# Rules without ArtifactSet
no_set = [i for i, r in enumerate(rules) if "ArtifactSet" not in r]
print(f"Rules without ArtifactSet: {len(no_set)} out of {len(rules)}")
print(f"  Indices: {no_set}")

# All unique keys across all rules
all_keys = set()
for r in rules:
    all_keys.update(r.keys())
print(f"All rule keys: {sorted(all_keys)}")

# All unique substat keys
all_sub_keys = set()
for r in rules:
    for s in r.get("Substats", []):
        all_sub_keys.update(s.keys())
print(f"All substat keys: {sorted(all_sub_keys)}")

# All unique ArtifactType values
all_types = set()
for r in rules:
    for t in r.get("ArtifactType", []):
        all_types.add(t)
print(f"All ArtifactType values: {sorted(all_types)}")

# Check if ArtifactType is always an array
non_array = [i for i, r in enumerate(rules) if not isinstance(r.get("ArtifactType"), list)]
print(f"Rules where ArtifactType is not array: {non_array}")

# All unique MainStatID values
all_mstat = set()
for r in rules:
    all_mstat.add(r["MainStatID"])
print(f"All MainStatID values: {sorted(all_mstat)}")

# All unique substat IDs
all_sub_ids = set()
for r in rules:
    for s in r.get("Substats", []):
        all_sub_ids.add(s["ID"])
print(f"All Substat IDs: {sorted(all_sub_ids)}")

# All unique Rarity values
all_rarity = set()
for r in rules:
    all_rarity.add(r["Rarity"])
print(f"All Rarity values: {sorted(all_rarity)}")

# All Rank values
all_rank = set()
for r in rules:
    all_rank.add(r["Rank"])
print(f"All Rank values: {sorted(all_rank)}")

# All Condition values
all_cond = set()
for r in rules:
    for s in r.get("Substats", []):
        all_cond.add(s["Condition"])
print(f"All Condition values: {sorted(all_cond)}")

# All Faction values
all_fac = set()
for r in rules:
    all_fac.add(r["Faction"])
print(f"All Faction values: {sorted(all_fac)}")

# All MainStatF values
all_msf = set()
for r in rules:
    all_msf.add(r["MainStatF"])
print(f"All MainStatF values: {sorted(all_msf)}")
