/**
 * Typed Memory Extraction
 *
 * Extracts memories using type-specific prompts for better quality.
 * Inspired by memU's profile/behavior/event separation.
 *
 * @module lib/typed-extraction
 */
import { callApi, getMemosUserId, getMemosCubeId, Timeouts, LOG_PREFIX } from "./client.js";
import { parseJSON } from "./utils.js";
import {
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

    // Handle string arrays and task objects
    return parsed
      .filter((item) => {
        if (typeof item === "string") return item.length > 10;
        if (typeof item === "object" && item.title) return true;
        return false;
      })
      .map((item) => {
        if (typeof item === "string") {
          return { content: item, tags: getTagsForType(type, ["typed_extraction"]), type };
        }
        // Structured task object
        const result = {
          content: item.title,
          tags: getTagsForType("task", ["typed_extraction"]),
          type: "task",
        };
        if (item.title) result.title = item.title;
        if (item.priority) result.priority = item.priority;
        if (item.due_date) result.due_date = item.due_date;
        if (item.project) result.project = item.project;
        if (item.desc) result.desc = item.desc;
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

