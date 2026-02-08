/**
 * Hook: tool_result_persist — Tool Execution Traces
 *
 * Captures tool execution results and persists them to MemOS
 * for future reference. Skips memory-related tools to avoid recursion.
 *
 * @module hooks/tool-trace
 */
import { addMemory } from "../lib/memory.js";
import { LOG_PREFIX } from "../lib/client.js";
import { inc } from "../lib/stats.js";

const SKIP_PREFIXES = ["memos", "memory"];

/**
 * @param {object} event
 * @param {object} ctx
 */
export async function handleToolTrace(event, ctx) {
  const toolName = event?.toolName || ctx?.toolName;
  if (!toolName || SKIP_PREFIXES.some((p) => toolName.startsWith(p))) return;

  const truncate = (obj, maxLen) => {
    if (!obj) return "";
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  };

  const startTime = event?.startTime || ctx?.startTime || Date.now();
  const durationMs = Date.now() - startTime;
  const success = !event?.error && event?.message;

  // Save tool trace
  inc("toolTrace.count");
  addMemory(
    JSON.stringify({
      type: "tool_trace",
      tool: toolName,
      result: truncate(event?.message, 300),
      success,
      durationMs,
      ts: new Date().toISOString(),
    }),
    ["tool_trace", toolName],
  );
}
