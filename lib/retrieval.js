/**
 * Smart Retrieval Pipeline
 *
 * Inspired by memU's multi-step retrieval with:
 * 1. Pre-retrieval decision — skip casual/greeting prompts
 * 2. Query rewriting — enrich search query with conversation context
 * 3. Sufficiency filtering — drop low-relevance results
 *
 * @module lib/retrieval
 */
import { LOG_PREFIX } from "./client.js";

// ─── Pre-retrieval Decision ─────────────────────────────────────────

const NO_RETRIEVE_PATTERNS_EN = [
  "hello", "hi ", "hey", "good morning", "good evening", "good night",
  "thanks", "thank you", "ok", "okay", "bye", "goodbye",
  "how are you", "what's up", "sure", "got it", "understood",
  "yes", "no", "agree", "cool", "nice", "great",
];

const NO_RETRIEVE_PATTERNS_RU = [
  "привет", "здравствуй", "добр", "спасибо", "благодар",
  "пока", "хорошо", "ладно", "окей", "ок ", "да ", "нет ",
  "понял", "ясно", "круто", "отлично", "супер", "угу",
];

const FORCE_RETRIEVE_PATTERNS_EN = [
  "remember", "recall", "you said", "we discussed", "last time",
  "previously", "my preference", "what did", "when did",
  "you told me", "as before", "like last",
];

const FORCE_RETRIEVE_PATTERNS_RU = [
  "помнишь", "вспомни", "ты говорил", "мы обсуждали", "в прошлый",
  "ранее", "как раньше", "моё предпочт", "что ты", "когда мы",
  "как обычно", "как всегда",
];

/**
 * Fast keyword-based pre-retrieval decision.
 * Avoids calling MemOS for greetings, acknowledgments, and tiny prompts.
 *
 * @param {string} prompt
 * @returns {"retrieve" | "skip" | "force"}
 */
export function preRetrievalDecision(prompt) {
  if (!prompt || prompt.length < 8) return "skip";

  const lower = prompt.toLowerCase().trim();

  // Very short prompts — likely casual
  if (lower.length < 15) {
    const isCasual =
      NO_RETRIEVE_PATTERNS_EN.some((p) => lower.includes(p)) ||
      NO_RETRIEVE_PATTERNS_RU.some((p) => lower.includes(p));
    if (isCasual) return "skip";
  }

  // Explicit memory references — always retrieve
  if (
    FORCE_RETRIEVE_PATTERNS_EN.some((p) => lower.includes(p)) ||
    FORCE_RETRIEVE_PATTERNS_RU.some((p) => lower.includes(p))
  ) {
    return "force";
  }

  // Casual patterns in longer prompts — still skip if the WHOLE prompt is casual
  if (lower.length < 30) {
    const words = lower.split(/\s+/);
    if (words.length <= 3) {
      const isCasual =
        NO_RETRIEVE_PATTERNS_EN.some((p) => lower.includes(p)) ||
        NO_RETRIEVE_PATTERNS_RU.some((p) => lower.includes(p));
      if (isCasual) return "skip";
    }
  }

  return "retrieve";
}

// ─── Query Rewriting ────────────────────────────────────────────────

/**
 * Rewrite a search query by extracting key entities and intent from the prompt
 * instead of naive prefix concatenation.
 *
 * @param {string} prompt - User's prompt
 * @param {boolean} isPostCompaction - Whether we're in post-compaction mode
 * @returns {string} Rewritten search query
 */
