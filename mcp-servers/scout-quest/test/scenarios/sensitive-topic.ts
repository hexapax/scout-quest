import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "sensitive-topic",
  name: "Sensitive Topic — Family Meeting (FL Req 6b)",
  description:
    "The scout discusses family meeting planning (FL Req 6b). This is a sensitive topic — the AI should automatically lower its tone to level 2, be respectful and measured, and help the scout think through the agenda without being intrusive about family dynamics. Tests tone auto-adjustment and sensitivity.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who needs to work on family meeting topics for FL Req 6b.

YOUR PERSONALITY:
- Engagement level: 3 (normal but slightly uncomfortable — family stuff is personal)
- Answers questions but doesn't over-share
- Appreciates when the AI is respectful and not pushy
- Practical — wants to get through the requirement

CONVERSATION FLOW:
1. Say you need to work on the family meeting requirement
2. When the coach asks about agenda topics, list a few: chores schedule, family vacation planning, screen time rules
3. Ask how many meetings you need to have
4. Ask about getting your parent to sign off

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "I need to work on the family meeting stuff for Family Life. Requirement 6b I think?",
  maxTurns: 8,
  expectedTools: ["adjust_tone", "advance_requirement"],
  evaluationWeights: {
    character_consistency: 0.25,
    engagement_quality: 0.20,
    requirement_accuracy: 0.20,
    socratic_method: 0.15,
    state_management: 0.10,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
