/**
 * Operation Statistics
 *
 * Lightweight in-memory counters and timings for plugin operations.
 * No persistence, no external deps. Reset on process restart.
 *
 * @module lib/stats
 */

export const stats = {
  startedAt: Date.now(),
  search:     { count: 0, totalMs: 0, errors: 0 },
  rerank:     { count: 0, totalMs: 0, errors: 0, kept: 0, total: 0 },
  injection:  { count: 0, skip: 0, retrieve: 0, force: 0, memoriesInjected: 0, postCompaction: 0 },
  extraction: { count: 0, throttled: 0, byType: {}, dedupSkips: 0, memoriesSaved: 0 },
  compaction: { count: 0, totalMs: 0, entriesSaved: 0, entriesSkipped: 0, entriesFailed: 0 },
  toolTrace:  { count: 0, skillsExtracted: 0 },
  ticktick:   { taskCreated: 0, taskCompleted: 0, projectsResolved: 0, projectsCreated: 0, errors: 0 },
};

/**
 * Increment a counter by path. Supports nested paths like "rerank.errors".
 * Creates intermediate keys if needed (for dynamic keys like extraction.byType.profile).
 *
 * @param {string} path - Dot-separated path, e.g. "rerank.errors"
 * @param {number} [n=1] - Amount to add
 */
export function inc(path, n = 1) {
  const parts = path.split(".");
  let obj = stats;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  const key = parts[parts.length - 1];
  obj[key] = (obj[key] || 0) + n;
}

/**
 * Record a timing measurement. Increments count and adds to totalMs.
 *
 * @param {string} path - Top-level stats key, e.g. "search" or "compaction"
 * @param {number} ms - Duration in milliseconds
 */
export function timing(path, ms) {
  const bucket = stats[path];
  if (bucket) {
    bucket.count++;
    bucket.totalMs += ms;
  }
}

/**
 * Return a deep copy of the current stats.
 * @returns {object}
 */
export function getStats() {
  return structuredClone(stats);
}

/**
 * Reset all counters to zero. Preserves structure.
 */
export function resetStats() {
  stats.startedAt = Date.now();
  stats.search     = { count: 0, totalMs: 0, errors: 0 };
  stats.rerank     = { count: 0, totalMs: 0, errors: 0, kept: 0, total: 0 };
  stats.injection  = { count: 0, skip: 0, retrieve: 0, force: 0, memoriesInjected: 0, postCompaction: 0 };
  stats.extraction = { count: 0, throttled: 0, byType: {}, dedupSkips: 0, memoriesSaved: 0 };
  stats.compaction = { count: 0, totalMs: 0, entriesSaved: 0, entriesSkipped: 0, entriesFailed: 0 };
  stats.toolTrace  = { count: 0, skillsExtracted: 0 };
  stats.ticktick   = { taskCreated: 0, taskCompleted: 0, projectsResolved: 0, projectsCreated: 0, errors: 0 };
}

/**
 * Format stats as a human-readable multiline string.
 * @returns {string}
 */
export function formatStats() {
  const uptimeMs = Date.now() - stats.startedAt;
  const uptime = formatDuration(uptimeMs);

  const s = stats.search;
  const r = stats.rerank;
  const inj = stats.injection;
  const ext = stats.extraction;
  const c = stats.compaction;
  const tt = stats.toolTrace;

  const avg = (total, count) => count > 0 ? (total / count) : 0;
  const fmtAvg = (total, count) => {
    const a = avg(total, count);
    return a >= 1000 ? `${(a / 1000).toFixed(1)}s` : `${Math.round(a)}ms`;
  };

  const lines = [`Plugin uptime: ${uptime}`];

  lines.push(`Search: ${s.count} calls, avg ${fmtAvg(s.totalMs, s.count)}, ${s.errors} errors`);

  const rerankPct = r.total > 0 ? `${Math.round(r.kept / r.total * 100)}%` : "0%";
  lines.push(`Rerank: ${r.count} calls, avg ${fmtAvg(r.totalMs, r.count)}, ${r.errors} errors, kept ${r.kept}/${r.total} (${rerankPct})`);

  lines.push(`Injection: ${inj.count} total (${inj.retrieve} retrieve, ${inj.skip} skip, ${inj.force} force), ${inj.postCompaction} post-compaction, ${inj.memoriesInjected} memories`);

  const byTypeStr = Object.entries(ext.byType).map(([k, v]) => `${k}:${v}`).join(", ") || "none";
  lines.push(`Extraction: ${ext.count} runs (${ext.throttled} throttled), ${ext.memoriesSaved} saved, ${ext.dedupSkips} dedup skips [${byTypeStr}]`);

  lines.push(`Compaction: ${c.count} runs, avg ${fmtAvg(c.totalMs, c.count)}, ${c.entriesSaved} saved / ${c.entriesSkipped} skipped / ${c.entriesFailed} failed`);

  lines.push(`Tool traces: ${tt.count} captured, ${tt.skillsExtracted} skills extracted`);

  const tick = stats.ticktick;
  if (tick.taskCreated || tick.errors) {
    lines.push(`TickTick: ${tick.taskCreated} created, ${tick.taskCompleted} completed, ${tick.projectsResolved} resolved, ${tick.projectsCreated} new projects, ${tick.errors} errors`);
  }

  return lines.join("\n");
}

/**
 * @param {number} ms
 * @returns {string} e.g. "2h 34m" or "5m" or "45s"
 */
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}
