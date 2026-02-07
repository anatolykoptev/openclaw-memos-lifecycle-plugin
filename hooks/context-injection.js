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

// ─── Todo Auto-Remind Config ────────────────────────────────────────
const TODO_REMIND_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between reminds
let lastTodoRemindTime = 0;

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
      console.log(LOG_PREFIX, "Pre-retrieval: skipping (casual/greeting)");
      return;
    }

    if (!(await isHealthy())) {
      console.warn(LOG_PREFIX, "MemOS unhealthy, skipping context injection");
      return;
    }

    try {
      let memories = [];

      if (postCompaction) {
        // ── Post-compaction: enriched mode ──
        console.log(LOG_PREFIX, "Post-compaction mode: fetching enriched context");
        const enrichedQuery = rewriteQuery(event.prompt, true);

        const [summaries, relevant] = await Promise.all([
          searchMemories(
            "compaction summary decisions progress pending tasks",
            8,
            { filter: { _type: "compaction_summary" } },
          ).catch(() => []),
          searchMemories(enrichedQuery, 8).catch(() => []),
        ]);

        const seen = new Set();
        for (const m of [...summaries, ...relevant]) {
          const key = (m.memory || m.content || "").slice(0, 100);
          if (key && !seen.has(key)) {
            seen.add(key);
            memories.push(m);
          }
        }

        if (state.rerankerEnabled) {
          memories = await rerankMemories(enrichedQuery, memories);
        }
      } else {
        // ── Step 2: Query rewriting ──
        const searchQuery = rewriteQuery(event.prompt, false);
        const topK = decision === "force" ? 14 : 12;

        // ── Step 3: Semantic search ──
        memories = await searchMemories(searchQuery, topK);

        // ── Step 3.5: LLM reranking ──
        if (state.rerankerEnabled) {
          memories = await rerankMemories(searchQuery, memories);
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
      if (now - lastTodoRemindTime > TODO_REMIND_COOLDOWN_MS) {
        const pendingTasks = await findTasks({ status: "pending" });
        if (pendingTasks.length > 0) {
          todoReminder = formatTaskList(pendingTasks);
          lastTodoRemindTime = now;
          console.log(LOG_PREFIX, `Todo Auto-Remind: ${pendingTasks.length} pending tasks`);
        }
      }

      if (!contextBlock && !todoReminder) return;

      const parts = [];
      if (contextBlock) parts.push(contextBlock);
      if (todoReminder) parts.push(todoReminder);

      console.log(
        LOG_PREFIX,
        `Injecting ${memories.length} memories (${postCompaction ? "post-compaction" : "normal"}, decision=${decision})${todoReminder ? " + todo reminder" : ""}`,
      );

      return {
        prependContext: `<user_memory_context>\n${parts.join("\n\n")}\n</user_memory_context>`,
      };
    } catch (err) {
      console.warn(LOG_PREFIX, "Context injection failed:", err.message);
    }
  };
}
