/**
 * Generate a multi-rule test .hsf file for RSL Helper integration testing.
 * Usage: npx tsx scripts/gen-test-filter.ts <output-path>
 */
import { writeFileSync } from "node:fs";
import {
  generateFilter,
  serializeFilter,
  defaultRule,
  emptySubstat,
} from "@rslh/core";

const output = process.argv[2] || "/mnt/e/downloads/browser/rslh-test/multi-rule-test.hsf";

const rules = [
  // Rule 1: Keep 6-star Legendary+ weapons with Speed substat >= 10
  defaultRule({
    Keep: true,
    ArtifactType: [1],        // Weapon
    Rank: 6,
    Rarity: 16,               // Legendary
    MainStatID: -1,            // Any main stat
    Substats: [
      { ID: 11, Value: 10, IsFlat: true, NotAvailable: false, Condition: ">=" },
      emptySubstat(),
      emptySubstat(),
      emptySubstat(),
    ],
  }),

  // Rule 2: Sell 5-star Rare helmets
  defaultRule({
    Keep: false,
    ArtifactType: [2],        // Helmet
    Rank: 5,
    Rarity: 4,                // Rare
    MainStatID: -1,
    Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
  }),

  // Rule 3: Keep any 6-star with specific set (e.g. Speed set = 14)
  defaultRule({
    Keep: true,
    ArtifactSet: [14],         // Speed set
    ArtifactType: [1, 2, 3, 4, 5, 6],
    Rank: 6,
    Rarity: 16,
    MainStatID: -1,
    Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
  }),

  // Rule 4: Keep boots with Speed main stat
  defaultRule({
    Keep: true,
    ArtifactType: [6],        // Boots
    Rank: 6,
    Rarity: 16,
    MainStatID: 11,           // Speed
    MainStatF: 1,
    Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
  }),

  // Rule 5: Inactive rule (Use: false)
  defaultRule({
    Keep: true,
    Use: false,
    ArtifactType: [3],        // Shield
    Rank: 6,
    Rarity: 16,
    MainStatID: -1,
    Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
  }),
];

const filter = generateFilter(rules);
const json = serializeFilter(filter);
writeFileSync(output, json);
console.log(`Written ${rules.length} rules to ${output} (${json.length} bytes)`);
