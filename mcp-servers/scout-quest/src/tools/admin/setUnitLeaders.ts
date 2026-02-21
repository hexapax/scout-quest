import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerSetUnitLeaders(server: McpServer): void {
  server.registerTool(
    "set_unit_leaders",
    {
      title: "Set Unit Leaders",
      description: "Set scoutmaster and optional ASM contact info for a scout.",
      inputSchema: {
        scout_email: z.string().email(),
        sm_name: z.string().describe("Scoutmaster name"),
        sm_email: z.string().email().describe("Scoutmaster email"),
        asm_name: z.string().optional().describe("Assistant Scoutmaster name"),
        asm_email: z.string().email().optional().describe("Assistant Scoutmaster email"),
      },
    },
    async ({ scout_email, sm_name, sm_email, asm_name, asm_email }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = {
        "unit_leaders.scoutmaster": { name: sm_name, email: sm_email },
        updated_at: new Date(),
      };

      if (asm_name && asm_email) {
        update["unit_leaders.asm"] = { name: asm_name, email: asm_email };
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      let msg = `Unit leaders set for ${scout_email}: SM ${sm_name} (${sm_email})`;
      if (asm_name) msg += `, ASM ${asm_name} (${asm_email})`;
      return { content: [{ type: "text", text: msg + "." }] };
    },
  );
}
