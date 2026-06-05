#!/usr/bin/env python3
"""
Build a small "known contents" SQLite gear DB for the Sellfile Creator oracle probe.

Strategy: copy a curated spread of REAL rows (armor + accessories) out of a real RslHelper.db
(guaranteed-valid encoding) into a fresh minimal DB with the same schema, and emit a fully-decoded
manifest so every item's contents are known.

Encoding (reverse-engineered + confirmed against the bundle's `/4294967296` decode):
    display_value = lvlid / 2**32        (then *100 for percent stats, i.e. fl == 0)

Slot: DB `type` == our ARTIFACT_SLOT_NAMES id (identity 1:1). Verified via the Champs equipped-slot
columns (ground truth) — NOT main-stat signatures (which mislead because the DB's stat-id enum
differs from ours) and NOT the websocket `kindId`. 1=Helmet 2=Chest 3=Gloves 4=Boots 5=Weapon
6=Shield 7=Ring 8=Amulet 9=Banner.

Stat id: DB enum != our enum. DB {1 HP, 2 ATK, 3 DEF, 4 SPD, 5 RES, 6 ACC, 7 C.RATE, 8 C.DMG}
-> our STAT_NAMES ids {1:1, 2:2, 3:3, 4:4, 5:7, 6:8, 7:5, 8:6}. The ACC/RES and C.RATE/C.DMG pairs
sit in swapped positions; resolved via equipped-champion stat lift (Champs.ACC/RES/CritRate/CritDamage).

Set ids (`aset`) match our ARTIFACT_SET_NAMES space directly. Accessory faction is in `accset` (1-17).
"""
import sqlite3, json, os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
# Source RslHelper.db lives in the git-ignored resources/ folder (see resources/README.md).
SRC = os.path.join(OUT_DIR, "resources", "RSLHelper.db")
DB_OUT = os.path.join(OUT_DIR, "known-gear.db")
MAN_OUT = os.path.join(OUT_DIR, "known-gear.manifest.json")

# Tables Sellfile Creator looks for (replicate schema verbatim; aux tables stay empty).
TABLES = ["Artifacts", "Champs", "InboxArtifacts", "LastUsedArtifacts"]

# DB `type` == our ARTIFACT_SLOT_NAMES id (identity). Verified via Champs equipped-slot columns.
DB_SLOT_NAME = {1: "Helmet", 2: "Chest", 3: "Gloves", 4: "Boots", 5: "Weapon",
                6: "Shield", 7: "Ring", 8: "Amulet", 9: "Banner"}
DBTYPE_TO_OURSLOT = {i: i for i in range(1, 10)}

# DB stat-id enum (differs from our STAT_NAMES; map to ours via DBSTAT_TO_OURSTAT).
STAT = {1: "HP", 2: "ATK", 3: "DEF", 4: "SPD", 5: "RES", 6: "ACC", 7: "C.RATE", 8: "C.DMG"}
DBSTAT_TO_OURSTAT = {1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 5, 8: 6}  # -> our STAT_NAMES ids
PERCENT_STATS = {7, 8}  # DB C.RATE / C.DMG always shown as %; HP/ATK/DEF (1-3) are % when fl==0

