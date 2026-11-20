import { buildSystemPrompt, formatSingaporeTime } from "./prompt.js";
import { toolDefinitions, executeTool } from "./tools.js";

// Base URL of an OpenAI-compatible API, without /chat/completions (callModel appends it).
const LLM_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
const LLM_MODEL = "deepseek-v4.1-flash";

const LLM_TIMEOUT_MS = 20_000;
const MAX_ROUNDS = 8;
const TURN_BUDGET_MS = 40_000;
// Each tool call is one fetch; with MAX_ROUNDS model calls this stays under the 50-subrequest limit.
const MAX_TOOL_CALLS = 30;

const EMPTY_REPLY = "Uncle blur already, nothing to say. Ask again?";
const FILTERED_REPLY = "Aiyo, Uncle cannot answer that one. Ask about lunch instead.";
const CUT_OFF_NOTE = "\n\n(Uncle talk too much, got cut off.)";
const TRUNCATED_CALL_REPLY = "Uncle lost track halfway. Ask again, maybe shorter.";
const INVALID_ARGS_RESULT = JSON.stringify({
  error: "invalid arguments JSON; call again with valid JSON",
});
const MAX_ERROR_BODY = 300;

/**
 * Run the agentic loop for one user turn and return Uncle's reply.
 *
 * history is the prior conversation as OpenAI-style {role, content} messages.
 */
export async function runLoop(history, message, env) {
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    // The time goes after the history so the cached prefix stays stable.
    {
      role: "user",
      content: `[Singapore time: ${formatSingaporeTime(new Date())}]\n${message}`,
    },
  ];

  const problems = findLlmConfigProblems({
    baseUrl: LLM_BASE_URL,
    model: LLM_MODEL,
    apiKey: env.OPENCODE_API_KEY,
  });
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  // One session id per turn, shared by every model call in this loop run,
  // so the OpenCode Go endpoint can route and cache consistently.
  const sessionId = crypto.randomUUID();

  const startedAt = Date.now();
  let round = 0;
  let toolCallsUsed = 0;
  while (!shouldStop({ round, startedAt, now: Date.now() })) {
    round += 1;
    const choice = await callModel(messages, env, sessionId);
    const outcome = finishOutcome(choice);
    messages.push(outcome.message);
    if (outcome.reply !== undefined) {
      return outcome.reply;
    }

    for (const call of outcome.message.tool_calls) {
      const name = call.function?.name;
      const args = parseArgs(call.function?.arguments);
      console.log(`round ${round}: ${name}`, args);
      let result;
      if (!args.ok) {
        result = INVALID_ARGS_RESULT;
      } else if (toolCallsUsed >= MAX_TOOL_CALLS) {
        result = JSON.stringify({ error: "Tool call limit reached. Answer with what you have." });
      } else {
        toolCallsUsed += 1;
        result = await executeTool(name, args.value, env);
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return "Uncle tried too many times already. Ask something simpler.";
}

/** Thrown when the LLM settings cannot work, so the caller can tell the developer what to fix. */
export class ConfigError extends Error {
  constructor(problems) {
    super(problems.join(" "));
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * List what is wrong with the LLM settings; empty when they look usable.
 * Problems name the variable, never its value, so they are safe to show and log.
 */
export function findLlmConfigProblems({ baseUrl, model, apiKey }) {
  const problems = [];
  const url = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (isUnset(url)) {
    problems.push("LLM_BASE_URL in src/loop.js is not set.");
  } else if (!isHttpUrl(url)) {
    problems.push("LLM_BASE_URL in src/loop.js is not a valid http(s) URL.");
  } else if (/\/chat\/completions\/?$/.test(url)) {
    problems.push(
      "LLM_BASE_URL in src/loop.js must not end in /chat/completions; callModel adds that.",
    );
  }
  if (isUnset(typeof model === "string" ? model.trim() : "")) {
    problems.push("LLM_MODEL in src/loop.js is not set.");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    problems.push("OPENCODE_API_KEY is missing from .env or the Worker secrets.");
  }
  return problems;
}

function isUnset(value) {
  return value === "" || value.toUpperCase() === "TODO";
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Decide whether the loop must stop before making another model call.
 */
export function shouldStop({ round, startedAt, now }) {
  return round >= MAX_ROUNDS || now - startedAt >= TURN_BUDGET_MS;
}

async function callModel(messages, env, sessionId) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENCODE_API_KEY}`,
      "x-opencode-session": sessionId,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      tools: toolDefinitions,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}: ${truncate(body)}`);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`LLM returned non-JSON body: ${truncate(body)}`);
  }
  return pickChoice(data);
}

/** Return the first choice of a completion, or throw a readable error when there is none. */
export function pickChoice(data) {
  const choice = data?.choices?.[0];
  if (choice && typeof choice.message === "object" && choice.message !== null) {
    return choice;
  }
  const detail = data?.error?.message ?? JSON.stringify(data);
  throw new Error(`LLM returned no choices: ${truncate(String(detail))}`);
}

/**
 * Decide what one model choice means for the loop.
 *
 * Returns {message, reply} when the turn ends, else {message} whose tool_calls all have an id.
 * message is what to append to the history either way.
 */
export function finishOutcome(choice) {
  const message = choice.message ?? {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const text = typeof message.content === "string" ? message.content : "";
  const end = (reply) => ({ message: { role: "assistant", content: reply }, reply });

  if (choice.finish_reason === "content_filter") {
    return end(FILTERED_REPLY);
  }
  if (choice.finish_reason === "length") {
    // A cut-off tool call has incomplete arguments JSON, so it must not run.
    if (calls.length > 0) return end(TRUNCATED_CALL_REPLY);
    return end(text.trim() ? text + CUT_OFF_NOTE : EMPTY_REPLY);
  }
  if (calls.length === 0) {
    return end(text.trim() ? text : EMPTY_REPLY);
  }

  // The provider rejects a tool message whose tool_call_id matches no assistant call,
  // and expects arguments in the history as a JSON string.
  const toolCalls = calls.map((call) => {
    const fn = call.function;
    const args = fn?.arguments;
    return {
      ...call,
      id: call.id || `call_${crypto.randomUUID().replaceAll("-", "")}`,
      ...(args !== null && typeof args === "object"
        ? { function: { ...fn, arguments: JSON.stringify(args) } }
        : {}),
    };
  });
  return { message: { ...message, tool_calls: toolCalls } };
}

/** Parse tool-call arguments: {ok: true, value} when they are an object, else {ok: false}. */
export function parseArgs(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: {} };
  }
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false };
  }
  return { ok: true, value };
}

function truncate(text) {
  return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}...` : text;
}
