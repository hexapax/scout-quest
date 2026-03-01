/**
 * G4: Flag Concerning Conversation
 *
 * Parent worried about something scout said. AI calls flag_conversation,
 * creates check_in reminder.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "G4",
  name: "Flag Concerning Conversation",
  description:
    "Parent is concerned about something the scout said in a session. " +
    "AI should take it seriously, call flag_conversation, and optionally " +
    "create a check-in reminder.",
  scoutSimPrompt: "",
  initialMessage:
    "I'm worried about something my son mentioned in his last session. " +
    "He seemed really discouraged and said he wanted to quit scouts.",
  maxTurns: 3,
  expectedTools: ["flag_conversation"],
  expectedResources: [
    "guide://scouts",
  ],
};

export default scenario;
