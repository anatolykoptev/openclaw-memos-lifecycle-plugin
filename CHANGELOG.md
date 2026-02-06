# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] — 2026-02-06

### Added
- **Smart retrieval pipeline** (`lib/retrieval.js`) — inspired by [memU](https://github.com/AidenYuanDev/memu)
  - **Pre-retrieval decision** — keyword-based filter (EN + RU) skips greetings and casual prompts, saving unnecessary MemOS calls
  - **Query rewriting** — extracts file references, project names, and action intent to build enriched search queries instead of naive `"important context " + prompt.slice(200)`
  - **Sufficiency filtering** — Jaccard word-overlap deduplication, drops JSON meta entries and short content
  - **Conversation segmentation** — splits long conversations into 4-12 message topic-coherent chunks for higher quality compaction summaries
- **Configurable hooks** — each hook can be individually toggled via `openclaw.plugin.json` config: `contextInjection`, `factExtraction`, `compactionFlush`, `toolTraces`
- **Runtime config** — `applyConfig()` accepts config from `api.pluginConfig` at registration time; `getMemosApiUrl()`/`getMemosUserId()` getters for runtime access
- **`uiHints`** in manifest — labels, help text, `sensitive` flag for secrets, `advanced` flag for API settings
- **`configSchema`** on exported plugin object (per Plugin API spec)
- **`peerDependencies`** — `openclaw >= 2026.1.29`
- `LICENSE` (MIT)
- `.gitignore`

### Changed
- `context-injection.js` — rewired to 5-step pipeline: decision → rewrite → search → filter → inject
- `compaction-flush.js` — segments conversation before summarizing each chunk separately
- `client.js` — mutable config via `_config` object, `applyConfig()` + getters; `callApi` uses `_config` instead of static constants
- `health.js` — uses `getMemosApiUrl()` getter instead of static import
- `index.js` — calls `applyConfig(api.pluginConfig)`, conditionally registers hooks based on boolean config flags, dynamic hook count
- `openclaw.plugin.json` — removed non-standard `main` and `kind` fields, added full `configSchema` with 7 properties, added `uiHints`
- `package.json` — added `repository`, `homepage`, `engines`, `peerDependencies`, expanded keywords
- `README.md` — complete rewrite for public audience: Why section, full config reference, architecture diagram, pipeline flowchart, troubleshooting guide

### Fixed
- **`extractFacts`** — lazy regex `[\s\S]*?` grabbed first `]` instead of last; changed to greedy `[\s\S]*` + JSON cleanup fallback (trailing commas, smart quotes)
- **`addMemoryAwait`** — was passing `async_mode: "async"` which defeated the purpose of awaitable write; removed for synchronous persistence
- **Fact extraction threshold** — `flat.length < 3` skipped valid 2-message conversations; restored original `< 2`
- **`summarizeConversation`** — same lazy regex fix as extractFacts, plus robust JSON parsing with cleanup fallback

### Removed
- User-specific project names (`krolik`, `hully`) from query rewriting patterns

## [2.0.0] — 2026-02-02

### Added
- **Modular architecture** — split monolithic `index.js` + `memos-api.js` into:
  - `hooks/context-injection.js` — `before_agent_start` handler
  - `hooks/fact-extraction.js` — `agent_end` handler with 5-min throttle
  - `hooks/compaction-flush.js` — `before_compaction` + `after_compaction` handlers
  - `hooks/tool-trace.js` — `tool_result_persist` handler
  - `lib/client.js` — HTTP transport with exponential backoff and auth
  - `lib/health.js` — cached liveness probe (60s TTL)
  - `lib/search.js` — semantic search + context block formatting
  - `lib/memory.js` — fire-and-forget + awaitable write paths
  - `lib/summarize.js` — `flattenMessages`, `buildTranscript`, `summarizeConversation`, `extractFacts`
- **Post-compaction enriched mode** — after compaction, next `before_agent_start` fetches `compaction_summary` tagged memories + relevant context
- **`buildTranscript`** — smart truncation preserving last 4 turns in full, older turns abbreviated
- **`formatContextBlock`** — configurable `maxItems`, `maxChars`, `header`

### Changed
- `index.js` reduced from ~400 lines to thin orchestrator (69 lines)
- `memos-api.js` split into 5 focused modules
- Hook registration moved from inline to factory functions (`createContextInjectionHandler`, etc.)

### Fixed
- Health check changed from `/health` (404) to `/openapi.json` with HEAD request

### Removed
- `hooks/memos-context/` — replaced by `hooks/context-injection.js` (Plugin API approach instead of HOOK.md)
- `hooks/memos-trace/` — replaced by `hooks/tool-trace.js`
- `lib/memos-api.js` — split into `lib/client.js`, `lib/health.js`, `lib/search.js`, `lib/memory.js`, `lib/summarize.js`
- `docs/SEAMLESS-MEMORY.md` — internal doc, not needed for public release

## [1.0.0] — 2026-01-15

### Initial release
- **Single-file architecture** — `index.js` (~400 lines) + `lib/memos-api.js` (~150 lines)
- **Hook directory approach** — `hooks/memos-context/HOOK.md` + `handler.js` for context injection, `hooks/memos-trace/` for tool traces
- **Core features**:
  - Context injection via `before_agent_start` — searches MemOS and prepends relevant memories
  - Fact extraction via `agent_end` — LLM-based extraction, throttled to once per 10 minutes
  - Tool trace persistence via `tool_result_persist`
  - MemOS API client with basic retry logic
  - `searchMemories`, `addMemory`, `addMemoryAwait`, `extractFacts` in `memos-api.js`
- **MemOS integration** — HTTP REST API (`/product/search`, `/product/add`, `/product/chat/complete`)
- **Non-fatal design** — all hooks wrapped in try/catch, MemOS outages never crash the agent
