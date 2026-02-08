/**
 * MemOS Search & Context Formatting
 *
 * Semantic memory search and context block formatting
 * for injection into agent conversations.
 *
 * @module lib/search
 */
import { callApi, getMemosUserId, getMemosCubeId, Timeouts } from "./client.js";
import { getMemoryContent } from "./utils.js";

/**
 * Search memories by semantic similarity.
 *
 * @param {string} query
 * @param {number} [topK=5]
 * @param {{ filter?: object }} [opts] - Optional structured filter (MemOS APISearchRequest.filter)
 * @returns {Promise<{textMemories: Array, skillMemories: Array, prefMemories: Array}>}
 */
export async function searchMemories(query, topK = 5, { filter } = {}) {
  const body = {
    query,
    user_id: getMemosUserId(),
    readable_cube_ids: [getMemosCubeId()],
    top_k: topK,
    include_skill_memory: true,
    skill_mem_top_k: 3,
    include_preference: true,
    dedup: "mmr",
    internet_search: true,
  };
  if (filter) body.filter = filter;

  const result = await callApi("/product/search", body, {
    timeoutMs: Timeouts.SEARCH,
  });
  return {
    textMemories: result?.data?.text_mem?.[0]?.memories || [],
    skillMemories: result?.data?.skill_mem?.[0]?.memories || [],
    prefMemories: result?.data?.pref_mem?.[0]?.memories || [],
  };
}

/**
 * Legacy helper: search and return only text memories (flat array).
 * Used by callers that don't need skill/preference memories.
 *
 * @param {string} query
 * @param {number} [topK=5]
 * @param {{ filter?: object }} [opts]
 * @returns {Promise<Array>}
 */
export async function searchTextMemories(query, topK = 5, opts = {}) {
  const result = await searchMemories(query, topK, opts);
  return result.textMemories;
}

/**
 * Format an array of text memories into a human-readable context block.
 *
 * @param {Array} memories
 * @param {{ maxItems?: number, maxChars?: number, header?: string }} [opts]
 * @returns {string} Empty string when there is nothing to inject.
 */
export function formatContextBlock(memories, opts = {}) {
  const {
    maxItems = 10,
    maxChars = 500,
    header = "Relevant memories from MemOS:",
  } = opts;
  if (!memories?.length) return "";

  const parts = [header];
  for (const mem of memories.slice(0, maxItems)) {
    const content = getMemoryContent(mem);
    if (!content) continue;
    const truncated =
      content.length > maxChars ? content.slice(0, maxChars) + "…" : content;
    const tags = mem.tags?.length ? ` [${mem.tags.join(", ")}]` : "";
    parts.push(`- ${truncated}${tags}`);
  }

  return parts.length <= 1 ? "" : parts.join("\n");
}

/**
 * Format skill memories with structured fields.
 *
 * @param {Array} skillMemories
 * @param {{ maxItems?: number }} [opts]
 * @returns {string}
 */
export function formatSkillBlock(skillMemories, opts = {}) {
  const { maxItems = 3 } = opts;
  if (!skillMemories?.length) return "";

  const parts = ["Relevant skills from MemOS:"];
  for (const mem of skillMemories.slice(0, maxItems)) {
    const meta = mem.metadata || mem;
    const name = meta.name || meta.key || "unnamed";
    const desc = meta.description || getMemoryContent(mem) || "";
    const procedure = meta.procedure || "";

    let entry = `- [Skill: ${name}] ${desc}`;
    if (procedure) entry += `\n  Procedure: ${procedure.length > 300 ? procedure.slice(0, 300) + "…" : procedure}`;
    parts.push(entry);
  }

  return parts.length <= 1 ? "" : parts.join("\n");
}

/**
 * Format preference memories with prefix.
 *
 * @param {Array} prefMemories
 * @param {{ maxItems?: number, maxChars?: number }} [opts]
 * @returns {string}
 */
export function formatPrefBlock(prefMemories, opts = {}) {
  const { maxItems = 3, maxChars = 300 } = opts;
  if (!prefMemories?.length) return "";

  const parts = ["User preferences from MemOS:"];
  for (const mem of prefMemories.slice(0, maxItems)) {
    const content = getMemoryContent(mem);
    if (!content) continue;
    const truncated = content.length > maxChars ? content.slice(0, maxChars) + "…" : content;
    parts.push(`- [Preference] ${truncated}`);
  }

  return parts.length <= 1 ? "" : parts.join("\n");
}
