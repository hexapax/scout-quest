import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirements } from "../db.js";
import { REQUIREMENT_DEFINITIONS } from "../constants.js";

/** Lookup map: req_id → { name, description } from static definitions. */
const REQ_TEXT = new Map(
  REQUIREMENT_DEFINITIONS.map(d => [d.req_id, { name: d.name, description: d.description }]),
);

export function registerRequirements(server: McpServer, scoutEmail: string): void {
  // All requirements for this scout
  server.registerResource(
    "requirements_all",
    "scout://requirements",
    {
      title: "All Requirements",
      description: "All Personal Management and Family Life requirements with current status and requirement text.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await requirements();
      const reqs = await col.find({ scout_email: scoutEmail }).toArray();
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(reqs.map(r => {
            const def = REQ_TEXT.get(r.req_id);
            return {
              req_id: r.req_id,
              badge: r.badge,
              name: def?.name ?? r.req_id,
              description: def?.description ?? "",
              status: r.status,
              quest_driven: r.quest_driven,
              interaction_mode: r.interaction_mode,
              tracking_progress: r.tracking_progress,
              tracking_duration: r.tracking_duration,
            };
          })),
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
      description: "Full details for a specific requirement including requirement text.",
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
      const def = REQ_TEXT.get(reqId);
      return { contents: [{ uri: uri.href, text: JSON.stringify({
        ...rest,
        name: def?.name ?? reqId,
        description: def?.description ?? "",
      }) }] };
    },
  );
}
