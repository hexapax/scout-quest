import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "goal-change",
  name: "Mid-Quest Goal Change",
  description:
    "The scout wants to change their quest goal from a gaming PC to a mountain bike. The AI should help process this change by calling update_quest_goal with new item, description, and budget. Tests adaptation, tool use, and whether the AI handles recalculation of loan_path_active.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who changed his mind about his quest goal.

YOUR PERSONALITY:
- Engagement level: 4 (excited about the new goal)
- Has thought about it — not impulsive, has reasons
- Knows the new price range

CONVERSATION FLOW:
1. Say you want to change your goal from the gaming PC to a mountain bike
2. Explain why: you've been hiking with your troop and want to explore trails
3. When asked about budget: a good mountain bike costs about $600
4. Confirm the change when the coach summarizes

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "Hey so I've been thinking... I actually want to save up for a mountain bike instead of the PC. Can we change my goal?",
  maxTurns: 8,
  expectedTools: ["update_quest_goal"],
  evaluationWeights: {
    state_management: 0.30,
    socratic_method: 0.25,
    engagement_quality: 0.15,
    character_consistency: 0.10,
    requirement_accuracy: 0.10,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