RARITY = {1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary", 6: "Mythical"}
# Accessory faction lives in the `accset` column (1-16; 17 = a newer faction not yet mapped).
FACTION_NAMES = {1: "Banner Lords", 2: "High Elves", 3: "Sacred Order", 4: "Barbarians",
                 5: "Ogryn Tribes", 6: "Lizardmen", 7: "Skinwalkers", 8: "Orcs", 9: "Demonspawn",
                 10: "Undead Hordes", 11: "Dark Elves", 12: "Knights Revenant", 13: "Dwarves",
                 14: "Shadowkin", 15: "Sylvan Watchers", 16: "Argonites", 17: "Faction17"}

ARTIFACT_SET_NAMES = {
    1: "Life", 2: "Offense", 3: "Defense", 4: "Speed", 5: "Critical Rate", 6: "Crit Damage",
    7: "Accuracy", 8: "Resistance", 9: "Lifesteal", 10: "Fury", 11: "Daze", 12: "Cursed",
    13: "Frost", 14: "Frenzy", 15: "Regeneration", 16: "Immunity", 17: "Shield", 18: "Relentless",
    19: "Savage", 20: "Destroy", 21: "Stun", 22: "Toxic", 23: "Provoke", 24: "Retaliation",
    25: "Avenging", 26: "Stalwart", 27: "Reflex", 28: "Curing", 29: "Cruel", 30: "Immortal",
    31: "Divine Offense", 32: "Divine Critical Rate", 33: "Divine Life", 34: "Divine Speed",
    35: "Swift Parry", 36: "Deflection", 37: "Resilience", 38: "Perception", 39: "Affinitybreaker",
    40: "Untouchable", 41: "Fatal", 42: "Frostbite", 43: "Bloodthirst", 44: "Guardian",
    45: "Fortitude", 46: "Lethal", 47: "Protection", 48: "Stone Skin", 49: "Killstroke",
    50: "Instinct", 51: "Bolster", 52: "Defiant", 53: "Impulse", 54: "Zeal", 57: "Righteous",
    58: "Supersonic", 59: "Merciless", 60: "Slayer", 61: "Feral", 62: "Pinpoint",
    63: "Stonecleaver", 64: "Rebirth", 65: "Chronophage", 66: "Mercurial",
    1000: "Refresh", 1001: "Cleansing", 1002: "Bloodshield", 1003: "Reaction", 1004: "Revenge",
}


def disp(fl, lvlid):
    if lvlid in (None, 0):
        return 0
    v = lvlid / 2 ** 32
    if fl == 0:
        v *= 100
    return round(v, 2)


def label(stat_dict):
    s = stat_dict
    pct = "%" if (s["statId"] in (1, 2, 3) and not s["isFlat"]) or s["statId"] in PERCENT_STATS else ""
    return f"{s['stat']}{pct}={s['value']}"


def main():
    src = sqlite3.connect(f"file:{SRC}?mode=ro&immutable=1", uri=True)
    src.row_factory = sqlite3.Row
    sc = src.cursor()

    creates = {t: sc.execute("SELECT sql FROM sqlite_master WHERE name=?", (t,)).fetchone()[0]
               for t in TABLES}
    cols = [d[0] for d in sc.execute("SELECT * FROM Artifacts LIMIT 1").description]

    # Guard against non-artifact / sentinel rows that exist in the real DB.
    VALID = "ID > 0 AND rank BETWEEN 1 AND 6 AND rarity BETWEEN 1 AND 6 AND mid BETWEEN 1 AND 8"

    # Curate a spread across all 6 armor slots and varied rarity/level/sub-count.
    buckets = [
        ("top", "rarity>=5 AND lvl=16"),
        ("mid", "rarity IN (3,4) AND lvl BETWEEN 8 AND 12"),
        ("low", "lvl<=4"),
    ]
    rows, seen = [], set()
    for t in (1, 2, 3, 4, 5, 6):  # armor DB types
        for _tag, cond in buckets:
            r = sc.execute(
                f"SELECT * FROM Artifacts WHERE type=? AND {VALID} AND {cond} ORDER BY ID LIMIT 1", (t,)
            ).fetchone()
            if r and r["ID"] not in seen:
                seen.add(r["ID"])
                rows.append(r)

    # Accessories (type 7/8/9): gear set in `aset` (incl. 1000-1004); faction in `accset` (1-17).
    # Cover both "has a gear set" and "faction-only (no set)" cases.
    acc_buckets = [
        ("set",   "aset>0 AND rarity>=5 AND lvl=16"),
        ("noset", "aset=0 AND rarity IN (4,5) AND lvl>=12"),
    ]
    for t in (7, 8, 9):  # Ring / Amulet / Banner
        for _tag, cond in acc_buckets:
            r = sc.execute(
                f"SELECT * FROM Artifacts WHERE type=? AND {VALID} AND accset BETWEEN 1 AND 17 AND {cond} "
                f"ORDER BY ID LIMIT 1", (t,)
            ).fetchone()
            if r and r["ID"] not in seen:
                seen.add(r["ID"])
                rows.append(r)

    # Fresh minimal DB.
    if os.path.exists(DB_OUT):
        os.remove(DB_OUT)
    dst = sqlite3.connect(DB_OUT)
    dc = dst.cursor()
    for t in TABLES:
        dc.execute(creates[t])
    ph = ",".join("?" * len(cols))
    for r in rows:
        vals = [0 if c == "cID" else r[c] for c in cols]  # unequip (no dangling champ refs)
        dc.execute(f"INSERT INTO Artifacts ({','.join(cols)}) VALUES ({ph})", vals)
    dst.commit()
    dst.close()

    # Decoded manifest.
    def stat_entry(sid, fl, lvlid, lvl=None):
        e = {"statId": sid, "ourStatId": DBSTAT_TO_OURSTAT.get(sid), "stat": STAT.get(sid, f"?{sid}"),
             "isFlat": bool(fl), "value": disp(fl, lvlid)}
        if lvl is not None:
            e["rolls"] = lvl
        return e

    items = []
    for r in rows:
        d = dict(r)
        subs = [stat_entry(d[f"s{i}id"], d[f"s{i}fl"], d[f"s{i}lvlid"], d[f"s{i}lvl"])
                for i in range(1, 5) if d[f"s{i}id"] not in (None, -1, 0)]
        setid = d["aset"] or 0
        facid = d["accset"] or 0
        items.append({
            "id": d["ID"],
            "dbType": d["type"], "slot": DB_SLOT_NAME[d["type"]], "ourSlotId": DBTYPE_TO_OURSLOT[d["type"]],
            "isAccessory": d["type"] in (7, 8, 9),
            "rank": d["rank"],
            "dbRarity": d["rarity"], "rarity": RARITY.get(d["rarity"], "?"), "ourRarityIndex": d["rarity"] - 1,
            "level": d["lvl"],
            "setId": setid, "set": ARTIFACT_SET_NAMES.get(setid, f"set{setid}") if setid else "(none)",
            "faction": ({"id": facid, "name": FACTION_NAMES.get(facid, f"faction{facid}")} if facid else None),
            "mainStat": stat_entry(d["mid"], d["mfl"], d["mlvlid"]),
            "substats": subs,
        })

    manifest = {
        "source": "curated real rows (armor + accessories) from RslHelper.db",
        "decode": "display = lvlid / 2**32, *100 when percent (fl==0)",
        "slotMapping": "DB type == our ARTIFACT_SLOT_NAMES id (identity); verified via Champs equip columns",
        "statMapping": "DB id {1HP 2ATK 3DEF 4SPD 5RES 6ACC 7CRATE 8CDMG}; ourStatId is the our-model id",
        "count": len(items),
        "items": items,
    }
    with open(MAN_OUT, "w") as f:
        json.dump(manifest, f, indent=2)

    # Validate round-trip: read the new DB back and re-decode == manifest values.
    chk = sqlite3.connect(f"file:{DB_OUT}?mode=ro", uri=True)
    chk.row_factory = sqlite3.Row
    n = chk.execute("SELECT COUNT(*) FROM Artifacts").fetchone()[0]
    assert n == len(rows), f"row count mismatch {n} != {len(rows)}"
    for m in items:
        rr = chk.execute("SELECT * FROM Artifacts WHERE ID=?", (m["id"],)).fetchone()
        assert disp(rr["mfl"], rr["mlvlid"]) == m["mainStat"]["value"], f"main mismatch {m['id']}"
    chk.close()

    print(f"OK  wrote {DB_OUT}  ({os.path.getsize(DB_OUT):,} bytes, {n} artifacts)")
    print(f"OK  wrote {MAN_OUT}")
    print(f"\n{'ID':>7}  {'slot':7} {'rank rar':14} lvl  set            main / substats")
    for m in items:
        subs = ", ".join(label(s) for s in m["substats"])
        fac = f"  [{m['faction']['name']}]" if m["faction"] else ""
        print(f"{m['id']:>7}  {m['slot']:7} {('r'+str(m['rank'])+' '+m['rarity']):14} +{m['level']:<2} {m['set']:12} {label(m['mainStat']):12} | {subs}{fac}")


if __name__ == "__main__":
    main()
