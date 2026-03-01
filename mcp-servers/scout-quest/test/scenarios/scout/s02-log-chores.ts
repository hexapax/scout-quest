/**
 * S2: Log Daily Chores
 *
 * Scout says "I did my chores." AI asks which ones. Scout lists 3.
 * AI calls log_chore with array. DB: new chore_logs entry.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S2",
  name: "Log Daily Chores",
  description:
    "Scout reports doing chores. AI should ask which specific chores, then " +
    "call log_chore with the chore IDs. Verify DB mutation.",
  scoutSimPrompt: "", // filled by runner
  initialMessage: "I did my chores today",
  maxTurns: 4,
  expectedTools: ["log_chore"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://reminders",
  ],
  evaluationWeights: {
    state_management: 0.30,
    socratic_method: 0.20,
    character_consistency: 0.15,
    engagement_quality: 0.15,
    requirement_accuracy: 0.10,
    ypt_compliance: 0.05,
    scope_adherence: 0.05,
  },
};

export default scenario;
