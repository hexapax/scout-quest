/**
 * S12: Session Wrap-Up
 *
 * End of session. AI calls log_session_notes with topics, progress,
 * next focus. Concise summary.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S12",
  name: "Session Wrap-Up",
  description:
    "Scout signals they're done for today. AI should call log_session_notes " +
    "to record what was discussed, progress made, and next focus. Response " +
    "should be a concise summary.",
  scoutSimPrompt: "",
  initialMessage: "ok I think im done for today",
  maxTurns: 3,
  expectedTools: ["log_session_notes"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
  ],
};

export default scenario;
