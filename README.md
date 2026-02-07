# openclaw-memos-lifecycle-plugin

Memory bridge between [OpenClaw](https://openclaw.com) and [MemOS](https://github.com/MemTensor/MemOS). Your agent never forgets — memories persist across conversation compactions and sessions.

## Why?

MemOS stores and retrieves memories. OpenClaw runs agents. But MemOS doesn't know **when** to save or **what** to retrieve. This plugin bridges that gap:

- **When to save** — after every conversation, before compaction, after tool calls
- **When to retrieve** — before every agent turn, with smart filtering to skip casual messages
- **What to extract** — typed memories (profile / behavior / skill / event / task), compaction summaries, tool traces

## Features

| Feature | Description | Since |
|---------|-------------|-------|
| **LLM reranker** | Filters irrelevant search results via LLM before injection; over-fetches (top_k=12) then keeps only relevant memories | v3.2 |
| **Task management** | Create, complete, list tasks via agent tools; append-only reconciliation on MemOS | v3.0 |
| **Typed memory extraction** | Memories categorized into 5 types (profile, behavior, skill, event, task) | v3.0 |
| **Smart context injection** | Pre-retrieval decision, query rewriting, sufficiency filtering | v2.1 |
| **Compaction flush** | Conversations segmented into topic-coherent chunks, each summarized separately | v2.0 |
| **Post-compaction recovery** | Enriched context automatically restored after compaction | v2.0 |
| **Skill learning** | Complex tool operations documented as reusable skills | v2.0 |
| **Tool traces** | Tool execution results saved for future reference | v1.0 |
| **Content hash dedup** | SHA256-based deduplication prevents duplicate memories | v3.0 |
| **Bilingual** | Pre-retrieval patterns support English and Russian | v2.1 |

Every hook is **non-fatal** — MemOS outages never crash the host agent.

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

In `~/.openclaw/openclaw.json` under `plugins.entries`:

```jsonc
"openclaw-memos-lifecycle-plugin": {
  "enabled": true,
  "config": {
    "memosApiUrl": "http://127.0.0.1:8000",
    "memosUserId": "default",
    "internalServiceSecret": "",
    "contextInjection": true,
    "factExtraction": true,
    "compactionFlush": true,
    "toolTraces": true,
    "taskManager": true,
    "reranker": true
  }
}
```

All values are optional — sensible defaults apply. Credentials can also be set via `MEMOS_API_URL`, `MEMOS_USER_ID`, `INTERNAL_SERVICE_SECRET` environment variables or `~/.openclaw/.env`.

### Compaction settings

Add to `~/.openclaw/openclaw.json` under `agents.defaults`:

```jsonc
"compaction": {
  "mode": "safeguard",
  "reserveTokensFloor": 20000,
  "memoryFlush": { "enabled": true, "softThresholdTokens": 20000 }
}
```

## Architecture

```
index.js                        Thin orchestrator (config + hook + tool registration)
hooks/
  context-injection.js           before_agent_start  -> retrieval + rerank + inject
  fact-extraction.js             agent_end           -> extract typed memories
  compaction-flush.js            before/after_compaction -> segment + summarize + persist
  tool-trace.js                  tool_result_persist -> save traces + learn skills
lib/
  client.js                      HTTP transport, auth, retries, config, dedup cache
  utils.js                       Shared utilities (JSON parsing, content access, task IDs)
  health.js                      Cached liveness probe (60s TTL)
  search.js                      Semantic search + context block formatting
  memory.js                      Write-path (fire-and-forget + awaitable)
  task-manager.js                Task CRUD with append-only reconciliation
  summarize.js                   Conversation summarization + fact extraction
  retrieval.js                   Smart retrieval (pre-decision, rewriting, filtering)
  reranker.js                    LLM-based relevance filtering of search results
  memory-types.js                Memory type definitions and extraction prompts
  typed-extraction.js            Typed memory extraction logic
```

## How it works

```
User message
  |
  +- before_agent_start
  |    1. Pre-retrieval decision (skip greetings, force on memory refs)
  |    2. Query rewriting (entities, intent, project names)
  |    3. Semantic search via MemOS (over-fetched top_k=12)
  |    4. LLM reranking — keep only relevant memories
  |    5. Sufficiency filtering (dedupe, drop meta, min-length)
  |    6. Inject as <user_memory_context> block
  |
  +- Agent processes message
  |    Tools: memos_create_task, memos_complete_task, memos_list_tasks
  |
  +- agent_end
  |    Extract typed memories -> persist to MemOS (throttled 5 min)
  |
  +- before_compaction (at ~180k tokens)
  |    Segment conversation -> summarize each chunk -> persist
  |
  +- after_compaction
  |    Mark post-compaction state (next turn fetches enriched context)
  |
  +- tool_result_persist
       Save execution traces, extract skills from complex operations
```

## Memory types

Inspired by [memU](https://github.com/NevaMind-AI/memU):

| Type | What it captures | Tags |
|------|------------------|------|
| **Profile** | Stable user facts (age, job, location, preferences) | `user_profile`, `stable_fact` |
| **Behavior** | Recurring patterns, habits, routines | `behavior_pattern`, `habit` |
| **Skill** | Agent skills with documentation | `agent_skill`, `workflow` |
| **Event** | Time-bound events and decisions | `event`, `decision` |
| **Task** | Actionable items from conversation | `task`, `pending` |

## Agent tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `memos_create_task` | `title`, `desc?`, `priority?`, `due_date?`, `start_date?`, `project?`, `items?`, `context?` | Create a task |
| `memos_complete_task` | `task_id`, `outcome?` | Mark task completed |
| `memos_list_tasks` | `status?`, `priority?`, `project?` | List/filter tasks |

Task fields are aligned with [TickTick](https://developer.ticktick.com/) API.

## Troubleshooting

**Plugin not loading** — check logs:
```bash
journalctl --user -u openclaw-gateway.service -n 20 --no-pager | grep MEMOS
```

**No memories injected**
1. Verify MemOS is running: `curl -s http://127.0.0.1:8000/openapi.json | head -1`
2. Check `memosApiUrl` matches your MemOS instance
3. Short prompts ("hi", "ok") are intentionally skipped

**Reranker filtering too aggressively** — set `"reranker": false` in config to compare, or check logs for `Reranker: N/M memories relevant`.

**Compaction flush failing** — the plugin logs `MemOS unhealthy during compaction flush` when the API is unreachable.

## Requirements

- [OpenClaw](https://openclaw.com) >= 2026.1.29
- [MemOS](https://github.com/MemTensor/MemOS) with `/product/search`, `/product/add`, `/product/chat/complete`
- Node.js >= 22

## License

Apache-2.0 — see [LICENSE](./LICENSE)
