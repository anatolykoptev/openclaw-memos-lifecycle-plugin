# CLAUDE.md

Notes for coding agents. Overview, configuration and the hook flow: [README.md](README.md); all
documents: [docs/INDEX.md](docs/INDEX.md).

## Layout

- `index.js` thin orchestrator: reads `api.pluginConfig`, applies it, registers hooks and the four
  agent tools (`memos_create_task`, `memos_complete_task`, `memos_list_tasks`, `memos_stats`).
- `hooks/` one file per OpenClaw event: `context-injection` (`before_agent_start`), `fact-extraction`
  (`agent_end`), `compaction-flush` (`before_compaction`, `after_compaction`), `tool-trace`
  (`tool_result_persist`).
- `lib/` the MemOS client (`client.js`: transport, config, dedup cache), search, retrieval, reranker,
  summarising, typed extraction, task manager, TickTick sync, health probe, stats.
- `openclaw.plugin.json` manifest and config schema; `package.json` ESM package, Node >= 22, no
  dependencies.

## Gate

There is no CI, no test suite and no build. Before a commit:

```sh
for f in index.js lib/*.js hooks/*.js; do node --check "$f" || exit 1; done
node -e "import('./index.js').then(m => console.log(m.default.id))"
```

## Invariants easy to break

- Every hook is non-fatal: a MemOS outage must never throw into the host agent. Wrap new hook code
  accordingly and fail open.
- Config defaults live in two places that disagree: `lib/client.js` (what runs: user and cube id
  `memos`) and the manifest / schema in `index.js` (`default`). The reranker is enabled only by
  `reranker: true` (`state.rerankerEnabled = config.reranker === true`), although the manifest says true.
  Change code and documentation together.
- The version appears in `package.json` (3.5.1), `openclaw.plugin.json` (3.4.1) and a log line in
  `index.js` (v3.4); keep them equal when releasing.
- `internalServiceSecret` is a secret: read it from config or `INTERNAL_SERVICE_SECRET`, never log
  it, never commit it.
- Skill extraction was removed in 3.5.1 on purpose (MemOS Skill Memory owns it); do not reintroduce it
  in the plugin.
- Task writes are append-only with reconciliation on read; a new task field must be handled in
  `lib/task-manager.js` reconciliation, not only at creation.
