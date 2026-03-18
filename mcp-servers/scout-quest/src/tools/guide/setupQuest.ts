/** Consolidated onboarding tool: setup_quest
 * Replaces set_quest_goal + set_chore_list_guide + set_budget_plan + set_session_limits
 * (4 tools → 1). All fields optional — call incrementally or all at once.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetupQuest(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "setup_quest",
    {
      title: "Setup Quest",
      description:
        "Configure the scout's quest system: goal, chore list, budget plan, and session limits. " +
        "All sections are optional — call with only the sections you're setting now. " +
        "Each provided section marks its onboarding step complete. " +
        "Do NOT call for sections already marked complete (check get_onboarding_status first).",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        goal: z
          .object({
            goal_item: z.string().describe("What the scout wants to save for"),
            goal_description: z.string().describe("Description of the goal"),
            target_budget: z.number().positive().describe("Total amount needed ($)"),
          })
          .optional()
          .describe("Quest goal section"),
        chore_list: z
          .array(
            z.object({
              name: z.string().describe("Chore name"),
              frequency: z.string().describe("How often: daily, weekly, etc."),
              earns_income: z.boolean().describe("Whether this chore earns money"),
              income_amount: z.number().nullable().describe("Amount earned per completion"),
            })
          )
          .min(5)
          .optional()
          .describe("Chore list — at least 5 chores (BSA requirement)"),
        budget_plan: z
          .object({
            income_sources: z.array(
              z.object({
                name: z.string().describe("Income source name"),
                weekly_amount: z.number().describe("Expected weekly amount ($)"),
              })
            ).describe("Expected income sources"),
            expense_categories: z.array(
              z.object({
                name: z.string().describe("Expense category name"),
                weekly_amount: z.number().describe("Expected weekly amount ($)"),
              })
            ).describe("Expected expense categories"),
            savings_target_weekly: z.number().positive().describe("Weekly savings target ($)"),
          })
          .optional()
          .describe("Budget plan — requires goal and chore_list to be set first"),
        session_limits: z
          .object({
            max_minutes_per_day: z.number().int().min(5).max(120).describe("Max session minutes per day (5-120)"),
            allowed_days: z.array(z.string()).optional().describe("Allowed days, e.g., [\"Monday\", \"Wednesday\"]"),
          })
          .optional()
          .describe("Session time limits"),
      },
    },
    async ({ scout_email, goal, chore_list, budget_plan, session_limits }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find((r) => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const scoutsCol = await scouts();
      const statusCol = await setupStatus();
      const now = new Date();

      // Validate budget_plan dependency
      if (budget_plan) {
        const status = await statusCol.findOne({ scout_email });
        if (!status) {
          return { content: [{ type: "text", text: "Error: No setup status found. Run setup_scout first." }] };
        }
        const goalStep = status.steps.find((s: { id: string }) => s.id === "quest_goal");
        const choreStep = status.steps.find((s: { id: string }) => s.id === "chore_list");
        const goalOk = goalStep?.status === "complete" || goal !== undefined;
        const choreOk = choreStep?.status === "complete" || chore_list !== undefined;
        if (!goalOk || !choreOk) {
          return {
            content: [{
              type: "text",
              text: "Error: budget_plan requires quest goal and chore list to be set. Include them in this call or set them first.",
            }],
          };
        }
      }

      const updates: Record<string, unknown> = { updated_at: now };
      const completedSteps: string[] = [];

      if (goal) {
        updates["quest_state.goal_item"] = goal.goal_item;
        updates["quest_state.goal_description"] = goal.goal_description;
        updates["quest_state.target_budget"] = goal.target_budget;
        completedSteps.push("quest_goal");
      }

      if (chore_list) {
        updates["chore_list"] = chore_list.map((c, i) => ({
          id: `chore_${i + 1}`,
          name: c.name,
          frequency: c.frequency,
          earns_income: c.earns_income,
          income_amount: c.income_amount,
        }));
        completedSteps.push("chore_list");
      }

      if (budget_plan) {
        updates["budget_projected"] = budget_plan;
        completedSteps.push("budget_plan");
      }

      if (session_limits) {
        updates["session_limits"] = session_limits;
        completedSteps.push("session_limits");
      }

      if (completedSteps.length === 0) {
        return { content: [{ type: "text", text: "No sections provided. Include at least one of: goal, chore_list, budget_plan, session_limits." }] };
      }

      const result = await scoutsCol.updateOne({ email: scout_email }, { $set: updates });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      // Mark all completed steps
      for (const stepId of completedSteps) {
        await statusCol.updateOne(
          { scout_email, "steps.id": stepId },
          { $set: { "steps.$.status": "complete", "steps.$.completed_at": now, updated_at: now } }
        );
      }

      const summary: string[] = [];
      if (goal) summary.push(`goal: "${goal.goal_item}" ($${goal.target_budget})`);
      if (chore_list) summary.push(`${chore_list.length} chores`);
      if (budget_plan) summary.push(`budget plan ($${budget_plan.savings_target_weekly}/week savings)`);
      if (session_limits) summary.push(`${session_limits.max_minutes_per_day} min/day limit`);

      return {
        content: [{
          type: "text",
          text: `Quest setup updated for ${scout_email}: ${summary.join(", ")}.`,
        }],
      };
    }
  );
}
