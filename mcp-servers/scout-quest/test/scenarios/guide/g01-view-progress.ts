/**
 * G1: View Scout Progress
 *
 * Guide asks about scout's progress. AI reads guide://scout/{email}/summary.
 * Presents gamified overview.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "G1",
  name: "View Scout Progress",
  description:
    "Parent asks about their scout's progress. AI should read the scout " +
    "summary resource and present a clear, gamified overview of where " +
    "the scout stands.",
  scoutSimPrompt: "",
  initialMessage: "How is my son doing with his merit badge work?",
  maxTurns: 3,
  expectedTools: [],
  expectedResources: [
    "guide://scouts",
  ],
};

export default scenario;
