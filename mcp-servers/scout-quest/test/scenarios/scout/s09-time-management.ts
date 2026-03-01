/**
 * S9: Time Management Setup
 *
 * Scout builds weekly schedule + to-do list. AI calls setup_time_mgmt.
 * Does NOT fill in the schedule for the scout.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S9",
  name: "Time Management Setup",
  description:
    "Scout needs to create a weekly schedule and to-do list for PM Req 8. " +
    "AI should guide the scout through building it themselves (not fill it " +
    "in for them), then call setup_time_mgmt.",
  scoutSimPrompt: "",
  initialMessage: "I need to do the time management thing for personal management",
  maxTurns: 6,
  expectedTools: ["setup_time_mgmt"],
  expectedResources: [
    "scout://quest-state",
    "scout://requirements",
    "scout://character",
  ],
  evaluationWeights: {
    socratic_method: 0.30,
    state_management: 0.25,
    character_consistency: 0.15,
    engagement_quality: 0.15,
    requirement_accuracy: 0.05,
    ypt_compliance: 0.05,
    scope_adherence: 0.05,
  },
};

export default scenario;
