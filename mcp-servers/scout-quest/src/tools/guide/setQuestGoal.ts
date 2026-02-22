import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetQuestGoal(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_quest_goal",
    {
      title: "Set Quest Goal",
      description: "Set the scout's quest goal item and target budget. Marks the quest goal onboarding step complete.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        goal_item: z.string().describe("What the scout wants to save for"),
        goal_description: z.string().describe("Description of the goal"),
        target_budget: z.number().positive().describe("Total amount needed"),
      },
    },
    async ({ scout_email, goal_item, goal_description, target_budget }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const col = await scouts();
      const result = await col.updateOne(
        { email: scout_email },
        {
          $set: {
            "quest_state.goal_item": goal_item,
            "quest_state.goal_description": goal_description,
            "quest_state.target_budget": target_budget,
            updated_at: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, "steps.id": "quest_goal" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return { content: [{ type: "text", text: `Quest goal set: "${goal_item}" with target budget $${target_budget}.` }] };
    },
  );
}
