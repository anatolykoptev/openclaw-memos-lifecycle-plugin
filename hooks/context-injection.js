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
import { searchMemories, formatContextBlock, formatSkillBlock, formatPrefBlock } from "../lib/search.js";
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
const TODO_REMIND_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between reminds (tasks are lightweight)

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

      let skillMemories = [];
      let prefMemories = [];

      if (postCompaction) {
        // ── Post-compaction: enriched mode ──
        inc("injection.postCompaction");
        console.log(LOG_PREFIX, "Post-compaction mode: fetching enriched context");
        const enrichedQuery = rewriteQuery(event.prompt, true);

        const t0s = Date.now();
        const emptyResult = { textMemories: [], skillMemories: [], prefMemories: [] };
        const [summaryResult, relevantResult] = await Promise.all([
          searchMemories(
            "compaction summary decisions progress pending tasks",
            8,
            { filter: { _type: "compaction_summary" } },
          ).catch(() => emptyResult),
          searchMemories(enrichedQuery, 8).catch(() => emptyResult),
        ]);
        timing("search", Date.now() - t0s);

        // Merge skill + pref from both searches (deduped by content)
        skillMemories = [...(summaryResult.skillMemories || []), ...(relevantResult.skillMemories || [])];
        prefMemories = [...(summaryResult.prefMemories || []), ...(relevantResult.prefMemories || [])];

        const seen = new Set();
        for (const m of [...(summaryResult.textMemories || []), ...(relevantResult.textMemories || [])]) {
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
        const topK = decision === "force" ? 10 : 8;

        // ── Step 3: Semantic search ──
        const t0s = Date.now();
        const searchResult = await searchMemories(searchQuery, topK);
        timing("search", Date.now() - t0s);

        memories = searchResult.textMemories;
        skillMemories = searchResult.skillMemories;
        prefMemories = searchResult.prefMemories;

        // ── Step 3.5: LLM reranking (text memories only) ──
        if (state.rerankerEnabled) {
          const t0r = Date.now();
          const before = memories.length;
          memories = await rerankMemories(searchQuery, memories);
          timing("rerank", Date.now() - t0r);
          inc("rerank.kept", memories.length);
          inc("rerank.total", before);
        }
      }

      // ── Step 4: Sufficiency filtering (text memories) ──
      memories = filterBySufficiency(memories, {
        minLength: 20,
        maxDuplicateOverlap: 0.80,
      });

      const hasAny = memories.length > 0 || skillMemories.length > 0 || prefMemories.length > 0;

      // ── Step 5: Format and inject ──
      const contextBlock = formatContextBlock(memories, {
        maxItems: postCompaction ? 12 : 6,
        maxChars: postCompaction ? 800 : 500,
        header: postCompaction
          ? "Context restored from MemOS after compaction:"
          : "Relevant memories from MemOS:",
      });

      const skillBlock = formatSkillBlock(skillMemories, {
        maxItems: postCompaction ? 3 : 2,
      });

      const prefBlock = formatPrefBlock(prefMemories, {
        maxItems: postCompaction ? 3 : 2,
      });

      // ── Step 6: Todo Auto-Remind (always, with short cooldown) ──
      let todoReminder = "";
      const now = Date.now();
      if (now - state.lastTodoRemindTime > TODO_REMIND_COOLDOWN_MS) {
        try {
          const pendingTasks = await findTasks({ status: "pending" });
          if (pendingTasks.length > 0) {
            todoReminder = formatTaskList(pendingTasks);
            console.log(LOG_PREFIX, `Todo Auto-Remind: ${pendingTasks.length} pending tasks`);
          }
          state.lastTodoRemindTime = now; // set AFTER success, so retries on failure
        } catch (taskErr) {
          console.warn(LOG_PREFIX, `Todo Auto-Remind failed (will retry next prompt): ${taskErr.message}`);
        }
      }

      if (!hasAny && !todoReminder) return;

      const parts = [];
      if (contextBlock) parts.push(contextBlock);
      if (skillBlock) parts.push(skillBlock);
      if (prefBlock) parts.push(prefBlock);
      if (todoReminder) parts.push(todoReminder);

      inc("injection.count");
      inc(`injection.${decision}`);
      inc("injection.memoriesInjected", memories.length);
      if (skillMemories.length) inc("injection.skillMemories", skillMemories.length);
      if (prefMemories.length) inc("injection.prefMemories", prefMemories.length);

      const contextStr = parts.join("\n\n");
      timing("hooks", Date.now() - t0hook);

      const extras = [
        skillMemories.length ? `${skillMemories.length} skills` : "",
        prefMemories.length ? `${prefMemories.length} prefs` : "",
        todoReminder ? "todo" : "",
      ].filter(Boolean).join(", ");

      console.log(
        LOG_PREFIX,
        `Injecting ${memories.length} memories (${postCompaction ? "post-compaction" : "normal"}, decision=${decision}, ${contextStr.length} chars)${extras ? ` + ${extras}` : ""}`,
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
