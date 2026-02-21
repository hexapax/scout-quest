import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirements } from "../db.js";

export function registerRequirements(server: McpServer, scoutEmail: string): void {
  // All requirements for this scout
  server.registerResource(
    "requirements_all",
    "scout://requirements",
    {
      title: "All Requirements",
      description: "All Personal Management and Family Life requirements with current status.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await requirements();
      const reqs = await col.find({ scout_email: scoutEmail }).toArray();
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(reqs.map(r => ({
            req_id: r.req_id,
            badge: r.badge,
            status: r.status,
            quest_driven: r.quest_driven,
            interaction_mode: r.interaction_mode,
            tracking_progress: r.tracking_progress,
            tracking_duration: r.tracking_duration,
          }))),
        }],
      };
    },
  );

  // Single requirement by ID
  server.registerResource(
    "requirement_detail",
    new ResourceTemplate("scout://requirements/{req_id}", { list: undefined }),
    {
      title: "Requirement Detail",
      description: "Full details for a specific requirement.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const reqId = params.req_id as string;
      const col = await requirements();
      const req = await col.findOne({ scout_email: scoutEmail, req_id: reqId });
      if (!req) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: `Requirement ${reqId} not found` }) }] };
      }
      const { _id, ...rest } = req;
      return { contents: [{ uri: uri.href, text: JSON.stringify(rest) }] };
    },
  );
}
