/**
 * MemOS Lifecycle Plugin v3.5.1
 *
 * Production-grade memory bridge between OpenClaw and MemOS.
 * Typed memory extraction, task lifecycle, LLM reranker, operation stats,
 * TickTick project sync (dynamic project resolution via API).
 *
 * Hook pipeline:
 *   before_agent_start  → smart retrieval → inject memories + todo auto-remind
 *   agent_end           → extract typed memories (profile/behavior/event/task)
 *   before_compaction   → segment conversation → summarize → persist
 *   after_compaction    → mark post-compaction state
 *   tool_result_persist → capture tool traces
 *
 * Tools:
 *   memos_create_task   → create a task with priority/deadline
 *   memos_complete_task → mark a task as completed
 *   memos_list_tasks    → list tasks by status/priority
 *   memos_stats         → show operation statistics, optionally reset
 *   memos_list_projects → list TickTick projects (dynamic from API)
 *
 * Architecture:
 *   index.js              — thin orchestrator (this file)
 *   hooks/*               — one handler per lifecycle event
 *   lib/client.js         — HTTP transport, auth, config, dedup cache
 *   lib/health.js         — cached liveness probe
 *   lib/search.js         — semantic search + formatting
 *   lib/memory.js         — write-path (fire-and-forget + awaitable)
 *   lib/task-manager.js   — task CRUD with append-only reconciliation
 *   lib/summarize.js      — conversation summarization + fact extraction
 *   lib/retrieval.js      — smart retrieval pipeline
 *   lib/reranker.js       — LLM-based relevance filtering of search results
 *   lib/stats.js          — in-memory operation counters and timings
 *   lib/memory-types.js   — memory type definitions and prompts
 *   lib/typed-extraction.js — typed memory extraction logic
 *   lib/ticktick.js       — TickTick API client, project resolution
 *
 * Every hook is non-fatal: MemOS outages never crash the host agent.
 */
import { LOG_PREFIX, applyConfig } from "./lib/client.js";
import { createContextInjectionHandler } from "./hooks/context-injection.js";
import { createFactExtractionHandler } from "./hooks/fact-extraction.js";
import {
  createBeforeCompactionHandler,
  createAfterCompactionHandler,
} from "./hooks/compaction-flush.js";
import { handleToolTrace } from "./hooks/tool-trace.js";
import { createTask, completeTask, findTasks } from "./lib/task-manager.js";
import { getStats, formatStats, resetStats } from "./lib/stats.js";
import {
  isAvailable as isTickTickAvailable,
  fetchProjects,
  resolveOrFallback,
  createTickTickTask,
  completeTickTickTask,
  mapPriorityToTickTick,
  normalizeDate,
} from "./lib/ticktick.js";
import { inc } from "./lib/stats.js";

// ─── Shared State ───────────────────────────────────────────────────
const POST_COMPACTION_WINDOW_MS = 2 * 60 * 1000;

const state = {
  lastCompactionTime: 0,
  compactionCount: 0,
  lastTodoRemindTime: 0,
  rerankerEnabled: false,
  ticktickSyncEnabled: false,
  isPostCompaction() {
    return (
      this.lastCompactionTime > 0 &&
      Date.now() - this.lastCompactionTime < POST_COMPACTION_WINDOW_MS
    );
  },
};

