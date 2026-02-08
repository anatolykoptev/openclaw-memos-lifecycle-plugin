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
 * @param {{ filter?: object, timeoutMs?: number }} [opts] - Optional structured filter (MemOS APISearchRequest.filter)
 * @returns {Promise<{textMemories: Array, skillMemories: Array, prefMemories: Array}>}
 */
export async function searchMemories(query, topK = 5, { filter, timeoutMs } = {}) {
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
    timeoutMs: timeoutMs || Timeouts.SEARCH,
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
 * @param {{ filter?: object, timeoutMs?: number }} [opts]
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
    budget = 3000,
    header = "Relevant memories from MemOS:",
  } = opts;
  if (!memories?.length) return "";

  const items = memories.slice(0, maxItems);
  // Adaptive truncation: distribute budget across items
  const perItem = Math.min(maxChars, Math.floor(budget / Math.max(items.length, 1)));

  const parts = [header];
  for (const mem of items) {
    const content = getMemoryContent(mem);
    if (!content) continue;
    const truncated =
      content.length > perItem ? content.slice(0, perItem) + "…" : content;
    const recency = _formatRecency(mem);
    const tags = mem.tags?.length ? ` [${mem.tags.join(", ")}]` : "";
    parts.push(`- ${recency ? recency + " " : ""}${truncated}${tags}`);
  }

  return parts.length <= 1 ? "" : parts.join("\n");
}

/**
 * Format recency tag from memory metadata timestamps.
 * @param {object} mem
 * @returns {string} e.g. "[2h ago]", "[3d ago]", "[Jan 15]", or ""
 */
function _formatRecency(mem) {
  const meta = mem.metadata || mem;
  const ts = meta.updated_at || meta.created_at;
  if (!ts) return "";
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return "";
    const diffMs = Date.now() - date.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "[<1h ago]";
    if (diffH < 24) return `[${diffH}h ago]`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 14) return `[${diffD}d ago]`;
    const month = date.toLocaleString("en", { month: "short" });
    return `[${month} ${date.getDate()}]`;
  } catch { return ""; }
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
