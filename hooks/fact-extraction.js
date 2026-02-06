/**
 * Hook: agent_end — Fact Extraction
 *
 * Extracts durable facts from completed conversations and persists
 * them to MemOS. Throttled to avoid excessive LLM calls.
 * Skipped when a compaction just happened (the flush already covered it).
 *
 * @module hooks/fact-extraction
 */
import { addMemory } from "../lib/memory.js";
import { extractFacts, flattenMessages } from "../lib/summarize.js";
import { LOG_PREFIX } from "../lib/client.js";

const THROTTLE_MS = 5 * 60 * 1000; // 5 min

/**
 * @param {object} state - Shared plugin state
 * @returns {(event: object) => Promise<void>}
 */
export function createFactExtractionHandler(state) {
  let lastRunTime = 0;

  return async (event) => {
    if (!event.success || !event.messages || event.messages.length < 2) return;

    if (state.isPostCompaction()) {
      console.log(LOG_PREFIX, "Post-compaction, skipping fact extraction (already flushed)");
      return;
    }

    const now = Date.now();
    if (now - lastRunTime < THROTTLE_MS) return;
    lastRunTime = now;

    const flat = flattenMessages(event.messages);
    if (flat.length < 2) return;

    try {
      const text = flat
        .slice(-10)
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n\n");

      console.log(LOG_PREFIX, "Extracting facts from conversation...");
      const facts = await extractFacts(text);

      if (facts?.length > 0) {
        console.log(LOG_PREFIX, `Saving ${facts.length} facts`);
        for (const fact of facts) {
          addMemory(fact, ["auto_capture", "fact"]);
        }
      }
    } catch (err) {
      console.warn(LOG_PREFIX, "Fact extraction failed:", err.message);
    }
  };
}
