/**
 * Hooks: before_compaction + after_compaction — Compaction Flush
 *
 * before_compaction: Summarizes the full conversation into structured
 *   memory entries and persists them to MemOS before context is lost.
 * after_compaction:  Marks a timestamp so the next before_agent_start
 *   switches to enriched context mode.
 *
 * v3.0: Uses info field for structured metadata on compaction events.
 *
 * @module hooks/compaction-flush
 */
import { isHealthy } from "../lib/health.js";
import { addMemory, addMemoryAwait } from "../lib/memory.js";
import { summarizeConversation, flattenMessages } from "../lib/summarize.js";
import { LOG_PREFIX, isDuplicateMemory, markMemoryAdded } from "../lib/client.js";
import { segmentConversation } from "../lib/retrieval.js";
import { inc, timing } from "../lib/stats.js";

/**
 * Rough token estimate from message character count.
 * @param {Array} messages
 * @returns {number}
 */
function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const msg of messages) {
    if (!msg) continue;
    const c =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((b) => b?.text || "").join("")
          : "";
    chars += c.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * @param {object} state - Shared plugin state
 * @returns {(event: object) => Promise<void>}
 */
export function createBeforeCompactionHandler(state) {
  return async (event) => {
    const messages = event?.messages || event?.session?.messages;
    const tokenEstimate = estimateTokens(messages);
    console.log(
      LOG_PREFIX,
      `before_compaction fired (${messages?.length || 0} msgs, ~${tokenEstimate} tokens)`,
    );

    if (!messages || messages.length < 4) {
      console.log(LOG_PREFIX, "Too few messages to summarize, skipping");
      return;
    }

    if (!(await isHealthy())) {
      console.error(LOG_PREFIX, "MemOS unhealthy during compaction flush — memories may be lost!");
      return;
    }

    const t0 = Date.now();
    try {
      // Segment long conversations for better extraction quality
      const flat = flattenMessages(messages);
      const segments = segmentConversation(flat, { minSegment: 4, maxSegment: 12 });
      const segmentCount = segments.length;

      console.log(
        LOG_PREFIX,
        `Summarizing conversation for compaction flush (${segmentCount} segment${segmentCount > 1 ? "s" : ""})...`,
      );

      // Summarize each segment — for short conversations this is just 1 segment
      const allEntries = [];
      for (const segment of segments) {
        // Rebuild message format expected by summarizeConversation
        const segmentMsgs = segment.map((m) => ({ role: m.role, content: m.text }));
        const entries = await summarizeConversation(segmentMsgs);
        allEntries.push(...entries);
      }

      if (allEntries.length === 0) {
        console.log(LOG_PREFIX, "No entries to persist");
        return;
      }

      let saved = 0;
      let failed = 0;
      let skipped = 0;
      await Promise.allSettled(
        allEntries.map(async (entry) => {
          try {
            if (isDuplicateMemory(entry.content)) {
              skipped++;
              inc("compaction.entriesSkipped");
              return;
            }
            await addMemoryAwait(entry.content, entry.tags);
            markMemoryAdded(entry.content);
            saved++;
            inc("compaction.entriesSaved");
          } catch (err) {
            failed++;
            inc("compaction.entriesFailed");
            console.warn(LOG_PREFIX, "Failed to save entry:", err.message);
          }
        }),
      );

      state.compactionCount++;
      addMemory(
        `Compaction #${state.compactionCount}: ${saved} entries saved from ${messages.length} messages`,
        ["compaction_summary"],
        {
          _type: "compaction_summary",
          compaction_number: state.compactionCount,
          entries_saved: saved,
          entries_failed: failed,
          entries_skipped: skipped,
          message_count: messages.length,
          token_estimate: tokenEstimate,
          ts: new Date().toISOString(),
        },
      );

      timing("compaction", Date.now() - t0);

      console.log(
        LOG_PREFIX,
        `Compaction flush: ${saved} saved, ${skipped} skipped, ${failed} failed (#${state.compactionCount})`,
      );
    } catch (err) {
      console.error(LOG_PREFIX, "Compaction flush failed:", err.message);
    }
  };
}

/**
 * @param {object} state - Shared plugin state
 * @returns {(event: object) => Promise<void>}
 */
export function createAfterCompactionHandler(state) {
  return async () => {
    state.lastCompactionTime = Date.now();
    console.log(
      LOG_PREFIX,
      `Compaction #${state.compactionCount} completed. Next turn uses enriched context.`,
    );
  };
}
