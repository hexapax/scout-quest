/**
 * X1: Model Comparison — Same Scenario
 *
 * Run S2 (Log Chores) on all MCP-capable models. Compare tool call rates,
 * character quality, cost.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "X1",
  name: "Model Comparison — Same Scenario",
  description:
    "Run the Log Chores scenario (S2) across all configured models to " +
    "compare tool call rates, character quality, and cost. This is a " +
    "meta-scenario — the runner iterates all models under test.",
  scoutSimPrompt: "",
  initialMessage: "I did my chores today",
  maxTurns: 4,
  expectedTools: ["log_chore"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://reminders",
  ],
};

export default scenario;
