/**
 * MemOS Conversation Summarization & Fact Extraction
 *
 * Converts raw OpenClaw message arrays into structured memory entries
 * suitable for persistence before context compaction.
 *
 * @module lib/summarize
 */
import { callApi, getMemosUserId, getMemosCubeId, Timeouts, LOG_PREFIX } from "./client.js";
import { parseJSON } from "./utils.js";

// ─── Message helpers ────────────────────────────────────────────────

/**
 * Regex patterns for plugin-injected blocks that should NOT be
 * treated as user/assistant conversation content.
 * Stripping these prevents memory pollution (re-extracting injected context as "facts").
 * @type {RegExp[]}
 */
const INJECTION_PATTERNS = [
  /<user_memory_context>[\s\S]*?<\/user_memory_context>/g,
  /<task_routing>[\s\S]*?<\/task_routing>/g,
  /<compaction_notice>[\s\S]*?<\/compaction_notice>/g,
  /<system_context>[\s\S]*?<\/system_context>/g,
];

/**
 * Strip plugin-injected blocks from message text.
 * @param {string} text
 * @returns {string}
 */
function sanitizeText(text) {
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, "");
  }
  return clean.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Extract plain text from an OpenClaw messages array.
 * Strips plugin-injected blocks to prevent memory pollution.
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

    let text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((b) => b?.type === "text")
              .map((b) => b.text)
              .join(" ")
          : "";

    text = sanitizeText(text);
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
      { query: prompt, user_id: getMemosUserId(), readable_cube_ids: [getMemosCubeId()], enable_memory: false },
      { retries: 1, timeoutMs: Timeouts.SUMMARIZE },
    );

    const text = result?.data?.response || result?.response || "";
    const parsed = parseJSON(text, "summarization");
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