export function rewriteQuery(prompt, isPostCompaction = false) {
  const lower = prompt.toLowerCase();
  const queryParts = [];

  // Extract referenced entities (files, projects, tools, names)
  const fileRefs = prompt.match(/\b[\w-]+\.(py|js|ts|tsx|json|yaml|yml|md|sh|css|html)\b/gi);
  if (fileRefs) queryParts.push(...new Set(fileRefs));

  const projectRefs = prompt.match(/\b(?:openclaw|memos|caddy|nginx|docker|systemd|kubernetes|redis|postgres)\b/gi);
  if (projectRefs) queryParts.push(...new Set(projectRefs));

  // Extract action intent
  if (/\b(настро[йи]|config|setup|install)\b/i.test(lower)) queryParts.push("configuration setup");
  if (/\b(deploy|деплой|release|publish)\b/i.test(lower)) queryParts.push("deployment");
  if (/\b(debug|отлад|fix|исправ|баг|bug|error|ошибк)\b/i.test(lower)) queryParts.push("debugging errors");
  if (/\b(refactor|рефактор|restructur|модуляриз)\b/i.test(lower)) queryParts.push("refactoring architecture");
  if (/\b(prefer|предпочт|always|всегда|обычно|usually)\b/i.test(lower)) queryParts.push("preferences habits");

  // For post-compaction: prioritize continuity
  if (isPostCompaction) {
    queryParts.unshift("decisions", "progress", "pending tasks");
  }

  // Build final query: entities + intent + truncated prompt
  const promptCore = prompt.slice(0, 150).replace(/\s+/g, " ").trim();
  const enrichment = queryParts.length > 0 ? queryParts.join(" ") + " " : "";

  return `${enrichment}${promptCore}`;
}

// ─── Sufficiency Filtering ──────────────────────────────────────────

/**
 * Filter memories by relevance quality.
 * Drops duplicates, near-duplicates, and low-value entries.
 *
 * @param {Array} memories - Raw memories from MemOS
 * @param {{ minLength?: number, maxDuplicateOverlap?: number }} [opts]
 * @returns {Array} Filtered memories
 */
export function filterBySufficiency(memories, opts = {}) {
  const { minLength = 20, maxDuplicateOverlap = 0.7 } = opts;
  if (!memories?.length) return [];

  const accepted = [];
  const seenTexts = [];

  for (const mem of memories) {
    const content = mem.memory || mem.content || mem.memory_content || "";
    if (!content || content.length < minLength) continue;

    // Skip system/meta memories that leak into results
    if (content.startsWith("{") && content.includes('"type"')) continue;

    // Deduplicate by overlap ratio
    const contentLower = content.toLowerCase().slice(0, 200);
    let isDupe = false;
    for (const seen of seenTexts) {
      if (_overlapRatio(contentLower, seen) > maxDuplicateOverlap) {
        isDupe = true;
        break;
      }
    }
    if (isDupe) continue;

    seenTexts.push(contentLower);
    accepted.push(mem);
  }

  return accepted;
}

/**
 * Quick overlap ratio between two strings (Jaccard on word sets).
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
function _overlapRatio(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── Conversation Segmentation ──────────────────────────────────────

/**
 * Segment a long conversation into topic-coherent chunks for better
 * compaction summarization (inspired by memU's _preprocess_conversation).
 *
 * Strategy: split on large gaps in conversation (assistant→user role switches
 * after substantial content), keeping segments of 4-12 messages each.
 *
 * @param {Array<{role: string, text: string}>} flat - Flattened messages
 * @param {{ minSegment?: number, maxSegment?: number }} [opts]
 * @returns {Array<Array<{role: string, text: string}>>} Segments
 */
export function segmentConversation(flat, opts = {}) {
  const { minSegment = 4, maxSegment = 12 } = opts;
  if (!flat || flat.length <= maxSegment) return [flat];

  const segments = [];
  let current = [];

  for (let i = 0; i < flat.length; i++) {
    current.push(flat[i]);

    // Check if this is a natural break point:
    // - Current chunk is large enough
    // - Role switches from assistant → user (new topic likely)
    // - Next message is user (new turn)
    const isBreakPoint =
      current.length >= minSegment &&
      flat[i].role === "assistant" &&
      i + 1 < flat.length &&
      flat[i + 1].role === "user";

    if (isBreakPoint || current.length >= maxSegment) {
      segments.push(current);
      current = [];
    }
  }

  // Remaining messages
  if (current.length > 0) {
    if (current.length < minSegment && segments.length > 0) {
      // Merge short tail into last segment
      segments[segments.length - 1].push(...current);
    } else {
      segments.push(current);
    }
  }

  return segments;
}
