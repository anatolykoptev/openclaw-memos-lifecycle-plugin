/**
 * MemOS Conversation Summarization & Fact Extraction
 *
 * Converts raw OpenClaw message arrays into structured memory entries
 * suitable for persistence before context compaction.
 *
 * @module lib/summarize
 */
import { callApi, MEMOS_USER_ID, Timeouts, LOG_PREFIX } from "./client.js";

// ─── Message helpers ────────────────────────────────────────────────

/**
 * Extract plain text from an OpenClaw messages array.
 * @param {Array} messages
 * @param {number} [maxCharsPerMsg=2000]
 * @returns {Array<{role: string, text: string}>}
 */
export function flattenMessages(messages, maxCharsPerMsg = 2000) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const { role } = msg;
    if (role !== "user" && role !== "assistant") continue;

    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((b) => b?.type === "text")
              .map((b) => b.text)
              .join(" ")
          : "";

    if (text) out.push({ role, text: text.slice(0, maxCharsPerMsg) });
  }
  return out;
}

/**
 * Build a compact transcript for LLM summarization.
 * Keeps the last 4 turns in full; older turns are abbreviated.
 *
 * @param {Array} messages - Raw OpenClaw messages
 * @param {number} [maxChars=12000]
 * @returns {string}
 */
export function buildTranscript(messages, maxChars = 12000) {
  const flat = flattenMessages(messages);
  if (flat.length === 0) return "";

  const recentCount = Math.min(4, flat.length);
  const recent = flat.slice(-recentCount);
  const older = flat.slice(0, -recentCount);

  const recentText = recent.map((m) => `${m.role}: ${m.text}`).join("\n\n");

  const olderBudget = Math.max(0, maxChars - recentText.length - 200);
  let olderText = "";
  if (older.length > 0 && olderBudget > 200) {
    const charPerMsg = Math.floor(olderBudget / older.length);
    const lines = older.map(
      (m) => `${m.role}: ${m.text.slice(0, Math.max(100, charPerMsg))}`,
    );
    olderText = lines.join("\n\n");
    if (olderText.length > olderBudget) {
      olderText = olderText.slice(0, olderBudget) + "\n[…truncated…]";
    }
  }

  return olderText
    ? `[Earlier context]\n${olderText}\n\n[Recent]\n${recentText}`
    : recentText;
}

// ─── Summarization ──────────────────────────────────────────────────

/**
 * Summarize a conversation into structured memory entries.
 * Returns objects ready for {@link addMemoryAwait}.
 *
 * @param {Array} messages - Raw OpenClaw messages
 * @returns {Promise<Array<{content: string, tags: string[]}>>}
 */
export async function summarizeConversation(messages) {
  const transcript = buildTranscript(messages, 12000);
  if (transcript.length < 50) return [];

  const prompt = `You are a memory extraction system. Analyze the conversation below and produce a JSON array of memory entries to preserve before the context is compressed.

Each entry: { "content": "<fact or decision>", "tags": ["<tag1>", "<tag2>"] }

Rules:
- Extract 3-8 entries (more for long conversations).
- Categories: decision, preference, task_progress, pending_task, technical_detail, personal_info, instruction.
- "content" must be a self-contained sentence — understandable without the original conversation.
- Include WHO, WHAT, WHEN where relevant.
- If nothing important, return [].

Conversation:
${transcript}`;

  try {
    const result = await callApi(
      "/product/chat/complete",
      { query: prompt, user_id: MEMOS_USER_ID, enable_memory: false },
      { retries: 1, timeoutMs: Timeouts.SUMMARIZE },
    );

    const text = result?.data?.response || result?.response || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      // Attempt cleanup: trailing commas, smart quotes
      const cleaned = match[0]
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn(LOG_PREFIX, "Could not parse summarization JSON");
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((e) => e && typeof e.content === "string" && e.content.length > 10)
      .map((e) => ({
        content: e.content,
        tags: [
          "compaction_summary",
          ...(Array.isArray(e.tags)
            ? e.tags.filter((t) => typeof t === "string")
            : []),
        ],
      }));
  } catch (err) {
    console.warn(LOG_PREFIX, "summarizeConversation failed:", err.message);
    return [];
  }
}

// ─── Fact Extraction ────────────────────────────────────────────────

/**
 * Extract durable facts from a conversation snippet.
 * @param {string} conversationText
 * @returns {Promise<string[]>}
 */
export async function extractFacts(conversationText) {
  const prompt = `Analyze this conversation and extract ONLY important facts worth remembering long-term.
Focus on:
- User preferences and habits
- Personal information (location, timezone, work)
- Important decisions made
- Technical details about projects
- Anything explicitly asked to remember

Return as JSON array of strings. If nothing important, return empty array [].
Max 5 facts per conversation.

Conversation:
${conversationText.slice(0, 4000)}`;

  try {
    const result = await callApi(
      "/product/chat/complete",
      { query: prompt, user_id: MEMOS_USER_ID, enable_memory: false },
      { retries: 1, timeoutMs: Timeouts.SUMMARIZE },
    );

    const text = result?.data?.response || result?.response || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let arr;
    try {
      arr = JSON.parse(match[0]);
    } catch {
      const cleaned = match[0]
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      try {
        arr = JSON.parse(cleaned);
      } catch {
        console.warn(LOG_PREFIX, "Could not parse extractFacts JSON");
        return [];
      }
    }
    return Array.isArray(arr)
      ? arr.filter((s) => typeof s === "string" && s.length > 10)
      : [];
  } catch (err) {
    console.warn(LOG_PREFIX, "extractFacts failed:", err.message);
    return [];
  }
}
