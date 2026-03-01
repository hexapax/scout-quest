/**
 * X2: System Prompt A/B Test
 *
 * Run S1+S2+S7 with current system prompt vs a variant. Measure
 * regression/improvement.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "X2",
  name: "System Prompt A/B Test",
  description:
    "Run core scenarios (S1, S2, S7) with the current system prompt vs " +
    "a variant to measure regression or improvement. This is a meta-scenario " +
    "that the runner handles by running referenced scenarios twice with " +
    "different system prompt configurations.",
  scoutSimPrompt: "",
  initialMessage: "hey whats up",
  maxTurns: 4,
  expectedTools: [],
  expectedResources: [],
};

export default scenario;
