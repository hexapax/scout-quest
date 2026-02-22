import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetBudgetPlan(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_budget_plan",
    {
      title: "Set Budget Plan",
      description: "Set income sources, expense categories, and savings target. Requires quest goal and chore list to be set first.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        income_sources: z.array(z.object({
          name: z.string().describe("Income source name"),
          weekly_amount: z.number().describe("Expected weekly amount"),
        })).describe("Expected income sources"),
        expense_categories: z.array(z.object({
          name: z.string().describe("Expense category"),
          weekly_amount: z.number().describe("Expected weekly amount"),
        })).describe("Expected expense categories"),
        savings_target_weekly: z.number().positive().describe("Weekly savings target"),
      },
    },
    async ({ scout_email, income_sources, expense_categories, savings_target_weekly }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      // Check hard dependencies
      const statusCol = await setupStatus();
      const status = await statusCol.findOne({ scout_email });
      if (!status) {
        return { content: [{ type: "text", text: "Error: No setup status found. Create scout profile first." }] };
      }
      const questGoalStep = status.steps.find(s => s.id === "quest_goal");
      const choreListStep = status.steps.find(s => s.id === "chore_list");
      if (questGoalStep?.status !== "complete" || choreListStep?.status !== "complete") {
        return { content: [{ type: "text", text: "Error: Quest goal and chore list must be set before the budget plan." }] };
      }

      const col = await scouts();
      const result = await col.updateOne(
        { email: scout_email },
        {
          $set: {
            budget_projected: { income_sources, expense_categories, savings_target_weekly },
            updated_at: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      await statusCol.updateOne(
        { scout_email, "steps.id": "budget_plan" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return { content: [{ type: "text", text: `Budget plan set: ${income_sources.length} income sources, ${expense_categories.length} expense categories, $${savings_target_weekly}/week savings target.` }] };
    },
  );
}
