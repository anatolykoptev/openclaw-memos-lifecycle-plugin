/**
 * TickTick API Client
 *
 * Direct HTTP client for TickTick REST API.
 * Fetches projects dynamically, resolves MemOS project names to TickTick IDs
 * by name matching (no hardcoded IDs).
 *
 * Token source priority:
 *   1. TICKTICK_ACCESS_TOKEN env var
 *   2. ~/.openclaw/mcp-servers/ticktick-mcp/.env
 *   3. ~/.openclaw/.env
 *
 * @module lib/ticktick
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { LOG_PREFIX } from "./client.js";

// ─── Constants ──────────────────────────────────────────────────────
const TICKTICK_API = "https://api.ticktick.com/open/v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Token Loading ──────────────────────────────────────────────────

/**
 * Read TICKTICK_ACCESS_TOKEN from env or .env files.
 * @returns {string|null}
 */
function loadAccessToken() {
  if (process.env.TICKTICK_ACCESS_TOKEN) return process.env.TICKTICK_ACCESS_TOKEN;
  const envPaths = [
    join(homedir(), ".openclaw", "mcp-servers", "ticktick-mcp", ".env"),
    join(homedir(), ".openclaw", ".env"),
  ];
  for (const p of envPaths) {
    try {
      const content = readFileSync(p, "utf-8");
      const match = content.match(/^TICKTICK_ACCESS_TOKEN=(.+)$/m);
      if (match) return match[1].trim();
    } catch (_) { /* not found */ }
  }
  return null;
}

let _token = null;

/** @returns {string|null} */
function getToken() {
  if (!_token) _token = loadAccessToken();
  return _token;
}

// ─── Project Cache ──────────────────────────────────────────────────
let _projectCache = null;   // { projects: [...], fetchedAt: number }

// ─── HTTP ───────────────────────────────────────────────────────────

/**
 * Call TickTick REST API.
 * @param {string} method - GET | POST | DELETE
 * @param {string} endpoint - e.g. "/project"
 * @param {object} [body]
 * @returns {Promise<any>}
 */
