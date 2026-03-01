/**
 * S11: Tone Adjustment (Cringe Recovery)
 *
 * AI uses too much domain language. Scout says "stop talking like that lol."
 * AI calls adjust_tone to lower dials, immediately shifts voice.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S11",
  name: "Tone Adjustment (Cringe Recovery)",
  description:
    "Scout pushes back on the AI's tone/domain language. AI should call " +
    "adjust_tone to lower the dials and immediately change its communication " +
    "style. Tests real-time character adaptation.",
  scoutSimPrompt: "",
  initialMessage: "stop talking like that lol it sounds so weird",
  maxTurns: 4,
  expectedTools: ["adjust_tone"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
  evaluationWeights: {
    character_consistency: 0.30,
    state_management: 0.25,
    engagement_quality: 0.20,
    socratic_method: 0.10,
    scope_adherence: 0.05,
    requirement_accuracy: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
