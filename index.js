/**
 * MemOS Lifecycle Plugin for OpenClaw
 *
 * Thin lifecycle hook that:
 * - Pre-fetches user context on command:new -> injects into bootstrap
 * - Auto-saves tool traces on tool_result_persist (fire-and-forget)
 * - Does NOT register tools (all tools come from MemOS MCP Server)
 *
 * Uses Internal Hooks (Gateway Hooks):
 * - command:new - fires when new session starts
 * - tool_result_persist - fires after tool execution completes
 *
 * @see docs/SEAMLESS-MEMORY.md
 */

import memosContextHandler from "./hooks/memos-context/handler.js";
import memosTraceHandler from "./hooks/memos-trace/handler.js";

const PLUGIN_TAG = "[MEMOS]";

/**
 * Plugin definition
 */
const memosLifecyclePlugin = {
  id: "memos-lifecycle",
  name: "MemOS Lifecycle",
  description: "Pre-loads memory context, auto-saves tool traces",
  kind: "lifecycle",

  register(api) {
    const logger = api.logger || console;

    // Register command:new hook for context loading
    if (typeof api.on === "function") {
      api.on("command:new", memosContextHandler);
      api.on("tool_result_persist", memosTraceHandler);
      logger.info?.(`${PLUGIN_TAG} Hooks registered: command:new, tool_result_persist`);
    } else {
      logger.warn?.(`${PLUGIN_TAG} api.on not available, hooks not registered`);
    }

    logger.info?.(`${PLUGIN_TAG} Plugin registered`);
  },
};

export default memosLifecyclePlugin;
