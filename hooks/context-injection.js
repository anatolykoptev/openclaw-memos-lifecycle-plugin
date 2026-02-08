/**
 * Hook: before_agent_start — Context Injection + Todo Auto-Remind
 *
 * Smart retrieval pipeline (inspired by memU):
 * 1. Pre-retrieval decision — skip casual/greeting prompts
 * 2. Query rewriting — enrich search query with entities and intent
 * 3. Semantic search via MemOS
 * 4. Sufficiency filtering — dedupe, drop low-value results
 * 5. Format and inject
 * 6. Todo Auto-Remind — proactively show pending tasks
 *
 * After compaction: enriched mode (summaries + relevant, more items).
 *
 * v3.0: Uses task-manager for todo auto-remind, proper filter param for search.
 *
 * @module hooks/context-injection
 */
import { isHealthy } from "../lib/health.js";
import { searchMemories, formatContextBlock } from "../lib/search.js";
import { LOG_PREFIX } from "../lib/client.js";
import {
  preRetrievalDecision,
  rewriteQuery,
  filterBySufficiency,
} from "../lib/retrieval.js";
import { rerankMemories } from "../lib/reranker.js";
import { findTasks, formatTaskList } from "../lib/task-manager.js";
import { inc, timing } from "../lib/stats.js";

// ─── Todo Auto-Remind Config ────────────────────────────────────────
const TODO_REMIND_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between reminds

/**
 * @param {object} state - Shared plugin state
 * @returns {(event: object) => Promise<{prependContext: string}|undefined>}
 */
export function createContextInjectionHandler(state) {
  return async (event) => {
    if (!event.prompt || event.prompt.length < 5) return;

    // ── Step 1: Pre-retrieval decision ──
    const postCompaction = state.isPostCompaction();
    const decision = postCompaction ? "force" : preRetrievalDecision(event.prompt);

    if (decision === "skip") {
      inc("injection.skip");
      console.log(LOG_PREFIX, "Pre-retrieval: skipping (casual/greeting)");
      return;
    }

    if (!(await isHealthy())) {
      console.warn(LOG_PREFIX, "MemOS unhealthy, skipping context injection");
      return;
    }

    const t0hook = Date.now();
    try {
      let memories = [];

      if (postCompaction) {
        // ── Post-compaction: enriched mode ──
        inc("injection.postCompaction");
        console.log(LOG_PREFIX, "Post-compaction mode: fetching enriched context");
        const enrichedQuery = rewriteQuery(event.prompt, true);

        const t0s = Date.now();
        const [summaries, relevant] = await Promise.all([
          searchMemories(
            "compaction summary decisions progress pending tasks",
            8,
            { filter: { _type: "compaction_summary" } },
          ).catch(() => []),
          searchMemories(enrichedQuery, 8).catch(() => []),
        ]);
        timing("search", Date.now() - t0s);

        const seen = new Set();
        for (const m of [...summaries, ...relevant]) {
          const key = (m.memory || m.content || "").slice(0, 100);
          if (key && !seen.has(key)) {
            seen.add(key);
            memories.push(m);
          }
        }

        if (state.rerankerEnabled) {
          const t0r = Date.now();
          const before = memories.length;
          memories = await rerankMemories(enrichedQuery, memories);
          timing("rerank", Date.now() - t0r);
          inc("rerank.kept", memories.length);
          inc("rerank.total", before);
        }
      } else {
        // ── Step 2: Query rewriting ──
        const searchQuery = rewriteQuery(event.prompt, false);
        const topK = decision === "force" ? 14 : 12;

        // ── Step 3: Semantic search ──
        const t0s = Date.now();
        memories = await searchMemories(searchQuery, topK);
        timing("search", Date.now() - t0s);

        // ── Step 3.5: LLM reranking ──
        if (state.rerankerEnabled) {
          const t0r = Date.now();
          const before = memories.length;
          memories = await rerankMemories(searchQuery, memories);
          timing("rerank", Date.now() - t0r);
          inc("rerank.kept", memories.length);
          inc("rerank.total", before);
        }
      }

      // ── Step 4: Sufficiency filtering ──
      memories = filterBySufficiency(memories, {
        minLength: 20,
        maxDuplicateOverlap: 0.65,
      });

      if (memories.length === 0) {
        console.log(LOG_PREFIX, "No relevant memories after filtering");
        return;
      }

      // ── Step 5: Format and inject ──
      const contextBlock = formatContextBlock(memories, {
        maxItems: postCompaction ? 12 : 8,
        maxChars: postCompaction ? 800 : 500,
        header: postCompaction
          ? "Context restored from MemOS after compaction:"
          : "Relevant memories from MemOS:",
      });

      // ── Step 6: Todo Auto-Remind (proactive) ──
      let todoReminder = "";
      const now = Date.now();
      if (now - state.lastTodoRemindTime > TODO_REMIND_COOLDOWN_MS) {
        state.lastTodoRemindTime = now; // set first to prevent race
        const pendingTasks = await findTasks({ status: "pending" });
        if (pendingTasks.length > 0) {
          todoReminder = formatTaskList(pendingTasks);
          console.log(LOG_PREFIX, `Todo Auto-Remind: ${pendingTasks.length} pending tasks`);
        }
      }

      if (!contextBlock && !todoReminder) return;

      const parts = [];
      if (contextBlock) parts.push(contextBlock);
      if (todoReminder) parts.push(todoReminder);

      inc("injection.count");
      inc(`injection.${decision}`);
      inc("injection.memoriesInjected", memories.length);

      const contextStr = parts.join("\n\n");
      timing("hooks", Date.now() - t0hook);

      console.log(
        LOG_PREFIX,
        `Injecting ${memories.length} memories (${postCompaction ? "post-compaction" : "normal"}, decision=${decision}, ${contextStr.length} chars)${todoReminder ? " + todo reminder" : ""}`,
      );

      return {
        prependContext: `<user_memory_context>\n${contextStr}\n</user_memory_context>`,
      };
    } catch (err) {
      inc("search.errors");
      console.warn(LOG_PREFIX, "Context injection failed:", err.message);
    }
  };
}
