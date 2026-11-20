import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStop, pickChoice, finishOutcome, parseArgs } from "../src/loop.js";

const call = (extra = {}) => ({
  id: "call_1",
  type: "function",
  function: { name: "get_rain_forecast", arguments: "{}" },
  ...extra,
});

test("pickChoice returns the first choice", () => {
  const choice = { message: { role: "assistant", content: "hi" }, finish_reason: "stop" };
  assert.equal(pickChoice({ choices: [choice] }), choice);
});

test("pickChoice throws a readable error for a provider error body", () => {
  assert.throws(
    () => pickChoice({ error: { message: "rate limited" } }),
    /LLM returned no choices: rate limited/,
  );
});

test("pickChoice throws for empty choices and truncates long details", () => {
  assert.throws(() => pickChoice({ choices: [] }), /LLM returned no choices/);
  assert.throws(
    () => pickChoice({ error: { message: "x".repeat(1000) } }),
    (err) => err.message.length < 400,
  );
});

test("finishOutcome returns plain text replies", () => {
  const outcome = finishOutcome({
    message: { role: "assistant", content: "Eat chicken rice." },
    finish_reason: "stop",
  });
  assert.equal(outcome.reply, "Eat chicken rice.");
  assert.deepEqual(outcome.message, { role: "assistant", content: "Eat chicken rice." });
});

test("finishOutcome never returns an empty reply", () => {
  for (const content of [null, "", "   "]) {
    const outcome = finishOutcome({ message: { content }, finish_reason: "stop" });
    assert.ok(outcome.reply.trim().length > 0);
  }
});

test("finishOutcome replaces filtered content with a fallback", () => {
  const outcome = finishOutcome({
    message: { content: "partial" },
    finish_reason: "content_filter",
  });
  assert.ok(outcome.reply.length > 0);
  assert.notEqual(outcome.reply, "partial");
});

test("finishOutcome marks text cut off by the length limit", () => {
  const outcome = finishOutcome({
    message: { content: "Go to Berseh and" },
    finish_reason: "length",
  });
  assert.ok(outcome.reply.startsWith("Go to Berseh and"));
  assert.ok(outcome.reply.length > "Go to Berseh and".length);
});

test("finishOutcome does not run tool calls cut off by the length limit", () => {
  const outcome = finishOutcome({
    message: { content: null, tool_calls: [call({ function: { name: "x", arguments: '{"q' } })] },
    finish_reason: "length",
  });
  assert.ok(outcome.reply.length > 0);
  assert.equal(outcome.message.tool_calls, undefined);
});

test("finishOutcome passes tool calls through with their ids", () => {
  const outcome = finishOutcome({
    message: { role: "assistant", content: null, tool_calls: [call()] },
    finish_reason: "tool_calls",
  });
  assert.equal(outcome.reply, undefined);
  assert.equal(outcome.message.tool_calls[0].id, "call_1");
});

test("finishOutcome gives tool calls without an id a unique id", () => {
  const outcome = finishOutcome({
    message: { role: "assistant", tool_calls: [call({ id: undefined }), call({ id: "" })] },
    finish_reason: "tool_calls",
  });
  const [a, b] = outcome.message.tool_calls.map((c) => c.id);
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("finishOutcome stores object arguments as a JSON string", () => {
  const outcome = finishOutcome({
    message: { tool_calls: [call({ function: { name: "x", arguments: { query: "laksa" } } })] },
    finish_reason: "tool_calls",
  });
  assert.equal(outcome.message.tool_calls[0].function.arguments, '{"query":"laksa"}');
});

test("finishOutcome tolerates a tool call without a function", () => {
  const outcome = finishOutcome({
    message: { tool_calls: [{ id: "call_1" }] },
    finish_reason: "tool_calls",
  });
  assert.deepEqual(outcome.message.tool_calls, [{ id: "call_1" }]);
});

test("parseArgs accepts JSON objects, plain objects and empty input", () => {
  assert.deepEqual(parseArgs('{"stopCode":"60011"}'), { ok: true, value: { stopCode: "60011" } });
  assert.deepEqual(parseArgs({ query: "laksa" }), { ok: true, value: { query: "laksa" } });
  assert.deepEqual(parseArgs(""), { ok: true, value: {} });
  assert.deepEqual(parseArgs(undefined), { ok: true, value: {} });
});

test("parseArgs rejects invalid JSON and non-object values", () => {
  for (const raw of ['{"query": "lak', "42", "null", "[1]", '"text"']) {
    assert.deepEqual(parseArgs(raw), { ok: false }, raw);
  }
});

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
