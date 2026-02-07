# openclaw-memos-lifecycle-plugin

Memory bridge between [OpenClaw](https://openclaw.com) and [MemOS](https://github.com/MemTensor/MemOS). Your agent never loses important context — memories persist across conversation compactions and sessions.

## What's New in v3.0

**Task Lifecycle** — full task CRUD with append-only reconciliation, exposed as 3 agent tools:

| Tool | Purpose |
|------|---------|
| `memos_create_task` | Create a task with priority, deadline, project |
| `memos_complete_task` | Mark a task as completed with outcome notes |
| `memos_list_tasks` | List tasks filtered by status/priority/project |

**Structured `info` field** — all memory writes now carry structured metadata (content hash for dedup, `_type`, source). Searchable via MemOS `filter` parameter.

**TickTick field alignment** — task fields (`title`, `desc`, `due_date`, `start_date`, `project`, `items`) are consistent across manual creation, auto-extraction, and TickTick API.

**Typed Memory Extraction** — inspired by [memU](https://github.com/NevaMind-AI/memU), memories are categorized into distinct types:

| Type | What it captures | Tags |
|------|------------------|------|
| **Profile** | Stable user facts (age, job, location, preferences) | `user_profile`, `stable_fact` |
| **Behavior** | Recurring patterns, habits, routines | `behavior_pattern`, `habit` |
| **Skill** | Agent skills with documentation (how to do things) | `agent_skill`, `workflow` |
| **Event** | Time-bound events and decisions | `event`, `decision` |
| **Task** | Actionable items extracted from conversation | `task`, `pending` |

## Why?

MemOS stores and retrieves memories. OpenClaw runs agents. But MemOS doesn't know **when** to save or **what** to retrieve. This plugin bridges that gap:

- **When to save** — after every conversation (`agent_end`), before compaction (`before_compaction`), after tool calls (`tool_result_persist`)
- **When to retrieve** — before every agent turn (`before_agent_start`), with smart filtering to skip casual messages
- **What to extract** — typed memories (profile/behavior/skill/event/task), compaction summaries, tool execution traces, learned skills

## Features

- **Task management** — create, complete, and list tasks via agent tools; append-only reconciliation on MemOS (v3.0)
- **Structured info field** — content hash dedup, typed metadata, searchable via MemOS filter (v3.0)
- **Typed memory extraction** — memories categorized by type for better organization and retrieval
- **Skill learning** — complex tool operations documented as reusable skills
- **Smart context injection** — pre-retrieval decision skips greetings/casual prompts, query rewriting enriches search with entities and intent, sufficiency filtering removes duplicates
- **Compaction flush** — long conversations segmented into topic-coherent chunks, each summarized separately for higher quality memory extraction
- **Post-compaction recovery** — enriched context automatically restored after compaction (summaries + relevant memories)
- **Tool traces** — tool execution results saved for future reference (memory-related tools skipped to avoid recursion)
- **Non-fatal** — MemOS outages never crash the host agent
- **Configurable** — every hook can be individually toggled, all settings overridable via `openclaw.plugin.json`
- **Bilingual** — pre-retrieval patterns support English and Russian

## Installation

```bash
openclaw plugins install github:anatolykoptev/openclaw-memos-lifecycle-plugin
```

Or clone manually:

```bash
cd ~/.openclaw/extensions
git clone https://github.com/anatolykoptev/openclaw-memos-lifecycle-plugin
```

## Configuration

### Plugin Config (openclaw.json)

In `~/.openclaw/openclaw.json` under `plugins.entries`:

```jsonc
"openclaw-memos-lifecycle-plugin": {
  "enabled": true,
  "config": {
    "memosApiUrl": "http://127.0.0.1:8000",  // MemOS API base URL
    "memosUserId": "default",                  // MemOS user ID
    "internalServiceSecret": "",               // optional auth header
    "contextInjection": true,                  // toggle before_agent_start
    "factExtraction": true,                    // toggle agent_end
    "compactionFlush": true,                   // toggle before/after_compaction
    "toolTraces": true,                        // toggle tool_result_persist
    "taskManager": true                        // toggle task management tools
  }
}
```

All config values are optional — sensible defaults apply. You can also set `MEMOS_API_URL`, `MEMOS_USER_ID`, and `INTERNAL_SERVICE_SECRET` as environment variables or in `~/.openclaw/.env`.

### Recommended Compaction Settings

Add to `~/.openclaw/openclaw.json` under `agents.defaults`:

```jsonc
"compaction": {
  "mode": "safeguard",
  "reserveTokensFloor": 20000,
  "memoryFlush": {
    "enabled": true,
    "softThresholdTokens": 20000
  }
}
```

## Architecture

```
index.js                     <- Thin orchestrator (config + hook + tool registration)
|-- hooks/
|   |-- context-injection.js    before_agent_start  -> smart retrieval pipeline
|   |-- fact-extraction.js      agent_end           -> extract typed memories
|   |-- compaction-flush.js     before/after_compaction -> segment + summarize + persist
|   +-- tool-trace.js           tool_result_persist -> save execution traces + skill learning
+-- lib/
    |-- client.js               HTTP transport, auth, retries, config, dedup cache
    |-- utils.js                Shared utilities (JSON parsing, content access, task IDs)
    |-- health.js               Cached liveness probe (60s TTL)
    |-- search.js               Semantic search + context block formatting
    |-- memory.js               Write-path (fire-and-forget + awaitable, auto content hash)
    |-- task-manager.js         Task CRUD with append-only reconciliation
    |-- summarize.js            Conversation summarization + fact extraction
    |-- retrieval.js            Smart retrieval (pre-decision, rewriting, filtering, segmentation)
    |-- memory-types.js         Memory type definitions and extraction prompts
    +-- typed-extraction.js     Typed memory extraction logic
```

## Hook Pipeline

```
User message arrives
  |
  +- before_agent_start
  |    1. Pre-retrieval decision (skip greetings, force on memory references)
  |    2. Query rewriting (extract entities, intent, project names)
  |    3. Semantic search via MemOS
  |    4. Sufficiency filtering (dedupe, drop meta, min-length)
  |    5. Format and inject as <user_memory_context> block
  |
  +- Agent processes message (tokens accumulate)
  |    Tools available: memos_create_task, memos_complete_task, memos_list_tasks
  |
  +- agent_end
  |    Extract typed memories -> persist to MemOS (throttled 5 min)
  |    Auto-extracted tasks get task_id + TickTick fields in info
  |
  +- [Context grows to ~180k tokens -> compaction triggered]
  |
  +- before_compaction
  |    1. Segment conversation into 4-12 message topic chunks
  |    2. Summarize each segment -> structured entries with tags
  |    3. Persist all entries + compaction_event meta to MemOS
  |
  +- after_compaction
  |    Mark post-compaction timestamp
  |
  +- tool_result_persist
  |    Save tool execution traces, extract skills from complex operations
  |
  +- Next before_agent_start -> enriched mode
       (compaction_summary memories + relevant context)
```

## Hooks Reference

| Hook | Event | Type | Purpose |
|---|---|---|---|
| Context Injection | `before_agent_start` | modifying | Smart retrieval -> inject relevant memories |
| Fact Extraction | `agent_end` | void | Extract typed memories (throttled, skipped post-compaction) |
| Compaction Flush | `before_compaction` | void | Segment -> summarize -> persist structured entries |
| Compaction Mark | `after_compaction` | void | Set enriched context mode for next turn |
| Tool Trace | `tool_result_persist` | void | Save tool results + extract skills |

## Tools Reference

| Tool | Parameters | Purpose |
|---|---|---|
| `memos_create_task` | `title`, `desc?`, `priority?`, `due_date?`, `start_date?`, `project?`, `items?`, `context?` | Create a task |
| `memos_complete_task` | `task_id`, `outcome?` | Mark task as completed |
| `memos_list_tasks` | `status?`, `priority?`, `project?` | List/filter tasks |

## MemOS Tags

| Tag | Purpose |
|---|---|
| `compaction_summary` | Structured entries from compaction flush |
| `compaction_event` | Compaction statistics (message count, tokens, entries saved) |
| `auto_capture` | Facts extracted from normal conversations |
| `fact` | Durable facts (preferences, decisions, technical details) |
| `tool_trace` | Tool execution results |
| `task` | Task memories (creation and completion events) |

## Troubleshooting

**Plugin not loading**
Check OpenClaw logs for `[MEMOS]` lines:
```bash
journalctl --user -u openclaw-gateway.service -n 20 --no-pager | grep MEMOS
```

**No memories injected**
1. Verify MemOS is running: `curl -s http://127.0.0.1:8000/openapi.json | head -1`
2. Check that `memosApiUrl` in config matches your MemOS instance
3. Short/casual prompts ("hi", "ok") are intentionally skipped by the pre-retrieval filter

**Compaction flush failing**
The plugin logs `MemOS unhealthy during compaction flush` when the API is unreachable. Check MemOS container/service status.

**Too many/few memories injected**
The sufficiency filter removes duplicates (Jaccard overlap > 0.65) and JSON meta entries. Adjust by overriding the retrieval parameters in `lib/retrieval.js`.

## Requirements

- **OpenClaw** >= 2026.1.29
- **MemOS** with `/product/search`, `/product/add`, `/product/chat/complete` endpoints
- **Node.js** >= 22

## License

MIT — see [LICENSE](./LICENSE)
