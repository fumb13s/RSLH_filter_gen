// Roles: "ATK-DPS" | "DEF-DPS" | "HP-DPS" | "Support". Shorthand: "D" -> 3 DPS, "All" -> 4.
const A = "ATK-DPS", DF = "DEF-DPS", H = "HP-DPS", S = "Support";
export const ALL_ROLES = [A, DF, H, S];
const D = [A, DF, H];

export function expandRoles(roles) {
  const out = new Set();
  for (const r of roles) {
    if (r === "All") ALL_ROLES.forEach((x) => out.add(x));
    else if (r === "D") D.forEach((x) => out.add(x));
    else out.add(r);
  }
  return [...out];
}

// id -> { name, roles (shorthand), scarcity, demand }
export const SETS = {
  1: { name: "Life", roles: [H, S], scarcity: 3, demand: 1 },
  2: { name: "Offense", roles: [A], scarcity: 3, demand: 1 },
  3: { name: "Defense", roles: [DF, S], scarcity: 3, demand: 1 },
  4: { name: "Speed", roles: ["All"], scarcity: 3, demand: 3 },
  5: { name: "Crit Rate", roles: ["D"], scarcity: 3, demand: 1 },
  6: { name: "Crit Damage", roles: ["D"], scarcity: 3, demand: 1 },
  7: { name: "Accuracy", roles: [S], scarcity: 3, demand: 1 },
  8: { name: "Resistance", roles: [S], scarcity: 3, demand: 1 },
  9: { name: "Lifesteal", roles: ["D"], scarcity: 3, demand: 1 },
  10: { name: "Fury", roles: [A], scarcity: 3, demand: 1 },
  11: { name: "Daze", roles: [S], scarcity: 3, demand: 1 },
  12: { name: "Cursed", roles: [S], scarcity: 3, demand: 1 },
  13: { name: "Frost", roles: [S], scarcity: 3, demand: 1 },
  14: { name: "Frenzy", roles: [S], scarcity: 3, demand: 1 },
  15: { name: "Regeneration", roles: [S], scarcity: 3, demand: 2 },
  16: { name: "Immunity", roles: [S], scarcity: 3, demand: 1 },
  17: { name: "Shield", roles: [S], scarcity: 3, demand: 2 },
  18: { name: "Relentless", roles: ["All"], scarcity: 5, demand: 3 },
  19: { name: "Savage", roles: ["D"], scarcity: 3, demand: 3 },
  20: { name: "Destroy", roles: ["D"], scarcity: 3, demand: 1 },
  21: { name: "Stun", roles: [S], scarcity: 3, demand: 2 },
  22: { name: "Toxic", roles: ["D", S], scarcity: 3, demand: 1 },
  23: { name: "Provoke", roles: [S], scarcity: 3, demand: 2 },
  24: { name: "Retaliation", roles: [S], scarcity: 3, demand: 1 },
  25: { name: "Avenging", roles: ["D"], scarcity: 3, demand: 1 },
  26: { name: "Stalwart", roles: [S], scarcity: 3, demand: 1 },
  27: { name: "Reflex", roles: [S], scarcity: 3, demand: 2 },
  28: { name: "Curing", roles: [S], scarcity: 3, demand: 1 },
  29: { name: "Cruel", roles: ["D"], scarcity: 5, demand: 3 },
  30: { name: "Immortal", roles: [S], scarcity: 5, demand: 1 },
  31: { name: "Divine Offense", roles: [A], scarcity: 3, demand: 1 },
  32: { name: "Divine Crit Rate", roles: ["D"], scarcity: 3, demand: 1 },
  33: { name: "Divine Life", roles: [H, S], scarcity: 3, demand: 1 },
  34: { name: "Divine Speed", roles: ["All"], scarcity: 5, demand: 3 },
  35: { name: "Swift Parry", roles: ["All"], scarcity: 5, demand: 3 },
  36: { name: "Deflection", roles: [S], scarcity: 5, demand: 3 },
  37: { name: "Resilience", roles: [S], scarcity: 3, demand: 1 },
  38: { name: "Perception", roles: [S], scarcity: 3, demand: 2 },
  40: { name: "Untouchable", roles: [S], scarcity: 3, demand: 1 },
  41: { name: "Fatal", roles: [A], scarcity: 3, demand: 1 },
  44: { name: "Guardian", roles: [S], scarcity: 3, demand: 1 },
  45: { name: "Fortitude", roles: [S], scarcity: 3, demand: 1 },
  46: { name: "Lethal", roles: ["D"], scarcity: 4, demand: 4 },
  47: { name: "Protection", roles: [S], scarcity: 4, demand: 4 },
  48: { name: "Stone Skin", roles: ["All"], scarcity: 4, demand: 4 },
  49: { name: "Killstroke", roles: ["D"], scarcity: 4, demand: 1 },
  50: { name: "Instinct", roles: ["D"], scarcity: 4, demand: 1 },
  51: { name: "Bolster", roles: [S], scarcity: 4, demand: 2 },
  52: { name: "Defiant", roles: [S], scarcity: 4, demand: 1 },
  53: { name: "Impulse", roles: ["All"], scarcity: 5, demand: 4 },
  54: { name: "Zeal", roles: ["D"], scarcity: 5, demand: 3 },
  57: { name: "Righteous", roles: [S], scarcity: 4, demand: 2 },
  58: { name: "Supersonic", roles: [S], scarcity: 4, demand: 3 },
  59: { name: "Merciless", roles: ["All"], scarcity: 4, demand: 3 },
  60: { name: "Slayer", roles: ["D"], scarcity: 4, demand: 1 },
  61: { name: "Feral", roles: ["All"], scarcity: 4, demand: 3 },
  62: { name: "Pinpoint", roles: ["All"], scarcity: 5, demand: 3 },
  63: { name: "Stonecleaver", roles: [A], scarcity: 3, demand: 1 },
  64: { name: "Rebirth", roles: [S], scarcity: 3, demand: 1 },
  65: { name: "Chronophage", roles: ["All"], scarcity: 4, demand: 3 },
  66: { name: "Mercurial", roles: ["All"], scarcity: 5, demand: 5 },
  1000: { name: "Refresh", roles: ["All"], scarcity: 5, demand: 2 },
  1001: { name: "Cleansing", roles: ["All"], scarcity: 3, demand: 1 },
  1002: { name: "Bloodshield", roles: ["All"], scarcity: 3, demand: 1 },
  1003: { name: "Reaction", roles: ["All"], scarcity: 5, demand: 3 },
  1004: { name: "Revenge", roles: ["D", S], scarcity: 4, demand: 3 },
  0: { name: "(setless)", roles: [], scarcity: 3, demand: 1 },
};

const FALLBACK = { name: "(unannotated)", roles: ["All"], scarcity: 3, demand: 3, unannotated: true };

export function getSet(id) {
  return SETS[id] ?? { ...FALLBACK, name: `(unannotated #${id})` };
}
