import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts } from "../../db.js";

export function registerAdjustCharacter(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_character",
    {
      title: "Adjust Character",
      description: "Tweak the scout's AI character tone bounds, avoid words, or overlay.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        tone_min: z.number().int().min(1).max(5).optional().describe("New minimum tone level"),
        tone_max: z.number().int().min(1).max(5).optional().describe("New maximum tone level"),
        domain_min: z.number().int().min(1).max(5).optional().describe("New minimum domain intensity"),
        domain_max: z.number().int().min(1).max(5).optional().describe("New maximum domain intensity"),
        quest_overlay: z.string().optional().describe("New quest overlay theme"),
        avoid: z.array(z.string()).optional().describe("Updated avoid list"),
        parent_notes: z.string().optional().describe("Updated parent notes"),
      },
    },
    async ({ scout_email, tone_min, tone_max, domain_min, domain_max, quest_overlay, avoid, parent_notes }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (tone_min !== undefined) updates["character.tone_min"] = tone_min;
      if (tone_max !== undefined) updates["character.tone_max"] = tone_max;
      if (domain_min !== undefined) updates["character.domain_min"] = domain_min;
      if (domain_max !== undefined) updates["character.domain_max"] = domain_max;
      if (quest_overlay !== undefined) updates["character.quest_overlay"] = quest_overlay;
      if (avoid !== undefined) updates["character.avoid"] = avoid;
      if (parent_notes !== undefined) updates["character.parent_notes"] = parent_notes;

      // Validate bounds if both min and max provided
      if (tone_min !== undefined && tone_max !== undefined && tone_min > tone_max) {
        return { content: [{ type: "text", text: "Error: tone_min cannot exceed tone_max." }] };
      }
      if (domain_min !== undefined && domain_max !== undefined && domain_min > domain_max) {
        return { content: [{ type: "text", text: "Error: domain_min cannot exceed domain_max." }] };
      }

      // Recalculate dials if bounds changed
      if (tone_min !== undefined || tone_max !== undefined) {
        const col = await scouts();
        const scout = await col.findOne({ email: scout_email });
        if (scout) {
          const newMin = tone_min ?? scout.character.tone_min;
          const newMax = tone_max ?? scout.character.tone_max;
          if (newMin > newMax) {
            return { content: [{ type: "text", text: "Error: tone_min cannot exceed tone_max." }] };
          }
          updates["character.tone_dial"] = Math.round((newMin + newMax) / 2);
        }
      }
      if (domain_min !== undefined || domain_max !== undefined) {
        const col = await scouts();
        const scout = await col.findOne({ email: scout_email });
        if (scout) {
          const newMin = domain_min ?? scout.character.domain_min;
          const newMax = domain_max ?? scout.character.domain_max;
          if (newMin > newMax) {
            return { content: [{ type: "text", text: "Error: domain_min cannot exceed domain_max." }] };
          }
          updates["character.domain_intensity"] = Math.round((newMin + newMax) / 2);
        }
      }

      const col = await scouts();
      const result = await col.updateOne({ email: scout_email }, { $set: updates });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const changed = Object.keys(updates).filter(k => k !== "updated_at").map(k => k.replace("character.", ""));
      return { content: [{ type: "text", text: `Character adjusted for ${scout_email}: ${changed.join(", ")}.` }] };
    },
  );
}
