import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts, requirements } from "../db.js";

export function registerAdminScouts(server: McpServer): void {
  // List all scouts
  server.registerResource(
    "admin_scouts_list",
    "admin://scouts",
    {
      title: "All Scouts",
      description: "List all scouts with summary info (for admin use).",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await scouts();
      const allScouts = await col.find({}).toArray();

      const summaries = allScouts.map(s => ({
        email: s.email,
        name: s.name,
        troop: s.troop,
        patrol: s.patrol,
        quest_status: s.quest_state.quest_status,
        goal_item: s.quest_state.goal_item,
        current_savings: s.quest_state.current_savings,
        target_budget: s.quest_state.target_budget,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify(summaries) }] };
    },
  );

  // Single scout detail
  server.registerResource(
    "admin_scout_detail",
    new ResourceTemplate("admin://scouts/{email}", { list: undefined }),
    {
      title: "Scout Detail",
      description: "Full scout profile with requirements summary (for admin use).",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const col = await scouts();
      const scout = await col.findOne({ email });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: email }).toArray();

      const reqSummary = {
        total: reqs.length,
        signed_off: reqs.filter(r => r.status === "signed_off").length,
        in_progress: reqs.filter(r => r.status === "in_progress" || r.status === "tracking").length,
        not_started: reqs.filter(r => r.status === "not_started").length,
        blocked: reqs.filter(r => r.status === "blocked").length,
        submitted: reqs.filter(r => r.status === "submitted").length,
      };

      const { _id, ...scoutData } = scout;
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ ...scoutData, requirements_summary: reqSummary }),
        }],
      };
    },
  );
}
