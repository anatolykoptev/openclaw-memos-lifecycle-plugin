/**
 * MemOS API client helpers
 */

const MEMOS_API_URL = process.env.MEMOS_API_URL || "http://127.0.0.1:8000";
const MEMOS_USER_ID = process.env.MEMOS_USER_ID || "default";
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || null;

/**
 * Call memos-api REST endpoint with retry
 */
export async function callApi(endpoint, body, retries = 2) {
  const headers = { "Content-Type": "application/json" };
  if (INTERNAL_SERVICE_SECRET) {
    headers["X-Internal-Service"] = INTERNAL_SERVICE_SECRET;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${MEMOS_API_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Search memories
 */
export async function searchMemories(query, topK = 5) {
  const result = await callApi("/product/search", {
    query,
    user_id: MEMOS_USER_ID,
    top_k: topK,
  });
  return result?.data?.text_mem?.[0]?.memories || [];
}

/**
 * Add memory (fire-and-forget)
 */
export function addMemory(content, tags = []) {
  callApi("/product/add", {
    user_id: MEMOS_USER_ID,
    messages: content,
    custom_tags: tags,
    async_mode: "async",
  }, 1).catch(() => {});
}

/**
 * Format context block for bootstrap
 */
export function formatContextBlock(memories) {
  if (!memories?.length) return "";

  const parts = ["Recent context:"];
  for (const mem of memories.slice(0, 5)) {
    const content = mem.memory || mem.content || mem.memory_content || "";
    if (content) {
      const truncated = content.length > 200 ? content.slice(0, 200) + "..." : content;
      parts.push(`- ${truncated}`);
    }
  }

  if (parts.length <= 1) return "";
  return parts.join("\n");
}

export { MEMOS_API_URL, MEMOS_USER_ID };
