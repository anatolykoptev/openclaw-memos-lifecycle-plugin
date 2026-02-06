/**
 * MemOS Memory Persistence
 *
 * Write-path helpers for adding memories to MemOS.
 * Provides both fire-and-forget and awaitable variants.
 *
 * @module lib/memory
 */
import { callApi, MEMOS_USER_ID, Timeouts, LOG_PREFIX } from "./client.js";

/**
 * Add a memory — fire-and-forget.
 * Failures are logged but never propagated.
 *
 * @param {string} content
 * @param {string[]} [tags]
 */
export function addMemory(content, tags = []) {
  addMemoryAwait(content, tags).catch((err) => {
    console.warn(LOG_PREFIX, "addMemory (async) failed:", err.message);
  });
}

/**
 * Add a memory — awaitable version.
 * Use this when confirmation of persistence is required
 * (e.g. during the compaction flush).
 *
 * @param {string} content
 * @param {string[]} [tags]
 * @returns {Promise<true>}
 */
export async function addMemoryAwait(content, tags = []) {
  await callApi(
    "/product/add",
    {
      user_id: MEMOS_USER_ID,
      messages: content,
      custom_tags: tags,
    },
    { retries: 3, timeoutMs: Timeouts.ADD },
  );
  return true;
}
