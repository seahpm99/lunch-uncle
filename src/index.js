import ui from "./ui.html";
import { runLoop, ConfigError } from "./loop.js";
import {
  MAX_BODY_BYTES,
  MAX_MESSAGE_CHARS,
  validateHistory,
} from "./validate.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/") {
      return new Response(ui, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && pathname === "/chat") {
      return handleChat(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request, env) {
  // Requiring JSON forces a CORS preflight, which blocks cross-site form or no-cors posts.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Content-Type must be application/json" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Body too large" }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json({ error: "Body too large" }, 413);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Body must be a JSON object" }, 400);
  }

  const { history = [], message, session_id } = body;
  if (typeof message !== "string" || message.trim() === "") {
    return json({ error: "message is required" }, 400);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `message may be at most ${MAX_MESSAGE_CHARS} characters` }, 400);
  }
  const historyError = validateHistory(history);
  if (historyError) {
    return json({ error: historyError }, 400);
  }

  try {
    const { reply, messages } = await runLoop(history, message, env, session_id);
    return json({ reply, messages });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`LLM config problem: ${err.message}`);
      return json({ error: `Uncle is not set up yet. ${err.message}` }, 503);
    }
    console.error("chat failed:", err);
    return json({ error: "Uncle cannot think right now, try again later." }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
