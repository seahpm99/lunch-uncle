import { test } from "node:test";
import assert from "node:assert/strict";
import { toHistoryMessage } from "../src/loop.js";

test("toHistoryMessage keeps tool_calls and drops provider extras", () => {
  const msg = {
    role: "assistant",
    content: null,
    reasoning_content: "thinking about chicken rice",
    refusal: null,
    tool_calls: [
      {
        id: "call_1",
        index: 0,
        type: "function",
        function: { name: "search_places", arguments: '{"query":"chicken rice"}' },
      },
    ],
  };

  assert.deepEqual(toHistoryMessage(msg), {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "search_places", arguments: '{"query":"chicken rice"}' },
      },
    ],
  });
});

test("toHistoryMessage leaves out tool_calls on a plain reply", () => {
  const msg = { role: "assistant", content: "Go Berseh lah.", reasoning_content: "hmm", tool_calls: [] };

  assert.deepEqual(toHistoryMessage(msg), { role: "assistant", content: "Go Berseh lah." });
});

test("toHistoryMessage passes tool results through unchanged", () => {
  const msg = { role: "tool", tool_call_id: "call_1", content: "[]" };

  assert.deepEqual(toHistoryMessage(msg), msg);
});
