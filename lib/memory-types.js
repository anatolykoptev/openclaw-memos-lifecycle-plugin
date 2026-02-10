/**
 * Memory Types Module
 *
 * Inspired by memU's typed memory extraction.
 * Separates memories into distinct types for better organization and retrieval.
 *
 * Types:
 * - profile: Stable user facts (age, work, location, preferences)
 * - behavior: Recurring patterns, habits, routines
 * - event: Time-bound events and decisions
 *
 * @module lib/memory-types
 */

export const MemoryTypes = {
  PROFILE: "profile",
  BEHAVIOR: "behavior",
  EVENT: "event",
  FACT: "fact", // legacy fallback
  TASK: "task", // user tasks and intentions
};

/**
 * Prompts for typed memory extraction
 */
export const TypedExtractionPrompts = {
  /**
   * Extract user profile facts
   */
  profile: `You are a User Profile Extractor. Extract ONLY stable facts about the user.

EXTRACT:
- Basic info: age, occupation, location, timezone
- Preferences: language, communication style, tools
- Stable traits: expertise areas, roles, responsibilities

DO NOT EXTRACT:
- Temporary states or moods
- One-time events
- Assistant suggestions or opinions
- Anything not directly stated by user

RULES:
- Use "The user" to refer to the user
- Each fact must be self-contained and understandable alone
- Keep each fact under 30 words
- Return JSON array of strings. Empty array [] if nothing.

Max 3 facts.

Conversation:
{conversation}`,

  /**
   * Extract behavior patterns
   */
  behavior: `You are a Behavior Pattern Extractor. Extract ONLY recurring patterns and habits.

EXTRACT:
- Regular routines: daily habits, workflows
- Problem-solving approaches: how user typically handles issues
- Tool usage patterns: preferred tools and methods
- Communication patterns: when/how user prefers to work

DO NOT EXTRACT:
- One-time actions
- User profile facts (age, job)
- Specific events with dates
- Assistant suggestions

RULES:
- Focus on "typically", "usually", "always" behaviors
- Each pattern must be actionable and reusable
- Keep each under 50 words
- Return JSON array of strings. Empty array [] if nothing.

Max 3 patterns.

Conversation:
{conversation}`,

  /**
   * Extract events
   */
  event: `You are an Event Extractor. Extract significant events and decisions.

EXTRACT:
- Decisions made with reasoning ("Switched from X to Y because...")
- Completed milestones ("Deployed service X to production")
- Configuration changes ("Configured Z for production")
- Architecture decisions ("Made decision to use X for Y")
- Problems resolved with outcome ("Fixed bug in X by doing Y")

INCLUDE for each event:
- WHAT happened
- WHEN (relative date/time if mentioned)
- WHY (reasoning if available)
- OUTCOME

DO NOT EXTRACT:
- Routine actions without significance
- Ongoing tasks without resolution
- User profile facts

RULES:
- Each event must have a clear outcome
- Include context for future reference
- Keep under 100 words each
- Return JSON array of strings. Empty array [] if nothing.

Max 2 events.

Conversation:
{conversation}`,

  /**
   * Extract general facts (restricted — only for high-value long-term facts)
   */
  fact: `You are a Fact Extractor. Extract ONLY facts the user would want to recall months from now.

EXTRACT:
- Important decisions with lasting impact
- Architecture choices and their reasoning
- Project-level facts (tech stack, deployment setup)

DO NOT EXTRACT:
- Routine code discussion details ("fixed a bug", "added a function")
- Temporary states or work-in-progress
- Assistant suggestions or responses
- Implementation details without lasting significance
- Anything that sounds like a session log entry

IMPORTANT: Only extract facts the user would want to recall months from now. Do NOT extract routine code discussion details. When in doubt, return [].

RULES:
- Each fact must be self-contained
- Keep each under 50 words
- Return JSON array of strings. Empty array [] if nothing.

Max 2 facts.

Conversation:
{conversation}`,

  /**
   * Extract tasks and intentions (smart task ingestion)
   * Returns structured objects aligned with TickTick API fields.
   */
  task: `You are a Task Extractor. Identify tasks or intentions the user mentioned.

EXTRACT when user says:
- "нужно сделать...", "надо...", "хочу сделать..."
- "need to...", "should...", "want to...", "plan to..."
- Explicit todo items or action items
- Clear intentions to do something

Return JSON array of objects with these fields:
{
  "title": "Task name (short, actionable)",
  "desc": "Details if any (optional, omit if none)",
  "priority": "P0 | P1 | P2",
  "due_date": "YYYY-MM-DD or text like 'Friday' (optional, omit if none)",
  "project": "Project name if mentioned (optional, omit if none)"
}

Priority guide:
- P0: Urgent, blocking, deadline today
- P1: Important, should do this week
- P2: Nice to have, no deadline

DO NOT EXTRACT:
- Tasks already completed
- Vague wishes without clear action
- Assistant suggestions (unless user confirms)

RULES:
- Each task must be actionable
- Return JSON array of objects. Empty array [] if nothing.

Max 2 tasks.

Conversation:
{conversation}`,
};

/**
 * Get tags for a memory type
 * @param {string} type - Memory type
 * @param {string[]} [additionalTags] - Extra tags to include
 * @returns {string[]}
 */
export function getTagsForType(type, additionalTags = []) {
  const baseTags = {
    [MemoryTypes.PROFILE]: ["user_profile", "stable_fact"],
    [MemoryTypes.BEHAVIOR]: ["behavior_pattern", "habit"],
    [MemoryTypes.EVENT]: ["event", "decision"],
    [MemoryTypes.FACT]: ["fact", "auto_capture"],
    [MemoryTypes.TASK]: ["task", "pending"],
  };

  return [...(baseTags[type] || baseTags[MemoryTypes.FACT]), ...additionalTags];
}

/**
 * Determine which memory types are relevant for a conversation
 * @param {string} conversationText
 * @returns {string[]} Array of relevant memory types to extract
 */
export function detectRelevantTypes(conversationText) {
  const types = [];
  const lower = conversationText.toLowerCase();

  // Profile — stable user facts and tech identity
  if (
    /\b(i am|i'm|i work|my name|i live|i prefer|i use|my stack|my setup|я работаю|мне|живу|зовут|использую|мой стек)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.PROFILE);
  }

  // Behavior patterns
  if (
    /\b(usually|always|typically|every day|routine|habit|обычно|всегда|каждый|привычка)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.BEHAVIOR);
  }

  // Events — decisions, milestones, and dev/ops actions
  if (
    /\b(decided|decision|milestone|released|launched|resolved|deployed|fixed|merged|configured|migrated|refactored|upgraded|switched to|moved to|решил|решение|релиз|запустил|задеплоил|пофиксил|смержил|настроил|мигрировал|перешёл на)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.EVENT);
  }

  // Tasks — user intentions and todo items
  // Strict: requires action verbs or explicit todo markers
  if (
    /\b(нужно сделать|надо сделать|хочу сделать|plan to|need to do|should do|want to do|добавь задачу|создай задачу)\b/i.test(lower) ||
    /\buser:\s*.*\b(нужно|надо|todo|сделай)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.TASK);
  }

  // No fallback to fact — routine code conversations without explicit signals
  // are not worth extracting. This prevents generic "The user discussed..." entries.
  return types;
}
