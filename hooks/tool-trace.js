/**
 * Hook: tool_result_persist — Tool Execution Traces + Skill Extraction
 *
 * Captures tool execution results and persists them to MemOS
 * for future reference. Skips memory-related tools to avoid recursion.
 *
 * v2.2: Also extracts skills from complex successful tool executions.
 *
 * @module hooks/tool-trace
 */
import { addMemory } from "../lib/memory.js";
import { extractSkillFromTool } from "../lib/typed-extraction.js";
import { LOG_PREFIX } from "../lib/client.js";
import { inc } from "../lib/stats.js";

const SKIP_PREFIXES = ["memos", "memory"];

// Track tool executions for skill extraction
const recentExecutions = new Map();
const SKILL_EXTRACTION_COOLDOWN_MS = 10 * 60 * 1000; // 10 min per tool

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

  // Skill extraction for complex successful operations
  if (success && durationMs > 500) {
    const lastExtraction = recentExecutions.get(toolName) || 0;
    const now = Date.now();

    if (now - lastExtraction > SKILL_EXTRACTION_COOLDOWN_MS) {
      try {
        const skill = await extractSkillFromTool({
          name: toolName,
          params: event?.params || ctx?.params || {},
          result: truncate(event?.message, 500),
          success,
          durationMs,
        });

        if (skill) {
          console.log(LOG_PREFIX, `Extracted skill from ${toolName}`);
          addMemory(skill.content, skill.tags);
          inc("toolTrace.skillsExtracted");
          recentExecutions.set(toolName, now);
          // Cleanup old entries
          if (recentExecutions.size > 100) {
            const cutoff = now - SKILL_EXTRACTION_COOLDOWN_MS;
            for (const [key, ts] of recentExecutions) {
              if (ts < cutoff) recentExecutions.delete(key);
            }
          }
        }
      } catch (err) {
        // Silent fail — skill extraction is optional
      }
    }
  }
}
