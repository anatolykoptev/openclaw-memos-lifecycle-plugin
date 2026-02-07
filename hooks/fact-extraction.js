/**
 * Hook: agent_end — Typed Memory Extraction
 *
 * Extracts typed memories (profile, behavior, skill, event, task) from
 * completed conversations and persists them to MemOS.
 * Throttled to avoid excessive LLM calls.
 * Skipped when a compaction just happened (the flush already covered it).
 *
 * v3.0: Uses info field for structured metadata instead of tag prefix hacks.
 *
 * @module hooks/fact-extraction
 */
import { addMemory } from "../lib/memory.js";
import { flattenMessages } from "../lib/summarize.js";
import { extractAllTypedMemories } from "../lib/typed-extraction.js";
import { LOG_PREFIX, isDuplicateMemory, markMemoryAdded } from "../lib/client.js";

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
        .slice(-12)
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n\n");

      console.log(LOG_PREFIX, "Extracting typed memories from conversation...");
      const memories = await extractAllTypedMemories(text);

      if (memories?.length > 0) {
        let saved = 0, skipped = 0;
        for (const mem of memories) {
          const memType = mem.type || "fact";
          if (isDuplicateMemory(mem.content, memType)) {
            skipped++;
            continue;
          }

          const info = { _type: memType, source: "typed_extraction" };
          if (memType === "task") info.task_status = "pending";

          addMemory(mem.content, mem.tags, info);
          markMemoryAdded(mem.content, memType);
          saved++;
        }
        if (saved > 0 || skipped > 0) {
          console.log(LOG_PREFIX, `Typed memories: ${saved} saved, ${skipped} skipped (duplicates)`);
        }
      }
    } catch (err) {
      console.warn(LOG_PREFIX, "Typed memory extraction failed:", err.message);
    }
  };
}
