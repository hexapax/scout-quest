import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { budgetEntries, requirements } from "../../db.js";
import { BUDGET_MILESTONES } from "../../constants.js";

export function registerLogBudgetEntry(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "log_budget_entry",
    {
      title: "Log Budget Entry",
      description: "Record a weekly budget entry (income, expenses, savings) for PM Req 2c 13-week tracking.",
      inputSchema: {
        week_number: z.number().int().min(1).max(13).describe("Week number (1-13)"),
        income: z.array(z.object({
          source: z.string(),
          amount: z.number().min(0),
        })).describe("Income sources for this week"),
        expenses: z.array(z.object({
          category: z.string(),
          amount: z.number().min(0),
          description: z.string(),
        })).describe("Expenses for this week"),
        savings_deposited: z.number().min(0).describe("Amount saved this week"),
        notes: z.string().optional(),
      },
    },
    async ({ week_number, income, expenses, savings_deposited, notes }) => {
      const col = await budgetEntries();

      // Check for duplicate week
      const existing = await col.findOne({ scout_email: scoutEmail, week_number });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Week ${week_number} already logged. Each week can only be recorded once.` }] };
      }

      // Calculate running total
      const previousEntries = await col.find({ scout_email: scoutEmail })
        .sort({ week_number: 1 }).toArray();
      const previousSavings = previousEntries.reduce((s, e) => s + e.savings_deposited, 0);
      const runningSavingsTotal = previousSavings + savings_deposited;

      await col.insertOne({
        scout_email: scoutEmail,
        week_number,
        week_start: new Date(),
        income,
        expenses,
        savings_deposited,
        running_savings_total: runningSavingsTotal,
        notes,
        created_at: new Date(),
      });

      // Update PM Req 2c tracking if active
      const reqCol = await requirements();
      const pmReq2c = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_2c" });
      if (pmReq2c && (pmReq2c.status === "tracking" || pmReq2c.status === "in_progress")) {
        await reqCol.updateOne(
          { scout_email: scoutEmail, req_id: "pm_2c" },
          {
            $set: { tracking_progress: week_number, updated_at: new Date() },
          },
        );
      }

      const totalIncome = income.reduce((s, i) => s + i.amount, 0);
      const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
      const milestone = BUDGET_MILESTONES.includes(week_number);

      const parts = [
        `Week ${week_number} logged.`,
        `Income: $${totalIncome.toFixed(2)}, Expenses: $${totalExpenses.toFixed(2)}, Saved: $${savings_deposited.toFixed(2)}.`,
        `Running savings total: $${runningSavingsTotal.toFixed(2)}.`,
        `${13 - week_number} week(s) remaining.`,
      ];
      if (milestone) parts.push(`** BUDGET MILESTONE: Week ${week_number} of 13 complete! **`);
      if (week_number === 13) parts.push("** ALL 13 WEEKS COMPLETE! Ready for PM Req 2d review. **");

      return { content: [{ type: "text", text: parts.join(" ") }] };
    },
  );
}
