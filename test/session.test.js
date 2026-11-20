import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSessionId } from "../src/loop.js";

test("pickSessionId keeps a well-formed client id", () => {
  const id = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";
  assert.equal(pickSessionId(id), id);
});

test("pickSessionId replaces missing or unsafe ids with a random UUID", () => {
  for (const bad of [undefined, null, 42, "", "short", "a".repeat(65), "abc\r\nx-evil: 1", "has spaces in it"]) {
    const id = pickSessionId(bad);
    assert.notEqual(id, bad);
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});
