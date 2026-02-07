/**
 * Typed Memory Extraction
 *
 * Extracts memories using type-specific prompts for better quality.
 * Inspired by memU's profile/behavior/skill/event separation.
 *
 * @module lib/typed-extraction
 */
import { callApi, getMemosUserId, getMemosCubeId, Timeouts, LOG_PREFIX } from "./client.js";
import { parseJSON } from "./utils.js";
import {
  MemoryTypes,
  TypedExtractionPrompts,
  getTagsForType,
  detectRelevantTypes,
} from "./memory-types.js";

/**
 * Extract memories of a specific type
 * @param {string} type - Memory type from MemoryTypes
 * @param {string} conversationText - Conversation to analyze
 * @returns {Promise<Array<{content: string, tags: string[], type: string}>>}
 */
export async function extractTypedMemories(type, conversationText) {
  const promptTemplate = TypedExtractionPrompts[type];
  if (!promptTemplate) {
    console.warn(LOG_PREFIX, `Unknown memory type: ${type}`);
    return [];
  }

  const prompt = promptTemplate.replace("{conversation}", conversationText.slice(0, 6000));

  try {
    const result = await callApi(
      "/product/chat/complete",
      { query: prompt, user_id: getMemosUserId(), mem_cube_id: getMemosCubeId(), enable_memory: false },
      { retries: 1, timeoutMs: Timeouts.EXTRACTION },
    );

    const text = result?.data?.response || result?.response || "";
    const parsed = parseJSON(text, `${type} extraction`);
    if (!Array.isArray(parsed)) return [];

    // Handle string arrays, object arrays (skills), and task objects
    return parsed
      .filter((item) => {
        if (typeof item === "string") return item.length > 10;
        if (typeof item === "object" && (item.content || item.title)) return true;
        return false;
      })
      .map((item) => {
        if (typeof item === "string") {
          return { content: item, tags: getTagsForType(type, ["typed_extraction"]), type };
        }
        // Structured object (skill or task)
        const itemType = item.type || type;
        const result = {
          content: item.content || item.title,
          tags: getTagsForType(itemType, ["typed_extraction"]),
          type: itemType,
        };
        // Pass through TickTick-aligned task fields
        if (itemType === "task") {
          if (item.title) result.title = item.title;
          if (item.priority) result.priority = item.priority;
          if (item.due_date) result.due_date = item.due_date;
          if (item.project) result.project = item.project;
          if (item.desc) result.desc = item.desc;
        }
        return result;
      });
  } catch (err) {
    console.warn(LOG_PREFIX, `extractTypedMemories(${type}) failed:`, err.message);
    return [];
  }
}

/**
 * Extract all relevant memory types from a conversation
 * @param {string} conversationText
 * @returns {Promise<Array<{content: string, tags: string[], type: string}>>}
 */
export async function extractAllTypedMemories(conversationText) {
  const relevantTypes = detectRelevantTypes(conversationText);
  console.log(LOG_PREFIX, `Detected relevant memory types: ${relevantTypes.join(", ")}`);

  const allMemories = [];

  for (const type of relevantTypes) {
    try {
      const memories = await extractTypedMemories(type, conversationText);
      if (memories.length > 0) {
        console.log(LOG_PREFIX, `Extracted ${memories.length} ${type} memories`);
        allMemories.push(...memories);
      }
    } catch (err) {
      console.warn(LOG_PREFIX, `Failed to extract ${type}:`, err.message);
    }
  }

  return allMemories;
}

/**
 * Extract skill from successful tool execution
 * Used by tool-trace hook for skill learning
 *
 * @param {object} toolResult - Tool execution result
 * @param {string} toolResult.name - Tool name
 * @param {object} toolResult.params - Tool parameters
 * @param {string} toolResult.result - Tool result
 * @param {boolean} toolResult.success - Whether tool succeeded
 * @param {number} toolResult.durationMs - Execution time
 * @returns {Promise<{content: string, tags: string[]}|null>}
 */
export async function extractSkillFromTool(toolResult) {
  // Only extract skills from complex, successful operations
  if (!toolResult.success) return null;

  // Skip simple tools
  const simpleTools = [
    "proxy_read",
    "proxy_message",
    "proxy_tts",
    "proxy_web_search",
    "proxy_session_status",
    "proxy_sessions_list",
    "proxy_cron", // list action
  ];

  if (simpleTools.includes(toolResult.name)) return null;

  // Only extract if the operation was significant (took some time or had complex params)
  if (toolResult.durationMs < 1000 && JSON.stringify(toolResult.params).length < 200) {
    return null;
  }

  const prompt = `You are a Skill Documenter. A tool was executed successfully. Document this as a reusable skill if it represents a meaningful workflow.

Tool: ${toolResult.name}
Parameters: ${JSON.stringify(toolResult.params, null, 2)}
Result: ${String(toolResult.result).slice(0, 1000)}
Duration: ${toolResult.durationMs}ms

IF this represents a reusable skill (not a trivial operation), return:
{
  "isSkill": true,
  "skill": {
    "name": "skill-name-kebab",
    "description": "One line description",
    "steps": ["Step 1", "Step 2"],
    "tools": ["tool1", "tool2"],
    "tips": ["Tip 1"]
  }
}

IF this is a trivial operation, return:
{ "isSkill": false }

Return only valid JSON.`;

  try {
    const result = await callApi(
      "/product/chat/complete",
      { query: prompt, user_id: getMemosUserId(), mem_cube_id: getMemosCubeId(), enable_memory: false },
      { retries: 1, timeoutMs: Timeouts.EXTRACTION },
    );

    const text = result?.data?.response || result?.response || "";
    const parsed = parseJSON(text, "skill extraction");
    if (!parsed.isSkill || !parsed.skill) return null;

    const skill = parsed.skill;
    const content = `---
name: ${skill.name}
description: ${skill.description}
tools: [${skill.tools?.join(", ") || toolResult.name}]
---

## Steps
${skill.steps?.map((s, i) => `${i + 1}. ${s}`).join("\n") || "1. Execute tool"}

## Tips
${skill.tips?.map((t) => `- ${t}`).join("\n") || "- Check result before proceeding"}
`;

    return {
      content,
      tags: getTagsForType(MemoryTypes.SKILL, ["tool_skill", toolResult.name]),
    };
  } catch (err) {
    console.warn(LOG_PREFIX, "extractSkillFromTool failed:", err.message);
    return null;
  }
}
