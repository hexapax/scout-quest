/**
 * S13: Multi-Turn Quest Journey (Extended)
 *
 * Full mini-journey: session start → check reminders → log chores →
 * review budget → discuss next counselor meeting → wrap up.
 * Tests sustained character consistency and multiple tool calls.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S13",
  name: "Multi-Turn Quest Journey (Extended)",
  description:
    "Extended multi-turn session covering the full scout interaction loop: " +
    "greet → check what's pending → log chores → review budget progress → " +
    "plan next counselor meeting → wrap up. Tests sustained character " +
    "consistency across many turns and multiple tool calls.",
  scoutSimPrompt: "",
  initialMessage: "hey! im ready to check in today",
  maxTurns: 12,
  expectedTools: [
    "log_chore",
    "update_quest_plan",
    "log_session_notes",
  ],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://reminders",
    "scout://quest-plan",
    "scout://last-session",
    "scout://chore-streak",
    "scout://budget-summary",
    "scout://requirements",
  ],
  evaluationWeights: {
    character_consistency: 0.25,
    state_management: 0.25,
    socratic_method: 0.15,
    engagement_quality: 0.15,
    requirement_accuracy: 0.10,
    ypt_compliance: 0.05,
    scope_adherence: 0.05,
  },
};

export default scenario;
