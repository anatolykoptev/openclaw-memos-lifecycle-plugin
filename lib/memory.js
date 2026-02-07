/**
 * MemOS Memory Persistence
 *
 * Write-path helpers for adding memories to MemOS.
 * Provides both fire-and-forget and awaitable variants.
 *
 * @module lib/memory
 */
import { callApi, MEMOS_USER_ID, MEMOS_CUBE_ID, Timeouts, LOG_PREFIX, computeContentHash } from "./client.js";

/**
 * Add a memory — fire-and-forget.
 * Failures are logged but never propagated.
 *
 * @param {string} content
 * @param {string[]} [tags]
 * @param {object} [info] - Structured metadata (stored in MemOS info field, all keys searchable via filter)
 */
export function addMemory(content, tags = [], info = undefined) {
  addMemoryAwait(content, tags, info).catch((err) => {
    console.warn(LOG_PREFIX, "addMemory (async) failed:", err.message);
  });
}

/**
 * Add a memory — awaitable version.
 * Use this when confirmation of persistence is required
 * (e.g. during the compaction flush).
 *
 * Auto-injects content_hash into info for cross-session deduplication.
 *
 * @param {string} content
 * @param {string[]} [tags]
 * @param {object} [info] - Structured metadata
 * @returns {Promise<true>}
 */
export async function addMemoryAwait(content, tags = [], info = undefined) {
  const mergedInfo = {
    content_hash: computeContentHash(content, info?._type || "memory"),
    ...info,
  };

  await callApi(
    "/product/add",
    {
      user_id: MEMOS_USER_ID,
      mem_cube_id: MEMOS_CUBE_ID,
      messages: content,
      custom_tags: tags,
      info: mergedInfo,
    },
    { retries: 3, timeoutMs: Timeouts.ADD },
  );
  return true;
}
