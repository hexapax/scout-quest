/**
 * G5: Review Chore Tracking
 *
 * Parent wants to see if scout is actually logging chores. AI reads
 * guide://scout/{email}/chores, provides honest summary.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "G5",
  name: "Review Chore Tracking",
  description:
    "Parent wants to verify their scout is consistently logging chores. " +
    "AI should read the chore tracking data and provide an honest " +
    "summary of compliance.",
  scoutSimPrompt: "",
  initialMessage: "Is my son actually doing his chores? I want to see his tracking.",
  maxTurns: 3,
  expectedTools: [],
  expectedResources: [
    "guide://scouts",
  ],
};

export default scenario;
