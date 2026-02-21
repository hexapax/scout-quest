import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerSetProjectedBudget(server: McpServer): void {
  server.registerTool(
    "set_projected_budget",
    {
      title: "Set Projected Budget",
      description: "Set the projected weekly budget for a scout — income sources, expense categories, and savings target. Used for PM Req 2a comparison.",
      inputSchema: {
        scout_email: z.string().email(),
        income_sources: z.array(z.object({
          name: z.string(),
          weekly_amount: z.number().min(0),
        })),
        expense_categories: z.array(z.object({
          name: z.string(),
          weekly_amount: z.number().min(0),
        })),
        savings_target_weekly: z.number().min(0).describe("Weekly savings goal"),
      },
    },
    async ({ scout_email, income_sources, expense_categories, savings_target_weekly }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            budget_projected: { income_sources, expense_categories, savings_target_weekly },
            updated_at: new Date(),
          },
        },
      );

      const totalIncome = income_sources.reduce((s, i) => s + i.weekly_amount, 0);
      const totalExpenses = expense_categories.reduce((s, e) => s + e.weekly_amount, 0);

      return {
        content: [{
          type: "text",
          text: `Projected budget set for ${scout_email}: $${totalIncome.toFixed(2)}/week income, $${totalExpenses.toFixed(2)}/week expenses, $${savings_target_weekly.toFixed(2)}/week savings target.`,
        }],
      };
    },
  );
}
