/**
 * Shared Utilities
 *
 * Consolidated helpers used across multiple modules.
 * Eliminates duplicated JSON parsing, memory content access,
 * info extraction, and task ID generation patterns.
 *
 * @module lib/utils
 */
import { LOG_PREFIX } from "./client.js";

/**
 * Parse JSON from LLM output text, with cleanup for common LLM artifacts.
 * Handles trailing commas, smart quotes, and markdown code fences.
 *
 * @param {string} text - Raw LLM response text
 * @param {string} [context="JSON"] - Label for warning messages
 * @returns {any|null} Parsed JSON value, or null on failure
 */
export function parseJSON(text, context = "JSON") {
  if (typeof text !== "string" || text.length > 50_000) return null;
  const match = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch {
    const cleaned = match[0]
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try { return JSON.parse(cleaned); }
    catch { console.warn(LOG_PREFIX, `Could not parse ${context}`); return null; }
  }
}

/**
 * Extract text content from a MemOS memory result.
 * Handles the three field name variants across MemOS API versions.
 *
 * @param {object} mem - Memory result object
 * @returns {string}
 */
export function getMemoryContent(mem) {
  return mem?.memory || mem?.content || mem?.memory_content || "";
}

/**
 * Extract info metadata from a MemOS memory result.
 * Handles both nested (metadata.info) and flat (info) layouts.
 *
 * @param {object} mem - Memory result object
 * @returns {object}
 */
export function getInfo(mem) {
  return mem?.metadata?.info || mem?.info || {};
}

/**
 * Generate a unique task ID.
 *
 * @returns {string} e.g. "task_1738900000000_a1b2c3"
 */
export function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
