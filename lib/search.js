/**
 * MemOS Search & Context Formatting
 *
 * Semantic memory search and context block formatting
 * for injection into agent conversations.
 *
 * @module lib/search
 */
import { callApi, MEMOS_USER_ID, MEMOS_CUBE_ID, Timeouts } from "./client.js";

/**
 * Search memories by semantic similarity.
 *
 * @param {string} query
 * @param {number} [topK=5]
 * @param {string[]} [filterTags] - Optional tag filter
 * @returns {Promise<Array<{memory: string, score?: number, tags?: string[]}>>}
 */
export async function searchMemories(query, topK = 5, filterTags = undefined) {
  const body = { query, user_id: MEMOS_USER_ID, mem_cube_id: MEMOS_CUBE_ID, top_k: topK };
  if (filterTags?.length) body.filter_tags = filterTags;

  const result = await callApi("/product/search", body, {
    timeoutMs: Timeouts.SEARCH,
  });
  return result?.data?.text_mem?.[0]?.memories || [];
}

/**
 * Format an array of memories into a human-readable context block.
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
    const content = mem.memory || mem.content || mem.memory_content || "";
    if (!content) continue;
    const truncated =
      content.length > maxChars ? content.slice(0, maxChars) + "…" : content;
    const tags = mem.tags?.length ? ` [${mem.tags.join(", ")}]` : "";
    parts.push(`- ${truncated}${tags}`);
  }

  return parts.length <= 1 ? "" : parts.join("\n");
}
