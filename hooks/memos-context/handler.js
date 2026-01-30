/**
 * MemOS Context Hook - loads memory context on command:new
 */
import { searchMemories, formatContextBlock } from "../../lib/memos-api.js";

const handler = async (event) => {
  // command:new event - no need to check type, we're already subscribed to this event
  try {
    console.log("[MEMOS] Loading memory context...");

    const memories = await searchMemories(
      "important user context preferences decisions recent",
      5
    );

    if (memories.length > 0) {
      const contextBlock = formatContextBlock(memories);
      if (contextBlock && event.messages) {
        // Add to messages that will be shown to user/injected into bootstrap
        event.messages.push(`\n<user_memory_context>\n${contextBlock}\n</user_memory_context>`);
        console.log(`[MEMOS] Context loaded: ${memories.length} memories`);
      }
    } else {
      console.log("[MEMOS] No memories found");
    }
  } catch (err) {
    console.warn(`[MEMOS] Context load failed: ${err.message}`);
    // Non-fatal, continue without context
  }
};

export default handler;
