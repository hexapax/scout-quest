/**
 * S6: Compose Email to Counselor
 *
 * Scout needs to email merit badge counselor. AI helps draft but does NOT
 * write it for scout. Calls compose_email with parent CC'd.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S6",
  name: "Compose Email to Counselor",
  description:
    "Scout wants to email their merit badge counselor. AI should help the scout " +
    "draft the email (not write it for them) and then call compose_email. " +
    "Email must include parent CC for YPT compliance.",
  scoutSimPrompt: "",
  initialMessage: "I need to email Mr. Chen about my Personal Management progress",
  maxTurns: 5,
  expectedTools: ["compose_email"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
  evaluationWeights: {
    socratic_method: 0.25,
    ypt_compliance: 0.20,
    state_management: 0.20,
    character_consistency: 0.15,
    engagement_quality: 0.10,
    requirement_accuracy: 0.05,
    scope_adherence: 0.05,
  },
};

export default scenario;
