import { test } from "node:test";
import assert from "node:assert/strict";
import { findLlmConfigProblems } from "../src/loop.js";

const valid = {
  baseUrl: "https://opencode.ai/inference/go/openai/v1",
  model: "deepseek-v4.1-flash",
  apiKey: "sk-test",
};

test("findLlmConfigProblems accepts a complete config", () => {
  assert.deepEqual(findLlmConfigProblems(valid), []);
});

test("findLlmConfigProblems flags TODO and empty placeholders", () => {
  const problems = findLlmConfigProblems({ baseUrl: "TODO", model: "", apiKey: "k" });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /LLM_BASE_URL/);
  assert.match(problems[1], /LLM_MODEL/);
  assert.match(findLlmConfigProblems({ ...valid, model: "TODO" })[0], /LLM_MODEL/);
});

test("findLlmConfigProblems rejects non-http base URLs", () => {
  for (const baseUrl of ["opencode.ai/v1", "ftp://example.com/v1"]) {
    const [problem] = findLlmConfigProblems({ ...valid, baseUrl });
    assert.match(problem, /LLM_BASE_URL .*valid http/);
  }
});

test("findLlmConfigProblems rejects a base URL that already has /chat/completions", () => {
  for (const suffix of ["/chat/completions", "/chat/completions/"]) {
    const [problem] = findLlmConfigProblems({ ...valid, baseUrl: valid.baseUrl + suffix });
    assert.match(problem, /LLM_BASE_URL .*\/chat\/completions/);
  }
});

test("findLlmConfigProblems flags a missing API key without echoing values", () => {
  const problems = findLlmConfigProblems({ ...valid, apiKey: undefined });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /OPENCODE_API_KEY/);
  assert.ok(!problems[0].includes(valid.baseUrl));
});
