# Changelog

All notable changes to this project will be documented in this file.

## [3.4.0] — 2026-02-07

### Added
- **TickTick project sync** (`lib/ticktick.js`) — direct REST API client for TickTick
  - Dynamic project resolution: fetches projects from TickTick API, matches by name (case-insensitive, emoji-stripped)
  - `fetchProjects()` — cached (5 min TTL), `resolveProjectId(name)`, `resolveOrFallback(name)`
  - Priority mapping: MemOS P0/P1/P2 ↔ TickTick 5/3/1
  - Token loaded from `TICKTICK_ACCESS_TOKEN` env or `~/.openclaw/mcp-servers/ticktick-mcp/.env`
- **`normalizeDate()`** — all dates (MemOS + TickTick) normalized to TickTick ISO format (`2026-02-10T00:00:00+0000`)
- **`memos_list_projects` tool** — lists TickTick projects dynamically from API
- **`ticktickSync` config toggle** — enable/disable TickTick integration (default: `true`)
- **TickTick stats** — `ticktick.taskCreated`, `taskCompleted`, `projectsResolved`, `errors`
- **Fallback with tags** — when TickTick project not found, task syncs to Personal with original project name as tag

### Changed
- `memos_create_task` now fire-and-forget syncs to TickTick with all fields (title, desc, priority, dueDate, startDate)
- Cron job `ticktick-memos-sync` rewritten for multi-project dynamic sync (no hardcoded project IDs)
- TickTick is single source of truth for projects — no auto-create, agent asks user to create manually if needed

### Fixed
- **`created_at` → `task_created_at`** in task info — MemOS silently drops `created_at` (reserved by `metadata.created_at`)
- **`completed_at` → `task_completed_at`** in task info — same reserved key collision as `created_at`
- **`ticktickFetch()` empty body handling** — TickTick complete endpoint returns HTTP 200 with empty body; was crashing on `res.json()`, now parses `text()` first
- **TickTick `POST /project` returns 500** — documented as known TickTick API bug; `resolveOrFallback()` gracefully falls back to default project instead of crashing

## [3.3.0] — 2026-02-07

### Added
- **Operation statistics** (`lib/stats.js`) — lightweight in-memory counters and timings for all plugin operations
  - Search call count, avg latency, errors
  - Rerank call count, avg latency, kept/total ratio
  - Injection decisions (skip/retrieve/force), post-compaction, memories injected
  - Extraction runs, throttle skips, dedup skips, saved count, per-type breakdown
  - Compaction runs, avg duration, entries saved/skipped/failed
  - Tool trace count, skills extracted
- **`memos_stats` agent tool** — returns formatted stats + raw snapshot, optional `reset` param to zero counters
- **Periodic stats log** — `formatStats()` logged every 30 minutes via `setInterval`
- Exports: `inc(path, n)`, `timing(path, ms)`, `getStats()`, `formatStats()`, `resetStats()`

### Changed
- All hooks instrumented with stats counters (context-injection, fact-extraction, compaction-flush, tool-trace)

## [3.2.0] — 2026-02-07

### Added
- **LLM Reranker** (`lib/reranker.js`) — filters irrelevant memories using Gemini (via MemOS `/product/chat/complete`) before context injection
  - Binary relevance judgement: returns only indices of relevant memories
  - Non-fatal: falls back to unfiltered results on any failure
  - Skips reranking when fewer than 3 memories (not worth the latency)
- **`Timeouts.RERANK`** (10s) — dedicated timeout for LLM reranking calls
- **`reranker` config toggle** — enable/disable in `openclaw.plugin.json` (default: `true`)

### Changed
- Search `topK` increased: 8→12 (normal), 10→14 (force), 6→8 (post-compaction per search) — over-fetch for reranker to filter down
- Post-compaction path now also runs reranker after dedup merge

## [3.1.0] — 2026-02-07

### Added
- **`lib/utils.js`** — shared utilities consolidating 4 duplicated patterns:
  - `parseJSON(text, context)` — robust JSON extraction from LLM output (was duplicated 3x)
  - `getMemoryContent(mem)` — memory text accessor (was duplicated 2x)
  - `getInfo(mem)` — info metadata accessor (was private in task-manager.js)
  - `generateTaskId()` — unique task ID generator (was duplicated 2x)
- **`Timeouts.EXTRACTION`** (20s) — dedicated timeout for single-type extraction, shorter than `SUMMARIZE` (60s)

### Changed
- All modules (`summarize.js`, `typed-extraction.js`, `search.js`, `memory.js`) use getter functions (`getMemosUserId()`, `getMemosCubeId()`) instead of mutable `let` exports
- `extractFacts` and `extractTypedMemories` use `Timeouts.EXTRACTION` (20s) instead of `Timeouts.SUMMARIZE` (60s)
- `extractSkillFromTool` uses `parseJSON()` instead of bare `JSON.parse()` (crash fix for malformed LLM output)

### Fixed
- **`hooks/tool-trace.js`** — `recentExecutions` Map now has cleanup logic (was unbounded, potential memory leak)

### Removed
- Back-compat mutable `let` exports from `client.js` (`MEMOS_API_URL`, `MEMOS_USER_ID`, `MEMOS_CUBE_ID`)
- Refresh logic in `applyConfig()` (no longer needed without mutable exports)
- `"search_memories"` from `tool-trace.js` `SKIP_PREFIXES` (no such tool exists)
- Local `getInfo()` from `task-manager.js` (moved to shared `utils.js`)
- Local `genTaskId()` from `fact-extraction.js` (moved to shared `utils.js`)

## [3.0.0] — 2026-02-07

### Added
- **Task lifecycle manager** (`lib/task-manager.js`) — full CRUD with append-only reconciliation
  - `createTask(title, opts)` — create tasks with TickTick-aligned fields
  - `findTasks(opts)` — reconcile creation + update memories, filter by status/priority/project
  - `completeTask(taskId, outcome)` — mark task completed with optional outcome
  - `formatTaskList(tasks)` — format for context injection
- **3 agent tools** registered in `index.js`: `memos_create_task`, `memos_complete_task`, `memos_list_tasks`
- **`info` field** on all memory writes — structured metadata with auto `content_hash` (SHA256 dedup, memU pattern)
- **Content hash deduplication** in `client.js` — `computeContentHash()`, `isDuplicateMemory()`, `markMemoryAdded()`
- **Structured task extraction** in `fact-extraction.js` — auto-extracted tasks get `task_id` + TickTick fields in `info`
- **Task type** added to `memory-types.js` extraction prompts

### Changed
- `searchMemories()` uses proper `filter` parameter instead of no-op `filter_tags`
- `addMemoryAwait()` auto-injects `content_hash` into `info` for cross-session deduplication
- Task fields aligned with TickTick API: `title`, `desc`, `due_date`, `start_date`, `project`, `items`
- `status` renamed to `task_status` in info (MemOS reserves `metadata.status` internally)

### Removed
- `openclaw-task-router` plugin (replaced by integrated task tools)

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
