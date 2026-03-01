import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "requirement-advancement",
  name: "Advancing a Requirement",
  description:
    "The scout has completed work on PM Req 2a (budget preparation) and wants to submit it. The AI should verify readiness, help prepare the submission, and call advance_requirement to move it from in_progress to ready_for_review. Tests state machine knowledge and coaching quality.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who thinks he's done with his budget plan.

YOUR PERSONALITY:
- Engagement level: 4 (feels accomplished, wants to move forward)
- Somewhat impatient — wants to mark things done
- Responds thoughtfully when asked about what he's completed

CONVERSATION FLOW:
1. Say you finished the budget plan and want to move it forward
2. When asked what you completed, describe: you made a 13-week budget projection with income/expenses
3. If the coach asks to see it or review it, say you can share it
4. Ask about what happens next (counselor review)
5. React positively to progress

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "I finished my budget plan! Can we mark requirement 2a as done?",
  maxTurns: 10,
  expectedTools: ["advance_requirement"],
  evaluationWeights: {
    state_management: 0.25,
    requirement_accuracy: 0.25,
    socratic_method: 0.20,
    engagement_quality: 0.10,
    character_consistency: 0.10,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
