# openclaw-memos-lifecycle-plugin

Memory bridge between [OpenClaw](https://openclaw.com) and [MemOS](https://github.com/MemTensor/MemOS). Your agent never loses important context — memories persist across conversation compactions and sessions.

## Why?

MemOS stores and retrieves memories. OpenClaw runs agents. But MemOS doesn't know **when** to save or **what** to retrieve. This plugin bridges that gap:

- **When to save** — after every conversation (`agent_end`), before compaction (`before_compaction`), after tool calls (`tool_result_persist`)
- **When to retrieve** — before every agent turn (`before_agent_start`), with smart filtering to skip casual messages
- **What to extract** — structured facts, compaction summaries, tool execution traces

## Features

- **Smart context injection** — pre-retrieval decision skips greetings/casual prompts, query rewriting enriches search with entities and intent, sufficiency filtering removes duplicates
- **Compaction flush** — long conversations segmented into topic-coherent chunks, each summarized separately for higher quality memory extraction
- **Post-compaction recovery** — enriched context automatically restored after compaction (summaries + relevant memories)
- **Fact extraction** — durable facts extracted from conversations (throttled, skipped post-compaction)
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
    "toolTraces": true                         // toggle tool_result_persist
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
index.js                     ← Thin orchestrator (config + hook registration)
├── hooks/
│   ├── context-injection.js    before_agent_start  → smart retrieval pipeline
│   ├── fact-extraction.js      agent_end           → extract durable facts
│   ├── compaction-flush.js     before/after_compaction → segment + summarize + persist
│   └── tool-trace.js           tool_result_persist → save execution traces
└── lib/
    ├── client.js               HTTP transport, auth, retries, config
    ├── health.js               Cached liveness probe (60s TTL)
    ├── search.js               Semantic search + context block formatting
    ├── memory.js               Write-path (fire-and-forget + awaitable)
    ├── summarize.js            Conversation summarization + fact extraction
    └── retrieval.js            Smart retrieval (pre-decision, rewriting, filtering, segmentation)
```

## Hook Pipeline

```
User message arrives
  │
  ├─ before_agent_start
  │    1. Pre-retrieval decision (skip greetings, force on memory references)
  │    2. Query rewriting (extract entities, intent, project names)
  │    3. Semantic search via MemOS
  │    4. Sufficiency filtering (dedupe, drop meta, min-length)
  │    5. Format and inject as <user_memory_context> block
  │
  ├─ Agent processes message (tokens accumulate)
  │
  ├─ agent_end
  │    Extract durable facts → persist to MemOS (throttled 5 min)
  │
  ├─ [Context grows to ~180k tokens → compaction triggered]
  │
  ├─ before_compaction
  │    1. Segment conversation into 4-12 message topic chunks
  │    2. Summarize each segment → structured entries with tags
  │    3. Persist all entries + compaction_event meta to MemOS
  │
  ├─ after_compaction
  │    Mark post-compaction timestamp
  │
  └─ Next before_agent_start → enriched mode
       (compaction_summary memories + relevant context)
```

## Hooks Reference

| Hook | Event | Type | Purpose |
|---|---|---|---|
| Context Injection | `before_agent_start` | modifying | Smart retrieval → inject relevant memories |
| Fact Extraction | `agent_end` | void | Extract durable facts (throttled, skipped post-compaction) |
| Compaction Flush | `before_compaction` | void | Segment → summarize → persist structured entries |
| Compaction Mark | `after_compaction` | void | Set enriched context mode for next turn |
| Tool Trace | `tool_result_persist` | void | Save tool results (skips memory-related tools) |

## MemOS Tags

| Tag | Purpose |
|---|---|
| `compaction_summary` | Structured entries from compaction flush |
| `compaction_event` | Compaction statistics (message count, tokens, entries saved) |
| `auto_capture` | Facts extracted from normal conversations |
| `fact` | Durable facts (preferences, decisions, technical details) |
| `tool_trace` | Tool execution results |

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

- **OpenClaw** ≥ 2026.1.29
- **MemOS** with `/product/search`, `/product/add`, `/product/chat/complete` endpoints
- **Node.js** ≥ 22

## License

MIT — see [LICENSE](./LICENSE)
