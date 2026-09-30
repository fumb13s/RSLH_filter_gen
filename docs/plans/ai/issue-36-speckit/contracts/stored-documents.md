# Contract: Stored Documents

What each format looks like on disk, in the URL and in browser storage. The field rules are in [../data-model.md](../data-model.md).

## `.fqbl`: Quick Generator file

Written pretty-printed with 2-space indentation, as `JSON.stringify(wrap(QUICK_STATE_FILE_FORMAT, stripBlockColors(state)), null, 2)`:

```json
{
  "version": 4,
  "state": {
    "blocks": [
      {
        "name": "Main",
        "tiers": [
          { "name": "Must-Keep", "rolls": 5 },
          { "name": "Good", "rolls": 7 },
          { "name": "Situational", "rolls": 8 },
          { "name": "Off-Set", "rolls": -1, "sellRolls": 9 }
        ],
        "assignments": { "1": 3, "4": 1 },
        "selectedProfiles": [0, 1],
        "selectedCustom": [0]
      }
    ],
    "rareAccessories": { "selections": { "47": [1, 2] } },
    "oreReroll": { "assignments": { "1": 0 } },
    "customProfiles": [{ "label": "Speed", "stats": [[4, true], [1, false]] }],
    "strict": true
  }
}
```

Historical shapes the loader must still read:

```jsonc
// v1: one flat block, tiers with colours
{ "version": 1, "state": { "tiers": [{ "name": "Must-Keep", "rolls": 5, "color": "#22c55e" }, …], "assignments": { "1": 3 }, "selectedProfiles": [0] } }
// v2: blocks, tiers with colours
{ "version": 2, "state": { "blocks": [{ "tiers": [{ "name": "Must-Keep", "rolls": 5, "color": "#22c55e" }, …], "assignments": {}, "selectedProfiles": [] }] } }
// v3: no colours; rareAccessories / oreReroll may appear
{ "version": 3, "state": { "blocks": [ … ], "rareAccessories": { "selections": {} }, "oreReroll": { "assignments": {} } } }
```

Acceptance rules:
- A file without an envelope is invalid.
- Unknown keys are dropped at every level.
- No size limits apply.
- A file that isn't JSON is refused as `not a valid .fqbl file (not JSON)`.

## Share link: `#q=<payload>`

The payload is the base64url encoding of the deflate-raw compression of `JSON.stringify(wrap(QUICK_STATE_LINK_FORMAT, stripBlockColors(state)))`:

```json
{"version":4,"state":{"blocks":[…],"rareAccessories":{…},"oreReroll":{…},"customProfiles":[…],"strict":true}}
```

Rules:
- **Pre-versioning links.** A payload without a `version` key is bare state (e.g. `{"blocks":[…]}`) and is loaded as version 4.
- **Envelope.** A payload with a `version` key must be exactly `{ version, state }`; any other key makes the link invalid.
- **Transport gates**, unchanged, run before parsing:
  - encoded length ≤ 4096;
  - base64url alphabet only;
  - binary ≤ 8192 bytes;
  - decompressed ≤ 16384 bytes.
- **Content.** Exactly the links today's `share.ts` validator accepts are accepted:
  - unknown keys are rejected at every level;
  - `"__proto__"` keys are rejected at the top level and inside `assignments`, `oreReroll.assignments` and `rareAccessories.selections`;
  - the size limits apply;
  - `<>&"'` are stripped from strings after their length check.
- **Failures.**
  - Invalid JSON, base64 that `atob` refuses (e.g. `"A"`) and every other failure → `Error("Invalid shared state")`.
  - A newer version → `NewerVersionError`.

## `.fmbl`: Generator file

Written pretty-printed with 2-space indentation:

```json
{
  "version": 1,
  "groups": [
    {
      "name": "Speed boots",
      "keep": true,
      "sets": [1, 2],
      "slots": [4],
      "mainStats": [[4, true]],
      "goodStats": [[4, true], [5, false]],
      "rolls": 6,
      "rank": 6,
      "rarity": 16,
      "faction": 0,
      "walkbackDelay": 1
    }
  ]
}
```

Acceptance rules:
- A file without an envelope is invalid.
- Unknown keys are dropped, including the legacy `isAnd`.
- A missing `mainStats` becomes `[]`.
- There are no numeric ranges.

## Settings: `localStorage["rslh-settings"]`

Written by `saveSettings`:

```json
{"version":1,"settings":{"defaultTabType":"quick","maxTabs":9,"maxTabLabelWidthPercent":100,"generatorDefaultRolls":6,"quickTierRolls":[5,7,8,9],"rank5RollAdjustment":2,"oreRerollColumns":[3,4,5]}}
```

The pre-versioning flat form, still read as version 1:

```json
{"generatorDefaultRolls":8}
```

Rules:
- A missing or invalid field falls back to its own default.
- A `version` that is not a positive integer counts as corrupt: defaults are used, and the next save replaces it.
- A newer `version` gives defaults, and the stored value is never written over.
