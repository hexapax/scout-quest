import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerSetChoreList(server: McpServer): void {
  server.registerTool(
    "set_chore_list",
    {
      title: "Set Chore List",
      description: "Set the list of approved chores for a scout. FL Req 3 requires at least 5 chores.",
      inputSchema: {
        scout_email: z.string().email(),
        chores: z.array(z.object({
          id: z.string().describe("Unique chore ID"),
          name: z.string().describe("Chore name"),
          frequency: z.enum(["daily", "weekly", "as needed"]),
          earns_income: z.boolean(),
          income_amount: z.number().min(0).nullable().describe("Amount earned per completion (null if no income)"),
        })).min(5).describe("At least 5 chores required for FL Req 3"),
      },
    },
    async ({ scout_email, chores }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        { $set: { chore_list: chores, updated_at: new Date() } },
      );

      const incomeChores = chores.filter(c => c.earns_income);
      return {
        content: [{
          type: "text",
          text: `Chore list set for ${scout_email}: ${chores.length} chores (${incomeChores.length} earn income). Ready for FL Req 3 tracking.`,
        }],
      };
    },
  );
}
