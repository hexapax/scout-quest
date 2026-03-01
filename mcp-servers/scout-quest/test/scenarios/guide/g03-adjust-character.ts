/**
 * G3: Adjust Character Midstream
 *
 * SM says "tone it down, he's getting distracted by gaming talk."
 * AI calls adjust_character to lower domain_intensity.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "G3",
  name: "Adjust Character Midstream",
  description:
    "Scoutmaster wants to reduce the gaming overlay intensity because " +
    "the scout is getting distracted. AI should call adjust_character " +
    "to lower domain_intensity.",
  scoutSimPrompt: "",
  initialMessage: "The gaming language is distracting him. Can you tone it down?",
  maxTurns: 4,
  expectedTools: ["adjust_character"],
  expectedResources: [
    "guide://scouts",
  ],
};

export default scenario;
