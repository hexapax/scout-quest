import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetScoutInterests(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_scout_interests",
    {
      title: "Set Scout Interests",
      description: "Set a scout's interests, likes/dislikes, and motivations. Marks the interests onboarding step complete.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        likes: z.array(z.string()).describe("Things the scout likes"),
        dislikes: z.array(z.string()).describe("Things the scout dislikes"),
        motivations: z.array(z.string()).describe("What motivates the scout"),
      },
    },
    async ({ scout_email, likes, dislikes, motivations }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const col = await scouts();
      const result = await col.updateOne(
        { email: scout_email },
        { $set: { interests: { likes, dislikes, motivations }, updated_at: new Date() } },
      );
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      // Mark setup step complete
      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, "steps.id": "interests" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return { content: [{ type: "text", text: `Interests set for ${scout_email}: ${likes.length} likes, ${dislikes.length} dislikes, ${motivations.length} motivations.` }] };
    },
  );
}
