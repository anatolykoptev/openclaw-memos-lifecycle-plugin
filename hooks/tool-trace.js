/**
 * Hook: tool_result_persist — Tool Execution Traces
 *
 * Captures tool execution results and persists them to MemOS
 * for future reference. Skips memory-related tools to avoid recursion.
 *
 * @module hooks/tool-trace
 */
import { addMemory } from "../lib/memory.js";

const SKIP_PREFIXES = ["memos", "memory", "search_memories"];

/**
 * @param {object} event
 * @param {object} ctx
 */
export function handleToolTrace(event, ctx) {
  const toolName = event?.toolName || ctx?.toolName;
  if (!toolName || SKIP_PREFIXES.some((p) => toolName.startsWith(p))) return;

  const truncate = (obj, maxLen) => {
    if (!obj) return "";
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  };

  addMemory(
    JSON.stringify({
      type: "tool_trace",
      tool: toolName,
      result: truncate(event?.message, 300),
      ts: new Date().toISOString(),
    }),
    ["tool_trace", toolName],
  );
}
