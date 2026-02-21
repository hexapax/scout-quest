import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { budgetEntries, scouts } from "../db.js";

export function registerBudgetSummary(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "budget_summary",
    "scout://budget-summary",
    {
      title: "Budget Summary",
      description: "Projected vs actual budget, savings progress, weeks tracked for PM Req 2.",
      mimeType: "application/json",
    },
    async (uri) => {
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      const projected = scout?.budget_projected;

      const entriesCol = await budgetEntries();
      const entries = await entriesCol.find({ scout_email: scoutEmail }).sort({ week_number: 1 }).toArray();

      const actualIncome = entries.reduce((s, e) => s + e.income.reduce((si, i) => si + i.amount, 0), 0);
      const actualExpenses = entries.reduce((s, e) => s + e.expenses.reduce((se, ex) => se + ex.amount, 0), 0);
      const actualSavings = entries.reduce((s, e) => s + e.savings_deposited, 0);

      const projectedWeeklyIncome = projected?.income_sources.reduce((s, i) => s + i.weekly_amount, 0) ?? 0;
      const projectedWeeklyExpenses = projected?.expense_categories.reduce((s, e) => s + e.weekly_amount, 0) ?? 0;
      const weeksTracked = entries.length;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            weeks_tracked: weeksTracked,
            weeks_remaining: Math.max(0, 13 - weeksTracked),
            projected: projected ? {
              weekly_income: projectedWeeklyIncome,
              weekly_expenses: projectedWeeklyExpenses,
              weekly_savings_target: projected.savings_target_weekly,
              total_13_week_income: projectedWeeklyIncome * 13,
              total_13_week_expenses: projectedWeeklyExpenses * 13,
            } : null,
            actual: {
              total_income: Math.round(actualIncome * 100) / 100,
              total_expenses: Math.round(actualExpenses * 100) / 100,
              total_savings: Math.round(actualSavings * 100) / 100,
            },
            savings_toward_goal: scout?.quest_state.current_savings ?? 0,
            goal_target: scout?.quest_state.target_budget ?? 0,
          }),
        }],
      };
    },
  );
}
