export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_MESSAGES = 50;

const isString = (v) => typeof v === "string";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function validateToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return "tool_calls must be an array";
  for (const call of toolCalls) {
    if (
      !isObject(call) ||
      !isString(call.id) ||
      call.type !== "function" ||
      !isObject(call.function) ||
      !isString(call.function.name) ||
      !isString(call.function.arguments)
    ) {
      return "tool_calls entry is malformed";
    }
  }
  return null;
}

function validateMessage(msg) {
  if (!isObject(msg)) return "must be an object";
  switch (msg.role) {
    case "user":
      return isString(msg.content) ? null : "user content must be a string";
    case "assistant":
      if (msg.content !== null && !isString(msg.content)) {
        return "assistant content must be a string or null";
      }
      return msg.tool_calls === undefined ? null : validateToolCalls(msg.tool_calls);
    case "tool":
      if (!isString(msg.tool_call_id)) return "tool message needs tool_call_id";
      return isString(msg.content) ? null : "tool content must be a string";
    default:
      return "role must be user, assistant or tool";
  }
}

/** Checks a /chat history against the message contract; returns an error string, or null when valid. */
export function validateHistory(history) {
  if (!Array.isArray(history)) return "history must be an array";
  if (history.length > MAX_HISTORY_MESSAGES) {
    return `history may hold at most ${MAX_HISTORY_MESSAGES} messages`;
  }
  for (let i = 0; i < history.length; i++) {
    const error = validateMessage(history[i]);
    if (error) return `history[${i}]: ${error}`;
  }
  return null;
}
