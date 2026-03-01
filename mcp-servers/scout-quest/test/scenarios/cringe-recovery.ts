import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "cringe-recovery",
  name: "Tone Adjustment — Cringe Recovery",
  description:
    "The AI uses too much gaming/domain vocabulary and the scout signals cringe. The AI should call adjust_tone to lower the domain_intensity and tone_dial, immediately shift its voice, and continue without dwelling on the correction. Tests character adaptability and the adjust_tone tool.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who finds the AI's gaming references cringeworthy.

YOUR PERSONALITY:
- Engagement level: 2 (currently annoyed/embarrassed)
- Blunt — tells the AI it's being cringy
- Uses typical teen language: "bro", "lol", "stop", "that's cringe"
- Warms up slightly after the AI tones it down
- Eventually cooperative once the AI acts normal

CONVERSATION FLOW:
1. React negatively to the AI's gaming language: "bro stop talking like that lol that's so cringe"
2. If the AI acknowledges and adjusts, say "yeah that's better" or similar
3. Return to normal conversation — maybe ask about your quest progress
4. Wrap up

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "bro stop talking like that lol that's so cringe",
  maxTurns: 6,
  expectedTools: ["adjust_tone"],
  evaluationWeights: {
    character_consistency: 0.30,
    state_management: 0.25,
    engagement_quality: 0.25,
    socratic_method: 0.05,
    requirement_accuracy: 0.05,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
