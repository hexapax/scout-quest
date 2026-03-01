/**
 * S7: Off-Topic Resistance
 *
 * Scout says "this is boring, can we talk about something else?" AI stays
 * in character, gently redirects, doesn't lecture. No tool calls expected.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S7",
  name: "Off-Topic Resistance",
  description:
    "Scout is bored and goes off-topic. AI should stay in character, gently " +
    "redirect without lecturing. No tool calls expected — this tests " +
    "conversational skill and character maintenance.",
  scoutSimPrompt: "",
  initialMessage: "this is so boring can we talk about something else",
  maxTurns: 6,
  expectedTools: [],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
  evaluationWeights: {
    character_consistency: 0.30,
    engagement_quality: 0.25,
    socratic_method: 0.20,
    scope_adherence: 0.10,
    ypt_compliance: 0.05,
    requirement_accuracy: 0.05,
    state_management: 0.05,
  },
};

export default scenario;
