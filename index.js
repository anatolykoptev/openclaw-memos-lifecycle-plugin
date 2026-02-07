/**
 * MemOS Lifecycle Plugin v3.1
 *
 * Production-grade memory bridge between OpenClaw and MemOS.
 * Typed memory extraction, task lifecycle, todo auto-remind.
 *
 * Hook pipeline:
 *   before_agent_start  → smart retrieval → inject memories + todo auto-remind
 *   agent_end           → extract typed memories (profile/behavior/skill/event/task)
 *   before_compaction   → segment conversation → summarize → persist
 *   after_compaction    → mark post-compaction state
 *   tool_result_persist → capture tool traces + extract skills from complex operations
 *
 * Tools:
 *   memos_create_task   → create a task with priority/deadline
 *   memos_complete_task → mark a task as completed
 *   memos_list_tasks    → list tasks by status/priority
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
 *   lib/memory-types.js   — memory type definitions and prompts
 *   lib/typed-extraction.js — typed memory extraction logic
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

// ─── Shared State ───────────────────────────────────────────────────
const POST_COMPACTION_WINDOW_MS = 2 * 60 * 1000;

const state = {
  lastCompactionTime: 0,
  compactionCount: 0,
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
      internalServiceSecret: { type: "string" },
      contextInjection: { type: "boolean", default: true },
      factExtraction: { type: "boolean", default: true },
      compactionFlush: { type: "boolean", default: true },
      toolTraces: { type: "boolean", default: true },
      taskManager: { type: "boolean", default: true },
    },
    additionalProperties: false,
  },

  register(api) {
    const config = api.pluginConfig || {};
    applyConfig(config);

    let hookCount = 0;
    console.log(LOG_PREFIX, "Registering lifecycle plugin v3.1 (utils consolidation + getter migration)...");

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
        description: "Create a new task/todo with priority, deadline, project. Fields aligned with TickTick API.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            desc: { type: "string", description: "Detailed description / notes" },
            priority: { type: "string", enum: ["P0", "P1", "P2"], default: "P2", description: "Priority: P0=urgent, P1=important, P2=normal" },
            due_date: { type: "string", description: "Due date (e.g. '2026-02-10', 'Friday')" },
            start_date: { type: "string", description: "Start date (e.g. '2026-02-08')" },
            project: { type: "string", description: "Project name (e.g. 'MemOSina', 'Piter.now')" },
            items: { type: "array", items: { type: "string" }, description: "Subtask list" },
            context: { type: "string", description: "Additional context" },
          },
          required: ["title"],
        },
        execute: async (params) => createTask(params.title, params),
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
        execute: async (params) => completeTask(params.task_id, params.outcome),
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

    console.log(LOG_PREFIX, `Lifecycle plugin v3.1 registered (${hookCount} hooks active)`);
  },
};
