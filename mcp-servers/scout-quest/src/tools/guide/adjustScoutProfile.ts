import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts } from "../../db.js";

export function registerAdjustScoutProfile(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_scout_profile",
    {
      title: "Adjust Scout Profile",
      description: "Update a scout's profile info (age, troop, patrol, interests). Only updates provided fields.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        age: z.number().int().min(10).max(18).optional().describe("Updated age"),
        troop: z.string().optional().describe("Updated troop number"),
        patrol: z.string().optional().describe("Updated patrol name"),
        likes: z.array(z.string()).optional().describe("Updated likes"),
        dislikes: z.array(z.string()).optional().describe("Updated dislikes"),
        motivations: z.array(z.string()).optional().describe("Updated motivations"),
      },
    },
    async ({ scout_email, age, troop, patrol, likes, dislikes, motivations }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (age !== undefined) updates.age = age;
      if (troop !== undefined) updates.troop = troop;
      if (patrol !== undefined) updates.patrol = patrol;
      if (likes !== undefined) updates["interests.likes"] = likes;
      if (dislikes !== undefined) updates["interests.dislikes"] = dislikes;
      if (motivations !== undefined) updates["interests.motivations"] = motivations;

      const col = await scouts();
      const result = await col.updateOne({ email: scout_email }, { $set: updates });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const changed = Object.keys(updates).filter(k => k !== "updated_at");
      return { content: [{ type: "text", text: `Profile updated for ${scout_email}: ${changed.join(", ")}.` }] };
    },
  );
}
