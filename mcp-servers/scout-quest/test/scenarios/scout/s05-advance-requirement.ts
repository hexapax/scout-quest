/**
 * S5: Advance a Requirement
 *
 * Scout says "I finished my budget plan, can we mark it done?" AI calls
 * advance_requirement(req_id='pm_2a', new_status='ready_for_review').
 * Validates state transition.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S5",
  name: "Advance a Requirement",
  description:
    "Scout reports completing a requirement deliverable and asks to advance it. " +
    "AI should call advance_requirement with the correct req_id and new_status. " +
    "Must validate state transition is legal.",
  scoutSimPrompt: "",
  initialMessage: "I finished my budget plan for pm_2a, can we mark it as ready for review?",
  maxTurns: 4,
  expectedTools: ["advance_requirement"],
  expectedResources: [
    "scout://quest-state",
    "scout://requirements",
    "scout://character",
  ],
};

export default scenario;
