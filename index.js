/**
 * MemOS Lifecycle Plugin v2.1
 *
 * Production-grade memory bridge between OpenClaw and MemOS.
 *
 * Hook pipeline:
 *   before_agent_start  → smart retrieval → inject relevant memories
 *   agent_end           → extract durable facts (throttled)
 *   before_compaction   → segment conversation → summarize → persist
 *   after_compaction    → mark post-compaction state
 *   tool_result_persist → capture tool execution traces
 *
 * Architecture:
 *   index.js            — thin orchestrator (this file)
 *   hooks/*             — one handler per lifecycle event
 *   lib/client.js       — HTTP transport, auth, config
 *   lib/health.js       — cached liveness probe
 *   lib/search.js       — semantic search + formatting
 *   lib/memory.js       — write-path (fire-and-forget + awaitable)
 *   lib/summarize.js    — conversation summarization + fact extraction
 *   lib/retrieval.js    — smart retrieval pipeline (pre-decision, rewriting, filtering, segmentation)
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
    "Memory bridge: context injection, compaction flush, fact extraction, tool traces",
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
    },
    additionalProperties: false,
  },

  register(api) {
    const config = api.pluginConfig || {};
    applyConfig(config);

    let hookCount = 0;
    console.log(LOG_PREFIX, "Registering lifecycle plugin v2.1...");

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

    console.log(LOG_PREFIX, `Lifecycle plugin v2.1 registered (${hookCount} hooks active)`);
  },
};
