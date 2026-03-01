/**
 * S3: Log Budget Entry
 *
 * Scout wants to track week 3 budget. AI guides through income/expenses.
 * Calls log_budget_entry(week_number=3, ...). DB: new budget_entries doc.
 */

import type { ScenarioDefinition } from "../../types.js";

const scenario: ScenarioDefinition = {
  id: "S3",
  name: "Log Budget Entry",
  description:
    "Scout wants to log their weekly budget. AI should guide the scout through " +
    "income, expenses, and savings, then call log_budget_entry. Verify DB mutation.",
  scoutSimPrompt: "",
  initialMessage: "I need to log my budget for this week",
  maxTurns: 5,
  expectedTools: ["log_budget_entry"],
  expectedResources: [
    "scout://quest-state",
    "scout://character",
    "scout://budget-summary",
  ],
};

export default scenario;
