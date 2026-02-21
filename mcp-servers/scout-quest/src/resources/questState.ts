import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts } from "../db.js";

export function registerQuestState(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "quest_state",
    "scout://quest-state",
    {
      title: "Quest State",
      description: "Current quest goal, savings, status, and progress for the scout.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const qs = scout.quest_state;
      const daysSinceStart = qs.quest_start_date
        ? Math.floor((Date.now() - new Date(qs.quest_start_date).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const budgetRemaining = qs.target_budget - qs.current_savings;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            ...qs,
            days_since_start: daysSinceStart,
            budget_remaining: Math.max(0, budgetRemaining),
            progress_percent: qs.target_budget > 0
              ? Math.round((qs.current_savings / qs.target_budget) * 100)
              : 0,
          }),
        }],
      };
    },
  );
}
