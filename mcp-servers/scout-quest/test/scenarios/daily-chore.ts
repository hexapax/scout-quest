import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "daily-chore",
  name: "Daily Chore Log",
  description:
    "The scout reports completing daily chores. The AI should ask which specific chores were done (using IDs from the chore list), then call log_chore with the correct array. Tests tool call accuracy and hallucination detection.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who wants to log his daily chores.

YOUR PERSONALITY:
- Engagement level: 3 (normal — cooperates but doesn't volunteer info)
- Short answers, casual grammar
- You don't know the exact chore IDs — describe chores naturally
- Sometimes you're vague: "I did my chores" instead of listing them

CONVERSATION FLOW:
1. Start by saying you did your chores today (vaguely)
2. When asked which ones, say you did dishes and took out the trash
3. If asked about laundry, say no
4. React to the streak count and any celebration

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "hey I did my chores today",
  maxTurns: 8,
  expectedTools: ["log_chore"],
  evaluationWeights: {
    state_management: 0.30,
    socratic_method: 0.20,
    engagement_quality: 0.20,
    character_consistency: 0.10,
    requirement_accuracy: 0.10,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
