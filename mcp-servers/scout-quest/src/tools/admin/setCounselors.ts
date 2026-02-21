import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerSetCounselors(server: McpServer): void {
  server.registerTool(
    "set_counselors",
    {
      title: "Set Counselors",
      description: "Set merit badge counselor contact info for Personal Management or Family Life.",
      inputSchema: {
        scout_email: z.string().email(),
        badge: z.enum(["personal_management", "family_life"]),
        counselor_name: z.string(),
        counselor_email: z.string().email(),
        preferred_contact: z.enum(["email", "phone", "text"]).optional(),
      },
    },
    async ({ scout_email, badge, counselor_name, counselor_email, preferred_contact }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = {
        [`counselors.${badge}`]: {
          name: counselor_name,
          email: counselor_email,
          ...(preferred_contact && { preferred_contact }),
        },
        updated_at: new Date(),
      };

      await col.updateOne({ email: scout_email }, { $set: update });

      return {
        content: [{
          type: "text",
          text: `${badge.replace("_", " ")} counselor set for ${scout_email}: ${counselor_name} (${counselor_email}).`,
        }],
      };
    },
  );
}
