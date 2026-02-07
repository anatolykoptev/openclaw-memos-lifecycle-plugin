/**
 * Task Lifecycle Manager
 *
 * CRUD for tasks using MemOS append-only model.
 * State transitions are modeled as new memories referencing task_id.
 * findTasks() reconciles by merging task + update memories.
 *
 * @module lib/task-manager
 */
import { addMemoryAwait } from "./memory.js";
import { searchMemories } from "./search.js";
import { LOG_PREFIX } from "./client.js";

/** Extract info from MemOS result (nested under metadata.info) */
function getInfo(mem) {
  return mem?.metadata?.info || mem?.info || {};
}

// ── Create ──

/**
 * Create a new task.
 * @param {string} name - Task description
 * @param {{ priority?: string, deadline?: string, context?: string }} [opts]
 * @returns {Promise<{ taskId: string, name: string, priority: string, status: string }>}
 */
export async function createTask(name, { priority = "P2", deadline, context } = {}) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const content = `TASK: ${name}`;
  const info = {
    _type: "task",
    task_id: taskId,
    task_status: "pending",
    priority,
    created_at: new Date().toISOString(),
  };
  if (deadline) info.deadline = deadline;
  if (context) info.context = context;

  await addMemoryAwait(content, ["task", "pending"], info);
  console.log(LOG_PREFIX, `Task created: ${taskId} "${name}" [${priority}]`);
  return { taskId, name, priority, status: "pending" };
}

// ── Find (with append-only reconciliation) ──

/**
 * Find tasks, reconciling creation + update memories.
 * @param {{ status?: string, priority?: string }} [opts]
 * @returns {Promise<Array<{ taskId: string, name: string, status: string, priority: string, deadline?: string, createdAt?: string, completedAt?: string }>>}
 */
export async function findTasks({ status, priority } = {}) {
  const [tasks, updates] = await Promise.all([
    searchMemories("task", 30, { filter: { _type: "task" } }).catch(() => []),
    searchMemories("TASK_COMPLETED task done", 30, { filter: { _type: "task_update" } }).catch(() => []),
  ]);

  // Build update index: task_id → latest status
  const updateMap = new Map();
  for (const u of updates) {
    const info = getInfo(u);
    if (info.task_id) {
      const existing = updateMap.get(info.task_id);
      if (!existing || (info.completed_at > existing.completed_at)) {
        updateMap.set(info.task_id, info);
      }
    }
  }

  // Reconcile: apply latest update to each task
  const reconciled = [];
  const seen = new Set();
  for (const t of tasks) {
    const info = getInfo(t);
    const taskId = info.task_id;
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);

    const update = updateMap.get(taskId);
    const currentStatus = update?.task_status || info.task_status || "pending";

    if (status && currentStatus !== status) continue;
    if (priority && info.priority !== priority) continue;

    reconciled.push({
      taskId,
      name: (t.memory || t.content || "").replace(/^TASK:\s*/, ""),
      status: currentStatus,
      priority: info.priority || "P2",
      deadline: info.deadline,
      createdAt: info.created_at,
      completedAt: update?.completed_at,
    });
  }

  return reconciled;
}

// ── Complete ──

/**
 * Mark a task as completed.
 * @param {string} taskId
 * @param {string} [outcome]
 */
export async function completeTask(taskId, outcome = "") {
  const content = `TASK_COMPLETED: ${taskId}${outcome ? " — " + outcome : ""}`;
  const info = {
    _type: "task_update",
    task_id: taskId,
    task_status: "done",
    completed_at: new Date().toISOString(),
  };
  if (outcome) info.outcome = outcome;

  await addMemoryAwait(content, ["task", "done"], info);
  console.log(LOG_PREFIX, `Task completed: ${taskId}`);
}

// ── Format ──

/**
 * Format a task list for context injection.
 * @param {Array} tasks
 * @returns {string}
 */
export function formatTaskList(tasks) {
  if (!tasks?.length) return "";
  const lines = ["\u{1F4CB} Tasks:"];
  for (const t of tasks.slice(0, 8)) {
    const emoji = t.priority === "P0" ? "\u{1F534}" : t.priority === "P1" ? "\u{1F7E0}" : "\u{1F7E1}";
    lines.push(`${emoji} ${t.name} [${t.priority}]${t.deadline ? " \u23F0 " + t.deadline : ""}`);
  }
  if (tasks.length > 8) lines.push(`  ... and ${tasks.length - 8} more`);
  return lines.join("\n");
}
