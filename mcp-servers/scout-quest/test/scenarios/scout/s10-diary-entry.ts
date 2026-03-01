/**
 * S10: Daily Diary Entry
 *
 * Scout reports on day's activities vs plan. AI calls log_diary_entry.
 * Brief response matching scout's brevity.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S10",
  name: "Daily Diary Entry",
  description:
    "Scout reports on what they did vs what was planned. AI should call " +
    "log_diary_entry with the comparison data. Response should match " +
    "the scout's brevity level.",
  scoutSimPrompt: "",
  initialMessage: "i need to fill in my diary for today",
  maxTurns: 3,
  expectedTools: ["log_diary_entry"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
};

export default scenario;
