import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts } from "../../db.js";

export function registerAdjustQuestGoal(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_quest_goal",
    {
      title: "Adjust Quest Goal",
      description: "Change the scout's quest goal item, description, or target budget.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        goal_item: z.string().optional().describe("New goal item"),
        goal_description: z.string().optional().describe("New goal description"),
        target_budget: z.number().positive().optional().describe("New target budget"),
      },
    },
    async ({ scout_email, goal_item, goal_description, target_budget }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (goal_item !== undefined) updates["quest_state.goal_item"] = goal_item;
      if (goal_description !== undefined) updates["quest_state.goal_description"] = goal_description;
      if (target_budget !== undefined) updates["quest_state.target_budget"] = target_budget;

      const col = await scouts();
      const result = await col.updateOne({ email: scout_email }, { $set: updates });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const changed = Object.keys(updates).filter(k => k !== "updated_at").map(k => k.replace("quest_state.", ""));
      return { content: [{ type: "text", text: `Quest goal updated for ${scout_email}: ${changed.join(", ")}.` }] };
    },
  );
}