// ─── Plugin ─────────────────────────────────────────────────────────
export default {
  id: "openclaw-memos-lifecycle-plugin",
  name: "MemOS Lifecycle",
  description:
    "Memory bridge: context injection, compaction flush, fact extraction, tool traces, task management",
  configSchema: {
    type: "object",
    properties: {
      memosApiUrl: { type: "string", default: "http://127.0.0.1:8000" },
      memosUserId: { type: "string", default: "default" },
      memosCubeId: { type: "string", default: "default" },
      internalServiceSecret: { type: "string" },
      contextInjection: { type: "boolean", default: true },
      factExtraction: { type: "boolean", default: true },
      compactionFlush: { type: "boolean", default: true },
      toolTraces: { type: "boolean", default: true },
      taskManager: { type: "boolean", default: true },
      reranker: { type: "boolean", default: false },
      ticktickSync: { type: "boolean", default: true },
    },
    additionalProperties: false,
  },

  register(api) {
    const config = api.pluginConfig || {};
    applyConfig(config);
    state.rerankerEnabled = config.reranker === true;
    state.ticktickSyncEnabled = config.ticktickSync !== false && isTickTickAvailable();

    let hookCount = 0;
    console.log(LOG_PREFIX, `Registering lifecycle plugin v3.4 (TickTick sync: ${state.ticktickSyncEnabled ? "on" : "off"})...`);

    if (config.contextInjection !== false) {
      api.on("before_agent_start", createContextInjectionHandler(state));
      hookCount++;
    }
    if (config.factExtraction !== false) {
      api.on("agent_end", createFactExtractionHandler(state));
      hookCount++;
    }
    if (config.compactionFlush !== false) {
      api.on("before_compaction", createBeforeCompactionHandler(state));
      api.on("after_compaction", createAfterCompactionHandler(state));
      hookCount += 2;
    }
    if (config.toolTraces !== false) {
      api.registerHook(["tool_result_persist"], handleToolTrace, {
        name: "memos-tool-trace",
      });
      hookCount++;
    }

    // ─── Task Management Tools ──────────────────────────────────────
    if (config.taskManager !== false) {
      api.registerTool({
        name: "memos_create_task",
        description: "Create a new task/todo with priority, deadline, project. Syncs to TickTick automatically. Project must exist in TickTick — use memos_list_projects to see available projects. If project not found, task syncs to default (Personal).",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            desc: { type: "string", description: "Detailed description / notes" },
            priority: { type: "string", enum: ["P0", "P1", "P2"], default: "P2", description: "Priority: P0=urgent, P1=important, P2=normal" },
            due_date: { type: "string", description: "Due date (e.g. '2026-02-10', 'Friday')" },
            start_date: { type: "string", description: "Start date (e.g. '2026-02-08')" },
            project: { type: "string", description: "TickTick project name (use memos_list_projects to see available). If not found, falls back to Personal." },
            items: { type: "array", items: { type: "string" }, description: "Subtask list" },
            context: { type: "string", description: "Additional context" },
          },
          required: ["title"],
        },
        execute: async (params) => {
          const result = await createTask(params.title, params);
          // Fire-and-forget TickTick sync
          if (state.ticktickSyncEnabled) {
            resolveOrFallback(params.project || "personal")
              .then((proj) => {
                if (!proj) return null;
                if (proj.fallback) {
                  result._ticktick_warning =
                    `Project "${params.project}" not found in TickTick. Task synced to "${proj.name}" instead. ` +
                    `Available TickTick projects: ${(proj.availableProjects || []).join(", ")}. ` +
                    `Ask the user to create the project in TickTick app if needed.`;
                }
                const taskPayload = {
                  title: params.title,
                  projectId: proj.id,
                  content: params.desc || "",
                  priority: mapPriorityToTickTick(params.priority || "P2"),
                };
                if (params.due_date) taskPayload.dueDate = normalizeDate(params.due_date);
                if (params.start_date) taskPayload.startDate = normalizeDate(params.start_date);
                // Tag with original project name on fallback so it's easy to filter
                if (proj.fallback && params.project) {
                  taskPayload.tags = [params.project];
                }
                return createTickTickTask(taskPayload);
              })
              .then((tt) => {
                if (!tt) return;
                inc("ticktick.taskCreated");
                console.log(LOG_PREFIX, `TickTick task synced: "${params.title}" → ${tt.id}`);
              })
              .catch((err) => {
                inc("ticktick.errors");
                console.error(LOG_PREFIX, "TickTick sync error (create):", err.message);
              });
          }
          return result;
        },
      });

      api.registerTool({
        name: "memos_complete_task",
        description: "Mark a task as completed with optional outcome notes",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID (from memos_list_tasks or memos_create_task)" },
            outcome: { type: "string", description: "Optional outcome/notes about completion" },
          },
          required: ["task_id"],
        },
        execute: async (params) => {
          const result = await completeTask(params.task_id, params.outcome);
          // TickTick completion is handled by the cron sync job
          // (we don't store TickTick task IDs in MemOS yet)
          return result;
        },
      });

      api.registerTool({
        name: "memos_list_tasks",
        description: "List tasks filtered by status, priority, and/or project",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "done"], description: "Filter by status (default: all)" },
            priority: { type: "string", enum: ["P0", "P1", "P2"], description: "Filter by priority" },
            project: { type: "string", description: "Filter by project name" },
          },
        },
        execute: async (params) => findTasks(params),
      });

      console.log(LOG_PREFIX, "Task management tools registered (create/complete/list)");
    }

    // ─── Stats Tool ──────────────────────────────────────────────────
    api.registerTool({
      name: "memos_stats",
      description: "Show plugin operation statistics (search/rerank/injection/extraction/compaction/tool trace counters and timings). Optionally reset counters.",
      parameters: {
        type: "object",
        properties: {
          reset: { type: "boolean", description: "Reset all counters after returning stats", default: false },
        },
      },
      execute: async (params) => {
        const snapshot = getStats();
        const formatted = formatStats();
        if (params?.reset) resetStats();
        return { stats: snapshot, formatted };
      },
    });

    // ─── TickTick Project Tool ────────────────────────────────────────
    if (state.ticktickSyncEnabled) {
      api.registerTool({
        name: "memos_list_projects",
        description: "List TickTick projects (fetched dynamically from API). Shows project names and IDs for task sync.",
        parameters: { type: "object", properties: {} },
        execute: async () => {
          try {
            const projects = await fetchProjects(true);
            const active = projects.filter((p) => !p.closed);
            return {
              count: active.length,
              projects: active.map((p) => ({ id: p.id, name: p.name })),
            };
          } catch (err) {
            return { error: err.message };
          }
        },
      });
      console.log(LOG_PREFIX, "TickTick project tool registered (memos_list_projects)");
    }

    // ─── Periodic Stats Log (every 30 min) ───────────────────────────
    setInterval(() => {
      console.log(LOG_PREFIX, "=== Periodic Stats ===\n" + formatStats());
    }, 30 * 60 * 1000);

    console.log(LOG_PREFIX, `Lifecycle plugin v3.4 registered (${hookCount} hooks, TickTick: ${state.ticktickSyncEnabled ? "on" : "off"})`);
  },
};
