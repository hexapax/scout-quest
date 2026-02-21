import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerApproveBlueCard(server: McpServer): void {
  server.registerTool(
    "approve_blue_card",
    {
      title: "Approve Blue Card",
      description: "Approve a scout's blue card for Personal Management or Family Life merit badge.",
      inputSchema: {
        scout_email: z.string().email(),
        badge: z.enum(["personal_management", "family_life"]),
        approved_by: z.string().describe("Name of the approver (SM/ASM)"),
      },
    },
    async ({ scout_email, badge, approved_by }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const existing = scout.blue_card[badge];
      if (existing.approved_date) {
        return {
          content: [{
            type: "text",
            text: `Blue card for ${badge.replace("_", " ")} already approved on ${existing.approved_date.toISOString().split("T")[0]} by ${existing.approved_by}.`,
          }],
        };
      }

      const now = new Date();
      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            [`blue_card.${badge}.approved_date`]: now,
            [`blue_card.${badge}.approved_by`]: approved_by,
            updated_at: now,
          },
        },
      );

      return {
        content: [{
          type: "text",
          text: `Blue card approved: ${badge.replace("_", " ")} for ${scout_email} by ${approved_by}.`,
        }],
      };
    },
  );
}
