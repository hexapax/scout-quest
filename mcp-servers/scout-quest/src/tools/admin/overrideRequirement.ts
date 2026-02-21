import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requirements } from "../../db.js";
import type { RequirementStatus } from "../../types.js";

export function registerOverrideRequirement(server: McpServer): void {
  server.registerTool(
    "override_requirement",
    {
      title: "Override Requirement",
      description: "Admin override — set any requirement to any status, bypassing normal state machine transitions. Use for corrections or special circumstances.",
      inputSchema: {
        scout_email: z.string().email(),
        req_id: z.string(),
        new_status: z.string().describe("Target status (any valid status)"),
        reason: z.string().describe("Reason for the override"),
      },
    },
    async ({ scout_email, req_id, new_status, reason }) => {
      const col = await requirements();
      const req = await col.findOne({ scout_email, req_id });
      if (!req) {
        return { content: [{ type: "text", text: `Error: Requirement ${req_id} not found for ${scout_email}.` }] };
      }

      const oldStatus = req.status;
      await col.updateOne(
        { scout_email, req_id },
        {
          $set: {
            status: new_status as RequirementStatus,
            notes: `${req.notes ? req.notes + "\n" : ""}[ADMIN OVERRIDE] ${oldStatus} → ${new_status}: ${reason}`,
            updated_at: new Date(),
          },
        },
      );

      return {
        content: [{
          type: "text",
          text: `Requirement ${req_id} overridden: ${oldStatus} → ${new_status}. Reason: ${reason}.`,
        }],
      };
    },
  );
}
