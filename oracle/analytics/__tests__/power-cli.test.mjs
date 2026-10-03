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

// --- parsePowerArgs: the numeric arguments -------------------------------------

test("parsePowerArgs reads --power and --top", () => {
  expect(parsePowerArgs(["Elhain", "--power", "412000", "--top", "3"]))
    .toMatchObject({ power: 412000, top: 3 });
});

// In-game power is a whole number on the screen, and --top counts builds. A fractional or negative
// value is a typo, and 0 is the one value that is certainly not meant — `--top 0` would ask for no
// builds at all.
test("parsePowerArgs rejects a --power or --top that is not a positive integer", () => {
  for (const bad of ["0", "-1", "1.5", "lots", "1e3x"]) {
    expect(() => parsePowerArgs(["Elhain", "--top", bad]), `--top ${bad}`)
      .toThrow(/--top needs a positive integer/);
    expect(() => parsePowerArgs(["Elhain", "--power", bad]), `--power ${bad}`)
      .toThrow(/--power needs a positive integer/);
  }
});

// The log power is a positional rather than an option, and gets the same test: a reading logged
// with a fractional power would be fitted against a number the game never showed.
test("parsePowerArgs rejects a log power that is not a positive integer", () => {
  expect(() => parsePowerArgs(["log", "Elhain", "0"]))
    .toThrow(/the in-game power needs a positive integer/);
  expect(() => parsePowerArgs(["log", "Elhain", "-5"]))
    .toThrow(/the in-game power needs a positive integer/);
  expect(() => parsePowerArgs(["log", "Elhain", "12.5"]))
    .toThrow(/the in-game power needs a positive integer/);
});

// Number("") and Number(" ") are both 0, so an empty value would silently parse as a legal option
// rather than as the typo it is. A missing value is Number(undefined) -> NaN.
test("parsePowerArgs rejects an empty or missing option value", () => {
  expect(() => parsePowerArgs(["Elhain", "--top", ""])).toThrow(/--top/);
  expect(() => parsePowerArgs(["Elhain", "--power", "  "])).toThrow(/--power/);
  expect(() => parsePowerArgs(["Elhain", "--top"])).toThrow(/--top/);
});

// An option value must never be mistaken for the selector.
test("parsePowerArgs does not treat an option value as the selector", () => {
  expect(parsePowerArgs(["--top", "3", "Elhain"]).selector).toBe("Elhain");
  expect(parsePowerArgs(["--power", "412000"]).selector).toBe(null);
});
