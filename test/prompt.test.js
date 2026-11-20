import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, formatSingaporeTime } from "../src/prompt.js";

test("formatSingaporeTime shows lunchtime in Singapore, not UTC", () => {
  assert.equal(
    formatSingaporeTime(new Date("2026-11-20T04:30:00Z")),
    "Fri 20 Nov 2026, 12:30",
  );
});

test("formatSingaporeTime rolls over to the next Singapore day", () => {
  assert.equal(
    formatSingaporeTime(new Date("2026-11-20T17:30:00Z")),
    "Sat 21 Nov 2026, 01:30",
  );
});

test("formatSingaporeTime shows midnight as 00", () => {
  assert.equal(
    formatSingaporeTime(new Date("2026-11-20T16:00:00Z")),
    "Sat 21 Nov 2026, 00:00",
  );
});

test("buildSystemPrompt is identical across calls", () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt());
});
