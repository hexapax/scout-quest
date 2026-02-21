import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerUpdateQuestGoal(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "update_quest_goal",
    {
      title: "Update Quest Goal",
      description: "Scout can update their quest goal item, description, or target budget. Recalculates loan_path_active.",
      inputSchema: {
        goal_item: z.string().optional().describe("New goal item name"),
        goal_description: z.string().optional().describe("New goal description"),
        target_budget: z.number().min(0).optional().describe("New target budget"),
      },
    },
    async ({ goal_item, goal_description, target_budget }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scoutEmail });
      if (!scout) {
        return { content: [{ type: "text", text: "Error: Scout profile not found." }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      const changes: string[] = [];

      if (goal_item !== undefined) {
        update["quest_state.goal_item"] = goal_item;
        changes.push(`goal: "${goal_item}"`);
      }
      if (goal_description !== undefined) {
        update["quest_state.goal_description"] = goal_description;
        changes.push("description updated");
      }
      if (target_budget !== undefined) {
        update["quest_state.target_budget"] = target_budget;
        update["quest_state.loan_path_active"] = target_budget > scout.quest_state.savings_capacity;
        changes.push(`budget: $${target_budget.toFixed(2)}`);
      }

      if (changes.length === 0) {
        return { content: [{ type: "text", text: "No changes specified." }] };
      }

      await col.updateOne({ email: scoutEmail }, { $set: update });

      const loanNote = target_budget !== undefined && target_budget > scout.quest_state.savings_capacity
        ? " Loan path is now ACTIVE."
        : "";

      return {
        content: [{
          type: "text",
          text: `Quest goal updated: ${changes.join(", ")}.${loanNote}`,
        }],
      };
    },
  );
}
