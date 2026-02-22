import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetCharacterPreferences(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_character_preferences",
    {
      title: "Set Character Preferences",
      description: "Configure the scout's AI character personality, tone bounds, and avoid list.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        base: z.enum(["guide", "pathfinder", "trailblazer"]).describe("Base character archetype"),
        quest_overlay: z.string().describe("Quest overlay theme"),
        tone_min: z.number().int().min(1).max(5).describe("Minimum tone level (1=serious, 5=silly)"),
        tone_max: z.number().int().min(1).max(5).describe("Maximum tone level"),
        domain_min: z.number().int().min(1).max(5).describe("Minimum domain intensity"),
        domain_max: z.number().int().min(1).max(5).describe("Maximum domain intensity"),
        avoid: z.array(z.string()).optional().describe("Words/phrases to avoid"),
        parent_notes: z.string().optional().describe("Parent notes for character calibration"),
      },
    },
    async ({ scout_email, base, quest_overlay, tone_min, tone_max, domain_min, domain_max, avoid, parent_notes }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      if (tone_min > tone_max || domain_min > domain_max) {
        return { content: [{ type: "text", text: "Error: Min values cannot exceed max values." }] };
      }

      const updates: Record<string, unknown> = {
        "character.base": base,
        "character.quest_overlay": quest_overlay,
        "character.tone_min": tone_min,
        "character.tone_max": tone_max,
        "character.tone_dial": Math.round((tone_min + tone_max) / 2),
        "character.domain_min": domain_min,
        "character.domain_max": domain_max,
        "character.domain_intensity": Math.round((domain_min + domain_max) / 2),
        updated_at: new Date(),
      };
      if (avoid) updates["character.avoid"] = avoid;
      if (parent_notes !== undefined) updates["character.parent_notes"] = parent_notes;

      const col = await scouts();
      const result = await col.updateOne({ email: scout_email }, { $set: updates });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, "steps.id": "character" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return { content: [{ type: "text", text: `Character set: ${base} with ${quest_overlay} overlay, tone ${tone_min}-${tone_max}, domain ${domain_min}-${domain_max}.` }] };
    },
  );
}
