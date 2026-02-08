/**
 * LLM Reranker
 *
 * Filters irrelevant memories by sending search results + query
 * to an LLM (via MemOS /product/chat/complete) for binary relevance
 * judgement. Non-fatal — falls back to unfiltered results on any failure.
 *
 * @module lib/reranker
 */
import { callApi, getMemosUserId, getMemosCubeId, Timeouts, LOG_PREFIX } from "./client.js";
import { getMemoryContent, parseJSON } from "./utils.js";

const MAX_SNIPPET_CHARS = 300;
const MIN_MEMORIES_TO_RERANK = 3;

/**
 * Build the reranking prompt.
 * @param {string} query
 * @param {Array<{memory?: string, content?: string}>} memories
 * @returns {string}
 */
function buildPrompt(query, memories) {
  const snippets = memories.map((mem, i) => {
    const text = getMemoryContent(mem);
    const truncated = text.length > MAX_SNIPPET_CHARS
      ? text.slice(0, MAX_SNIPPET_CHARS) + "…"
      : text;
    return `[${i}] ${truncated}`;
  });

  return `You are a relevance judge. Given a user query and memory snippets from a personal knowledge base, return ONLY the indices of memories that are relevant to the query.

RELEVANT = directly relates to the query topic, contains useful info
NOT RELEVANT = different topic, only shares a keyword, generic/unrelated

Query: "${query}"

Memories:
${snippets.join("\n")}

Return a JSON array of relevant indices. Example: [0, 2, 5]
If none are relevant, return: []`;
}

/**
 * Rerank memories using LLM relevance judgement.
 *
 * Sends query + memory snippets to Gemini via MemOS chat/complete,
 * parses the returned index array, and filters memories accordingly.
 * On any failure, returns the original memories unchanged.
 *
 * @param {string} query - The search query
 * @param {Array} memories - Memory results from searchMemories()
 * @returns {Promise<Array>} Filtered memories (relevant only)
 */
export async function rerankMemories(query, memories) {
  if (!memories || memories.length < MIN_MEMORIES_TO_RERANK) {
    return memories || [];
  }

  try {
    const prompt = buildPrompt(query, memories);

    const result = await callApi("/product/chat/complete", {
      user_id: getMemosUserId(),
      readable_cube_ids: [getMemosCubeId()],
      query: prompt,
      top_k: 1,
      include_preference: false,
      add_message_on_answer: false,
      max_tokens: 50,
      temperature: 0,
    }, { retries: 1, timeoutMs: Timeouts.RERANK });

    const responseText = result?.data?.response || "";
    const indices = parseJSON(responseText, "reranker");

    if (!Array.isArray(indices)) {
      console.warn(LOG_PREFIX, "Reranker: could not parse index array, using all memories");
      return memories;
    }

    // Validate and deduplicate indices
    const seen = new Set();
    const validIndices = [];
    for (const idx of indices) {
      const n = typeof idx === "string" ? parseInt(idx, 10) : idx;
      if (Number.isInteger(n) && n >= 0 && n < memories.length && !seen.has(n)) {
        seen.add(n);
        validIndices.push(n);
      }
    }

    if (validIndices.length === 0) {
      console.log(LOG_PREFIX, "Reranker: 0 relevant memories (all filtered out)");
      return [];
    }

    const filtered = validIndices.map(i => memories[i]);
    console.log(LOG_PREFIX, `Reranker: ${filtered.length}/${memories.length} memories relevant`);
    return filtered;
  } catch (err) {
    console.warn(LOG_PREFIX, "Reranker failed (using unfiltered):", err.message);
    return memories;
  }
}
