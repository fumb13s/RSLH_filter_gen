// oracle/analytics/__tests__/wearers.test.mjs
//
// wearers.mjs holds what speed.mjs and power.mjs both need: who is wearing each piece a build
// wants. The BEHAVIOUR is pinned by speed-cli.test.mjs, which imports these through speed.mjs and
// is deliberately left untouched by the move. What this file pins is the move itself — that the
// functions live here, and that speed.mjs's exports are the SAME functions rather than copies.
// An identity check is the only assertion that can tell a re-export from a duplicate definition
// left behind, which is the one way this refactor could pass every other test and still rot.
import { expect, test } from "vitest";
import { describeWearers, otherWearers } from "../wearers.mjs";
import { describeWearers as fromSpeed, otherWearers as otherFromSpeed } from "../speed.mjs";

test("wearers.mjs exports the two wearer helpers", () => {
  expect(typeof otherWearers).toBe("function");
  expect(typeof describeWearers).toBe("function");
});

test("speed.mjs re-exports the very same functions", () => {
  expect(otherFromSpeed).toBe(otherWearers);
  expect(fromSpeed).toBe(describeWearers);
});
