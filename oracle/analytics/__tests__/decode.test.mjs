// oracle/analytics/__tests__/decode.test.mjs
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeValue, readArtifacts } from "../decode.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

test("decodeValue: percent stat x100 (ATK% 2576980377 -> 60)", () => {
  expect(decodeValue(2, false, 2576980377)).toBe(60);
});
test("decodeValue: flat/non-pct stat is integer (SPD 25769803776 -> 6)", () => {
  expect(decodeValue(4, true, 25769803776)).toBe(6);
});
test("decodeValue: zero stays zero", () => {
  expect(decodeValue(1, true, 0)).toBe(0);
});

test("decode matches known-gear manifest (24 items)", () => {
  const manifest = JSON.parse(readFileSync(here("../../known-gear.manifest.json"), "utf8"));
  const { items } = readArtifacts(here("../../known-gear.db"));
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const exp of manifest.items) {
    const got = byId.get(exp.id);
    expect(got, `item ${exp.id} decoded`).toBeTruthy();
    expect(got.slot, `#${exp.id} slot`).toBe(exp.ourSlotId);
    expect(got.set, `#${exp.id} set`).toBe(exp.setId);
    expect(got.rank, `#${exp.id} rank`).toBe(exp.rank);
    expect(got.rarity, `#${exp.id} rarity`).toBe(exp.ourRarityIndex);
    expect(got.level, `#${exp.id} level`).toBe(exp.level);
    expect(got.faction, `#${exp.id} faction`).toBe(exp.faction?.id ?? 0); // manifest faction = {id,name}|null
    expect(got.mainStat.statId, `#${exp.id} main id`).toBe(exp.mainStat.ourStatId);
    expect(got.mainStat.isFlat, `#${exp.id} main flat`).toBe(exp.mainStat.isFlat);
    expect(got.mainStat.value, `#${exp.id} main value`).toBe(exp.mainStat.value);
    expect(got.substats.length, `#${exp.id} sub count`).toBe(exp.substats.length);
    exp.substats.forEach((es, i) => {
      expect(got.substats[i].statId, `#${exp.id} sub${i} id`).toBe(es.ourStatId);
      expect(got.substats[i].isFlat, `#${exp.id} sub${i} flat`).toBe(es.isFlat);
      expect(got.substats[i].value, `#${exp.id} sub${i} value`).toBe(es.value);
      expect(got.substats[i].rolls, `#${exp.id} sub${i} rolls`).toBe(es.rolls);
    });
  }
});

test("Mythical bonus roll (sNmlvlid) is included in the substat value", () => {
  const { items } = readArtifacts(here("../../known-gear.db"));
  const myth = items.find((it) => it.id === 352891); // Mythical Shield
  const res = myth.substats.find((s) => s.statId === 7); // RES: base 12 + Mythical bonus 10
  expect(res.value).toBe(22);
});
