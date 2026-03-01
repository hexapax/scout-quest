/**
 * S1: Session Start — Resource Loading
 *
 * Tests that the model reads scout://quest-state, scout://character,
 * scout://reminders on the first turn and adopts the configured character.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S1",
  name: "Session Start — Resource Loading",
  description:
    "Scout opens a new session. The AI should read quest-state, character, " +
    "and reminders resources on the first turn, then greet the scout in character.",
  scoutSimPrompt: "", // filled by runner with persona
  initialMessage: "hey whats up",
  maxTurns: 2,
  expectedTools: [],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://reminders",
    "scout://quest-plan",
    "scout://last-session",
  ],
  evaluationWeights: {
    requirement_accuracy: 0.05,
    socratic_method: 0.05,
    character_consistency: 0.30,
    ypt_compliance: 0.05,
    scope_adherence: 0.10,
    engagement_quality: 0.20,
    state_management: 0.25,
  },
};

export default scenario;
