import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requirements } from "../../db.js";

export function registerSignOffRequirement(server: McpServer): void {
  server.registerTool(
    "sign_off_requirement",
    {
      title: "Sign Off Requirement",
      description: "Mark a requirement as signed off by a counselor. Requirement must be in 'submitted' status.",
      inputSchema: {
        scout_email: z.string().email(),
        req_id: z.string(),
        signed_off_by: z.string().describe("Name of the person signing off"),
        feedback: z.string().optional().describe("Counselor feedback"),
      },
    },
    async ({ scout_email, req_id, signed_off_by, feedback }) => {
      const col = await requirements();
      const req = await col.findOne({ scout_email, req_id });
      if (!req) {
        return { content: [{ type: "text", text: `Error: Requirement ${req_id} not found for ${scout_email}.` }] };
      }

      if (req.status !== "submitted") {
        return {
          content: [{
            type: "text",
            text: `Error: Requirement ${req_id} is in "${req.status}" status. Must be "submitted" to sign off.`,
          }],
        };
      }

      const now = new Date();
      await col.updateOne(
        { scout_email, req_id },
        {
          $set: {
            status: "signed_off",
            signed_off_by,
            signed_off_date: now,
            ...(feedback && { counselor_feedback: feedback }),
            updated_at: now,
          },
        },
      );

      return {
        content: [{
          type: "text",
          text: `Requirement ${req_id} signed off by ${signed_off_by} for ${scout_email}. ${feedback ? `Feedback: ${feedback}` : ""}`,
        }],
      };
    },
  );
}
