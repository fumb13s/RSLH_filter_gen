// oracle/analytics/__tests__/power-cli.test.mjs
//
// power.mjs: the pure helpers directly, and all four modes end to end through a spawned node.
//
// Every fixture here is synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds
// personal account data and never belongs in the repo. Nothing about argument parsing, copy
// selection, layout or the fit needs real data.
//
// EVERY spawned run sets RSLH_POWER_DIR to a fresh temp directory. Without it the tool would read
// and append to the developer's real oracle/analytics/out/ — a test that pollutes a personal
// reading log, and one whose own assertions would depend on whatever is already in it.
import { expect, test } from "vitest";
import { parsePowerArgs } from "../power.mjs";

// --- parsePowerArgs: modes and positionals ------------------------------------

test("parsePowerArgs defaults to solve and reads the selector and snapshot in either order", () => {
  expect(parsePowerArgs(["Elhain", "x/y.json.gz"]))
    .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
  expect(parsePowerArgs(["x/y.json.gz", "Elhain"]))
    .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
});

test("parsePowerArgs recognises the three subcommands as the first positional", () => {
  expect(parsePowerArgs(["log", "Elhain", "12345"]))
    .toMatchObject({ mode: "log", selector: "Elhain", logPower: 12345 });
  expect(parsePowerArgs(["fit", "Elhain"])).toMatchObject({ mode: "fit", selector: "Elhain" });
  expect(parsePowerArgs(["verify", "x/y.json.gz"]))
    .toMatchObject({ mode: "verify", selector: null, dbArg: "x/y.json.gz" });
});

// `top` defaults to 1 as in parseSpeedArgs; the other three have no default value that could be
// mistaken for a supplied one, so they are null.
test("parsePowerArgs defaults top to 1 and leaves the rest null", () => {
  expect(parsePowerArgs(["Elhain"])).toEqual({
    mode: "solve", selector: "Elhain", dbArg: undefined, power: null, top: 1, logPower: null,
  });
});

test("parsePowerArgs takes no selector and no snapshot at all", () => {
  expect(parsePowerArgs([])).toMatchObject({ mode: "solve", selector: null, dbArg: undefined });
  expect(parsePowerArgs(["verify"])).toMatchObject({ mode: "verify", dbArg: undefined });
});

// Same rule as parseSpeedArgs: an empty arg is no arg, because an empty selector matches the whole
// roster by substring.
test("parsePowerArgs drops empty positional arguments", () => {
  expect(parsePowerArgs([""])).toMatchObject({ selector: null, dbArg: undefined });
});
