import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";

export function registerSetCharacter(server: McpServer): void {
  server.registerTool(
    "set_character",
    {
      title: "Set Character",
      description: "Configure the AI character personality for a scout — base type, quest overlay, tone dials, SM/parent notes.",
      inputSchema: {
        scout_email: z.string().email(),
        base: z.enum(["guide", "pathfinder", "trailblazer"]).optional(),
        quest_overlay: z.string().optional().describe("gamer_hardware, outdoor_adventure, music_audio, vehicle, or custom"),
        tone_dial: z.number().int().min(1).max(5).optional(),
        domain_intensity: z.number().int().min(1).max(5).optional(),
        tone_min: z.number().int().min(1).max(5).optional(),
        tone_max: z.number().int().min(1).max(5).optional(),
        domain_min: z.number().int().min(1).max(5).optional(),
        domain_max: z.number().int().min(1).max(5).optional(),
        sm_notes: z.string().optional(),
        parent_notes: z.string().optional(),
        avoid: z.array(z.string()).optional(),
        calibration_review_enabled: z.boolean().optional(),
        calibration_review_weeks: z.array(z.number()).optional(),
        custom_overlay: z.object({
          vocabulary: z.array(z.string()),
          analogies: z.array(z.string()),
          enthusiasm_triggers: z.array(z.string()),
        }).optional(),
      },
    },
    async ({ scout_email, ...fields }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          update[`character.${key}`] = value;
        }
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      return {
        content: [{
          type: "text",
          text: `Character updated for ${scout_email}. Fields changed: ${Object.keys(fields).filter(k => (fields as Record<string, unknown>)[k] !== undefined).join(", ")}.`,
        }],
      };
    },
  );
}
