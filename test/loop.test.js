import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStop } from "../src/loop.js";

test("shouldStop allows the first round", () => {
  assert.equal(shouldStop({ round: 0, startedAt: 1000, now: 1000 }), false);
});

test("shouldStop allows the last round under the cap", () => {
  assert.equal(shouldStop({ round: 7, startedAt: 0, now: 1000 }), false);
});

test("shouldStop stops once the round cap is reached", () => {
  assert.equal(shouldStop({ round: 8, startedAt: 0, now: 1000 }), true);
});

test("shouldStop stops once the turn time budget is spent", () => {
  assert.equal(shouldStop({ round: 1, startedAt: 0, now: 39_999 }), false);
  assert.equal(shouldStop({ round: 1, startedAt: 0, now: 40_000 }), true);
});