async function ticktickFetch(method, endpoint, body) {
  const token = getToken();
  if (!token) throw new Error("No TICKTICK_ACCESS_TOKEN found");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${TICKTICK_API}${endpoint}`, opts);
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const msg = `TickTick HTTP ${res.status}: ${text.slice(0, 200)}`;
      console.error(LOG_PREFIX, `TickTick API error: ${method} ${endpoint} → ${msg}`);
      throw new Error(msg);
    }
    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error(LOG_PREFIX, `TickTick API timeout: ${method} ${endpoint} (${REQUEST_TIMEOUT_MS}ms)`);
    }
    throw err;
  }
}

// ─── Projects ───────────────────────────────────────────────────────

/**
 * Normalize a project name for matching.
 * Strips leading emoji (with optional space), lowercases.
 * "💼Work" → "work", "🏠Personal" → "personal", "piter.now" → "piter.now"
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, "")
    .trim()
    .toLowerCase();
}

/**
 * Fetch all TickTick projects (cached for 5 min).
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Array<{ id: string, name: string, closed?: boolean }>>}
 */
export async function fetchProjects(forceRefresh = false) {
  if (
    !forceRefresh &&
    _projectCache &&
    Date.now() - _projectCache.fetchedAt < CACHE_TTL_MS
  ) {
    return _projectCache.projects;
  }

  const projects = await ticktickFetch("GET", "/project");
  _projectCache = { projects, fetchedAt: Date.now() };
  const active = projects.filter((p) => !p.closed).length;
  console.log(LOG_PREFIX, `TickTick projects fetched: ${projects.length} total, ${active} active`);
  return projects;
}

/**
 * Resolve a MemOS project name to a TickTick project ID.
 * Matches by normalized name (case-insensitive, emoji-stripped).
 * Returns null if no match found.
 *
 * @param {string} memosProject - e.g. "openclaw", "personal"
 * @returns {Promise<{ id: string, name: string } | null>}
 */
export async function resolveProjectId(memosProject) {
  if (!memosProject) return null;
  const projects = await fetchProjects();
  const needle = normalizeName(memosProject);

  for (const p of projects) {
    if (p.closed) continue;
    if (normalizeName(p.name) === needle) {
      console.log(LOG_PREFIX, `TickTick project resolved: "${memosProject}" → "${p.name}" (${p.id})`);
      return { id: p.id, name: p.name };
    }
  }
  console.log(LOG_PREFIX, `TickTick project not found: "${memosProject}" (needle: "${needle}")`);
  return null;
}

/**
 * Reverse lookup: TickTick project ID → MemOS project name.
 * Returns the normalized (lowercased, emoji-stripped) TickTick name.
 *
 * @param {string} ticktickProjectId
 * @returns {Promise<string|null>}
 */
export async function resolveMemosProject(ticktickProjectId) {
  if (!ticktickProjectId) return null;
  const projects = await fetchProjects();
  const proj = projects.find((p) => p.id === ticktickProjectId);
  return proj ? normalizeName(proj.name) : null;
}

/**
 * Create a new project in TickTick.
 * @param {string} name
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function createTickTickProject(name) {
  const result = await ticktickFetch("POST", "/project", {
    name,
    color: "#4772FA",
    viewMode: "list",
    kind: "TASK",
  });
  // Invalidate cache
  _projectCache = null;
  console.log(LOG_PREFIX, `TickTick project created: "${name}" (${result.id})`);
  return result;
}

/** Default TickTick project used when task has no project or project not found. */
const DEFAULT_PROJECT_NAME = "personal";

/**
 * Resolve MemOS project name to TickTick project.
 * TickTick is the source of truth for projects — no auto-creation.
 * Falls back to default project if not found.
 *
 * @param {string} memosProject
 * @returns {Promise<{ id: string, name: string, fallback: boolean, availableProjects?: string[] } | null>}
 */
export async function resolveOrFallback(memosProject) {
  // Try exact match first
  const existing = await resolveProjectId(memosProject);
  if (existing) return { ...existing, fallback: false };

  // Not found — try default project
  const projects = await fetchProjects();
  const activeNames = projects.filter((p) => !p.closed).map((p) => p.name);

  const fallback = await resolveProjectId(DEFAULT_PROJECT_NAME);
  if (fallback) {
    console.log(LOG_PREFIX,
      `TickTick project "${memosProject}" not found. Using default "${fallback.name}".\n` +
      `  Available projects: ${activeNames.join(", ")}\n` +
      `  ⚠️  To sync to a specific project, create it in TickTick app first, or use one of the existing names above.`
    );
    return { ...fallback, fallback: true, availableProjects: activeNames };
  }

  // Even default not found
  console.error(LOG_PREFIX,
    `TickTick project "${memosProject}" not found and default "${DEFAULT_PROJECT_NAME}" also missing.\n` +
    `  Available projects: ${activeNames.join(", ")}\n` +
    `  Task will be saved to MemOS only (no TickTick sync).`
  );
  return null;
}

/**
 * Get tasks for a specific TickTick project.
 * @param {string} projectId
 * @returns {Promise<Array>}
 */
export async function getProjectTasks(projectId) {
  const data = await ticktickFetch("GET", `/project/${projectId}/data`);
  return data.tasks || [];
}

/**
 * Create a task in TickTick.
 * @param {{ title: string, projectId: string, content?: string, startDate?: string, dueDate?: string, priority?: number }} task
 * @returns {Promise<object>}
 */
export async function createTickTickTask(task) {
  return ticktickFetch("POST", "/task", task);
}

/**
 * Complete a task in TickTick.
 * @param {string} projectId
 * @param {string} taskId
 * @returns {Promise<object>}
 */
export async function completeTickTickTask(projectId, taskId) {
  return ticktickFetch("POST", `/project/${projectId}/task/${taskId}/complete`);
}

/**
 * Normalize a date string/Date to TickTick ISO format.
 * Always produces consistent format: "2026-02-10T00:00:00+0000"
 * Accepts: "2026-02-10", "2026-02-10T09:00:00", full ISO, Date object.
 * Returns null for non-parseable strings like "Friday".
 *
 * @param {string|Date} dateStr
 * @returns {string|null}
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

/**
 * Check if TickTick integration is available (token exists).
 * @returns {boolean}
 */
export function isAvailable() {
  const available = !!getToken();
  if (!available) {
    console.log(LOG_PREFIX, "TickTick integration unavailable: no TICKTICK_ACCESS_TOKEN found");
  }
  return available;
}

/**
 * Map MemOS priority (P0/P1/P2) to TickTick priority (5/3/1).
 * @param {string} memosPriority
 * @returns {number}
 */
export function mapPriorityToTickTick(memosPriority) {
  switch (memosPriority) {
    case "P0": return 5;  // High
    case "P1": return 3;  // Medium
    case "P2": return 1;  // Low
    default: return 0;    // None
  }
}

/**
 * Map TickTick priority (0/1/3/5) to MemOS priority (P0/P1/P2).
 * @param {number} ticktickPriority
 * @returns {string}
 */
export function mapPriorityFromTickTick(ticktickPriority) {
  switch (ticktickPriority) {
    case 5: return "P0";  // High
    case 3: return "P1";  // Medium
    case 1: return "P2";  // Low
    default: return "P2"; // None → P2
  }
}
