import { buildSystemPrompt } from "./prompt.js";
import { toolDefinitions, executeTool } from "./tools.js";

// Base URL of an OpenAI-compatible API, without /chat/completions (callModel appends it).
const LLM_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
const LLM_MODEL = "deepseek-v4.1-flash";

const LLM_TIMEOUT_MS = 20_000;
const MAX_ROUNDS = 8;

const FALLBACK_REPLY = "Just go Berseh Food Centre lah.";
const FOOD_WORDS = /\b(eat|lunch|food|makan|hungry|restaurant|hawker)\b/i;

/**
 * Run the agentic loop for one user turn and return Uncle's reply.
 *
 * history is the prior conversation as OpenAI-style {role, content} messages.
 */
export async function runLoop(history, message, env) {
  // If the Places key is missing, Uncle cannot search, so give a safe answer.
  if (!env.GOOGLE_PLACES_API_KEY || FOOD_WORDS.test(message)) {
    return FALLBACK_REPLY;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: message },
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

  let round = 0;
  while (round < MAX_ROUNDS) {
    const assistant = await callModel(messages, env, sessionId);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return assistant.content ?? "";
    }

    for (const call of toolCalls) {
      const args = parseArgs(call.function.arguments);
      console.log(`round ${round}: ${call.function.name}`, args);
      const result = await executeTool(call.function.name, args, env);
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

  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices[0].message;
}

function parseArgs(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
