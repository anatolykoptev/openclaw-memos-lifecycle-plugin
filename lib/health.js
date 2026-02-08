/**
 * MemOS Health Check
 *
 * Lightweight liveness probe with result caching to avoid
 * hammering the API on every hook invocation.
 *
 * @module lib/health
 */
import { getMemosApiUrl } from "./client.js";

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;
const MAX_RETRIES = 1;

let _healthy = true;
let _checkedAt = 0;

/** Single probe attempt. */
async function _probe() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${getMemosApiUrl()}/openapi.json`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/**
 * Returns `true` if the MemOS API is reachable.
 * Result is cached for {@link CACHE_TTL_MS} ms. Retries once on failure.
 */
export async function isHealthy() {
  const now = Date.now();
  if (now - _checkedAt < CACHE_TTL_MS) return _healthy;

  _healthy = await _probe();
  if (!_healthy && MAX_RETRIES > 0) {
    await new Promise((r) => setTimeout(r, 500));
    _healthy = await _probe();
  }
  _checkedAt = now;
  return _healthy;
}
