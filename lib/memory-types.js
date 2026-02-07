/**
 * Memory Types Module
 *
 * Inspired by memU's typed memory extraction.
 * Separates memories into distinct types for better organization and retrieval.
 *
 * Types:
 * - profile: Stable user facts (age, work, location, preferences)
 * - behavior: Recurring patterns, habits, routines
 * - skill: Agent skills with documentation (how to do things)
 * - event: Time-bound events and decisions
 *
 * @module lib/memory-types
 */

export const MemoryTypes = {
  PROFILE: "profile",
  BEHAVIOR: "behavior",
  SKILL: "skill",
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
   * Extract skills learned by the agent
   */
  skill: `You are a Skill Documentation Extractor. Extract skills the agent demonstrated successfully.

EXTRACT skills when:
- A complex task was completed successfully
- A multi-step workflow was executed
- A problem was solved with reusable approach
- Tools were orchestrated effectively

SKILL FORMAT (markdown):
---
name: skill-name-kebab-case
description: One-line what this skill does
demonstrated-in: [context]
---

## When to Use
- Situation 1
- Situation 2

## Steps
1. Step one
2. Step two
3. Step three

## Key Takeaways
- Insight 1
- Insight 2

DO NOT EXTRACT:
- Simple actions (reading files, sending messages)
- Failed attempts
- Incomplete tasks

Return JSON array with objects: {"type": "skill", "content": "<full markdown skill>"}
Empty array [] if no notable skills.

Max 1 skill per conversation.

Conversation:
{conversation}`,

  /**
   * Extract events
   */
  event: `You are an Event Extractor. Extract significant events and decisions.

EXTRACT:
- Decisions made with reasoning
- Completed milestones
- Configuration changes
- Deployments or releases
- Problems resolved

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
   * Extract general facts (fallback)
   */
  fact: `You are a Fact Extractor. Extract important facts worth remembering long-term.

EXTRACT:
- User preferences and habits
- Important decisions made
- Technical details about projects
- Key information explicitly stated

DO NOT EXTRACT:
- Greetings, acknowledgments
- Temporary states
- Assistant's own responses
- System messages

RULES:
- Each fact must be self-contained
- Keep each under 50 words
- Return JSON array of strings. Empty array [] if nothing.

Max 3 facts.

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
    [MemoryTypes.SKILL]: ["agent_skill", "workflow"],
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

  // Always try profile for new info about user
  if (
    /\b(i am|i'm|i work|my name|i live|i prefer|я работаю|мне|живу|зовут)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.PROFILE);
  }

  // Behavior patterns
  if (
    /\b(usually|always|typically|every day|routine|habit|обычно|всегда|каждый|привычка)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.BEHAVIOR);
  }

  // Skills - when complex tasks completed
  if (
    /\b(done|completed|finished|deployed|fixed|solved|готово|сделано|задеплоил|исправил)\b/i.test(lower) &&
    conversationText.length > 1000
  ) {
    types.push(MemoryTypes.SKILL);
  }

  // Events - decisions and milestones
  if (
    /\b(decided|decision|milestone|released|launched|resolved|решил|решение|релиз|запустил)\b/i.test(lower)
  ) {
    types.push(MemoryTypes.EVENT);
  }

  // Tasks - user intentions and todo items
  // More strict: requires action verbs or explicit todo markers
  // Avoid triggering on discussions ABOUT tasks (e.g., "tasks in database")
  if (
    /\b(нужно сделать|надо сделать|хочу сделать|plan to|need to do|should do|want to do|добавь задачу|создай задачу)\b/i.test(lower) ||
    /\buser:\s*.*\b(нужно|надо|todo|сделай)\b/i.test(lower)  // Only in user messages
  ) {
    types.push(MemoryTypes.TASK);
  }

  // Default to fact extraction if nothing specific detected
  if (types.length === 0) {
    types.push(MemoryTypes.FACT);
  }

  return types;
}
