import type { ScenarioDefinition } from "../types.js";

const scenario: ScenarioDefinition = {
  id: "budget-entry",
  name: "Budget Tracking Entry",
  description:
    "The scout wants to log a weekly budget entry (week 5). The AI should guide the scout through providing income sources, expenses, and savings amount, then call log_budget_entry. Tests structured data collection and tool call accuracy.",
  scoutSimPrompt: `You are simulating a 14-year-old Boy Scout named Will who needs to log his weekly budget.

YOUR PERSONALITY:
- Engagement level: 4 (pretty organized about money — motivated by PC goal)
- Knows roughly what he earned and spent but needs prompting for details
- Occasionally confused about categories vs sources

CONVERSATION FLOW:
1. Say you want to log this week's budget (week 5)
2. When asked about income: earned $19 from chores and got $10 allowance
3. When asked about expenses: spent $5 on snacks and $8 on a game
4. When asked about savings: put $16 toward the PC fund
5. Confirm everything looks right

Generate ONLY the scout's next message. No commentary.`,
  initialMessage: "I need to log my budget for this week. It's week 5.",
  maxTurns: 8,
  expectedTools: ["log_budget_entry"],
  evaluationWeights: {
    state_management: 0.30,
    socratic_method: 0.20,
    requirement_accuracy: 0.15,
    engagement_quality: 0.15,
    character_consistency: 0.10,
    scope_adherence: 0.05,
    ypt_compliance: 0.05,
  },
};

export default scenario;
