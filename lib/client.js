/**
 * MemOS HTTP Client
 *
 * Low-level HTTP transport for the MemOS REST API.
 * Handles authentication, retries with exponential back-off, and timeouts.
 *
 * Configuration priority (highest → lowest):
 *   1. openclaw.plugin.json configSchema values (via applyConfig)
 *   2. Environment variables
 *   3. ~/.openclaw/.env file
 *   4. Defaults
 *
 * @module lib/client
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Constants ──────────────────────────────────────────────────────
export const LOG_PREFIX = "[MEMOS]";

/** @enum {number} Named timeouts (ms) */
export const Timeouts = Object.freeze({
  DEFAULT: 8_000,
  SEARCH: 5_000,
  ADD: 10_000,    // increased from 4s for typed extraction (multiple memories)
  SUMMARIZE: 45_000, // increased for typed extraction with multiple LLM calls
});

// ─── Configuration ──────────────────────────────────────────────────

/**
 * Read a single key from ~/.openclaw/.env (fallback when process.env is empty).
 * @param {string} name
 * @returns {string|null}
 */
function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  try {
    const envPath = join(homedir(), ".openclaw", ".env");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
    if (match) return match[1].trim();
  } catch (_) { /* not found */ }
  return null;
}

/** Mutable config — overridden by {@link applyConfig} at registration time. */
const _config = {
  memosApiUrl: process.env.MEMOS_API_URL || "http://127.0.0.1:8000",
  memosUserId: process.env.MEMOS_USER_ID || "default",
  memosCubeId: process.env.MEMOS_CUBE_ID || "default",
  internalSecret: loadEnvVar("INTERNAL_SERVICE_SECRET"),
};

/** @returns {string} */
export function getMemosApiUrl() { return _config.memosApiUrl; }
/** @returns {string} */
export function getMemosUserId() { return _config.memosUserId; }
/** @returns {string} */
export function getMemosCubeId() { return _config.memosCubeId; }

// Back-compat exports (read-only snapshots refreshed by applyConfig)
export let MEMOS_API_URL = _config.memosApiUrl;
export let MEMOS_USER_ID = _config.memosUserId;
export let MEMOS_CUBE_ID = _config.memosCubeId;

/**
 * Apply plugin configuration from openclaw.plugin.json.
 * Called once during {@link register()}.
 * @param {object} cfg - pluginConfig from OpenClaw API
 */
export function applyConfig(cfg = {}) {
  if (cfg.memosApiUrl) _config.memosApiUrl = cfg.memosApiUrl;
  if (cfg.memosUserId) _config.memosUserId = cfg.memosUserId;
  if (cfg.memosCubeId) _config.memosCubeId = cfg.memosCubeId;
  if (cfg.internalServiceSecret) _config.internalSecret = cfg.internalServiceSecret;
  // Refresh back-compat exports
  MEMOS_API_URL = _config.memosApiUrl;
  MEMOS_USER_ID = _config.memosUserId;
  MEMOS_CUBE_ID = _config.memosCubeId;
}

// ─── HTTP ───────────────────────────────────────────────────────────

/**
 * Call a MemOS REST endpoint with retries and exponential back-off.
 *
 * @param {string} endpoint - API path (e.g. "/product/search")
 * @param {object} body     - JSON payload
 * @param {{ retries?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} After all retries are exhausted
 */
export async function callApi(endpoint, body, opts = {}) {
  const { retries = 2, timeoutMs = Timeouts.DEFAULT } = opts;
  const headers = { "Content-Type": "application/json" };
  if (_config.internalSecret) {
    headers["X-Internal-Service"] = _config.internalSecret;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${_config.memosApiUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
