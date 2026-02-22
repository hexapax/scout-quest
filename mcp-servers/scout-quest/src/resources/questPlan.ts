import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { questPlans } from "../db.js";

export function registerQuestPlan(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "quest_plan",
    "scout://quest-plan",
    {
      title: "Quest Plan",
      description: "Your coaching strategy — priorities, milestones, observations, counselor prep.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await questPlans();
      const plan = await col.findOne({ scout_email: scoutEmail });

      if (!plan) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ status: "no_plan", message: "No quest plan yet. Use update_quest_plan to create one." }),
          }],
        };
      }

      const { _id, ...planData } = plan;
      return { contents: [{ uri: uri.href, text: JSON.stringify(planData) }] };
    },
  );
}
