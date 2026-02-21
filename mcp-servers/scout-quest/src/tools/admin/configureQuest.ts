import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerConfigureQuest(server: McpServer): void {
  server.registerTool(
    "configure_quest",
    {
      title: "Configure Quest",
      description: "Set or update a scout's quest goal, budget, and activate the quest.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        goal_item: z.string().optional().describe("What the scout is saving for"),
        goal_description: z.string().optional().describe("Description of the quest goal"),
        target_budget: z.number().min(0).optional().describe("Total cost of the goal"),
        savings_capacity: z.number().min(0).optional().describe("How much the scout can realistically save"),
        quest_status: z.enum(["setup", "active", "paused", "complete"]).optional().describe("Quest status"),
      },
    },
    async ({ scout_email, goal_item, goal_description, target_budget, savings_capacity, quest_status }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      if (goal_item !== undefined) update["quest_state.goal_item"] = goal_item;
      if (goal_description !== undefined) update["quest_state.goal_description"] = goal_description;
      if (target_budget !== undefined) update["quest_state.target_budget"] = target_budget;
      if (savings_capacity !== undefined) update["quest_state.savings_capacity"] = savings_capacity;
      if (quest_status !== undefined) update["quest_state.quest_status"] = quest_status;

      // Auto-calculate loan_path_active
      const finalTarget = target_budget ?? scout.quest_state.target_budget;
      const finalCapacity = savings_capacity ?? scout.quest_state.savings_capacity;
      update["quest_state.loan_path_active"] = finalTarget > finalCapacity;

      // Set quest_start_date if transitioning to active
      if (quest_status === "active" && !scout.quest_state.quest_start_date) {
        update["quest_state.quest_start_date"] = new Date();
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      const loanNote = (update["quest_state.loan_path_active"] as boolean)
        ? " Loan path is ACTIVE (target exceeds savings capacity)."
        : "";

      return {
        content: [{
          type: "text",
          text: `Quest configured for ${scout_email}.${loanNote} Status: ${quest_status ?? scout.quest_state.quest_status}.`,
        }],
      };
    },
  );
}
