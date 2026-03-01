/**
 * S8: Quest Goal Update
 *
 * Scout wants to change savings goal. AI calls update_quest_goal.
 * Verifies recalculation of loan_path_active.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S8",
  name: "Quest Goal Update",
  description:
    "Scout wants to change their quest goal to a different item. AI should " +
    "call update_quest_goal with the new details. Verify loan_path_active " +
    "is recalculated correctly.",
  scoutSimPrompt: "",
  initialMessage: "actually I want to save up for a gaming laptop instead, its like $1000",
  maxTurns: 4,
  expectedTools: ["update_quest_goal"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
};

export default scenario;
