/**
 * MemOS Health Check
 *
 * Lightweight liveness probe with result caching to avoid
 * hammering the API on every hook invocation.
 *
 * @module lib/health
 */
import { getMemosApiUrl } from "./client.js";

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;

let _healthy = true;
let _checkedAt = 0;

/**
 * Returns `true` if the MemOS API is reachable.
 * Result is cached for {@link CACHE_TTL_MS} ms.
 */
export async function isHealthy() {
  const now = Date.now();
  if (now - _checkedAt < CACHE_TTL_MS) return _healthy;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${getMemosApiUrl()}/openapi.json`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    _healthy = res.ok;
  } catch {
    _healthy = false;
  }
  _checkedAt = now;
  return _healthy;
}
