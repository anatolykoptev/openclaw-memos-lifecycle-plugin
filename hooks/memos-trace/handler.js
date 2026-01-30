/**
 * MemOS Tool Trace Hook - saves tool results to memory
 */
import { addMemory } from "../../lib/memos-api.js";

// Tools to skip (memory tools to avoid recursion)
const SKIP_TOOLS = new Set([
  "memos_search", "memos_add", "memos_update", "memos_delete",
  "search_memories", "add_memory", "update_memory", "delete_memory",
  "get_user_info", "create_cube", "list_cubes",
  "add_preference", "get_preferences",
  "add_tool_trace", "search_tool_traces",
  "memory_search", "memory_save",
]);

const handler = async (event) => {
  // tool_result_persist event - we're subscribed directly
  const { toolName, params, result, success, duration } = event;

  // Skip memory tools
  if (!toolName || SKIP_TOOLS.has(toolName) || toolName.startsWith("memos_")) {
    return;
  }

  // Truncate helper
  const truncate = (obj, maxLen) => {
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
  };

  // Fire-and-forget save
  const traceContent = JSON.stringify({
    type: "tool_trace",
    tool: toolName,
    input: truncate(params, 300),
    output: truncate(result, 500),
    success,
    duration_ms: duration,
    ts: new Date().toISOString(),
  });

  addMemory(traceContent, ["tool_trace", toolName]);
};

export default handler;
