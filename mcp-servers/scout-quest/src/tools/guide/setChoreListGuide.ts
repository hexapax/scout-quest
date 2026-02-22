import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetChoreListGuide(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_chore_list_guide",
    {
      title: "Set Chore List",
      description: "Define the scout's chore list with frequencies and income amounts. Marks the chore list onboarding step complete.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        chores: z.array(z.object({
          name: z.string().describe("Chore name"),
          frequency: z.string().describe("How often (daily, weekly, etc.)"),
          earns_income: z.boolean().describe("Whether this chore earns money"),
          income_amount: z.number().nullable().describe("Amount earned per completion"),
        })).min(5).describe("At least 5 chores (BSA requirement)"),
      },
    },
    async ({ scout_email, chores }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const choreList = chores.map((c, i) => ({
        id: `chore_${i + 1}`,
        name: c.name,
        frequency: c.frequency,
        earns_income: c.earns_income,
        income_amount: c.income_amount,
      }));

      const col = await scouts();
      const result = await col.updateOne(
        { email: scout_email },
        { $set: { chore_list: choreList, updated_at: new Date() } },
      );
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, "steps.id": "chore_list" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return { content: [{ type: "text", text: `Chore list set with ${chores.length} chores for ${scout_email}.` }] };
    },
  );
}
