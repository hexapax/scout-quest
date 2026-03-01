/**
 * S4: Ask About Merit Badge Requirements
 *
 * Scout asks "what do I need for Personal Management?" AI reads
 * scout://requirements, explains next steps without doing them.
 * No tool hallucination.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S4",
  name: "Ask About Merit Badge Requirements",
  description:
    "Scout asks about their Personal Management requirements. AI should read " +
    "the requirements resource and explain what's needed next. Must NOT " +
    "hallucinate any tool calls — this is an information-only request.",
  scoutSimPrompt: "",
  initialMessage: "what do I need to do for Personal Management?",
  maxTurns: 3,
  expectedTools: [],
  expectedResources: [
    "scout://quest-state",
    "scout://requirements",
    "scout://character",
  ],
  evaluationWeights: {
    requirement_accuracy: 0.30,
    socratic_method: 0.15,
    character_consistency: 0.15,
    state_management: 0.15,
    engagement_quality: 0.10,
    ypt_compliance: 0.05,
    scope_adherence: 0.10,
  },
};

export default scenario;
