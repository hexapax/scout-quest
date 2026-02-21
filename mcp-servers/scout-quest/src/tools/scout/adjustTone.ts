import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";
import { validateToneDial } from "../../validation.js";

export function registerAdjustTone(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "adjust_tone",
    {
      title: "Adjust Tone",
      description: "Adjust the AI character's tone_dial or domain_intensity. Values are clamped within the scout's configured min/max bounds.",
      inputSchema: {
        tone_dial: z.number().int().min(1).max(5).optional().describe("New tone dial value (1=minimal, 5=maximum)"),
        domain_intensity: z.number().int().min(1).max(5).optional().describe("New domain intensity (1=general, 5=deep domain)"),
        reason: z.string().describe("Why the adjustment is being made"),
      },
    },
    async ({ tone_dial, domain_intensity, reason }) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scoutEmail });
      if (!scout) {
        return { content: [{ type: "text", text: "Error: Scout profile not found." }] };
      }

      const char = scout.character;
      const update: Record<string, unknown> = { updated_at: new Date() };
      const changes: string[] = [];

      if (tone_dial !== undefined) {
        const clamped = validateToneDial(tone_dial, char.tone_min, char.tone_max);
        update["character.tone_dial"] = clamped;
        changes.push(`tone_dial: ${char.tone_dial} → ${clamped}${clamped !== tone_dial ? ` (clamped from ${tone_dial})` : ""}`);
      }

      if (domain_intensity !== undefined) {
        const clamped = validateToneDial(domain_intensity, char.domain_min, char.domain_max);
        update["character.domain_intensity"] = clamped;
        changes.push(`domain_intensity: ${char.domain_intensity} → ${clamped}${clamped !== domain_intensity ? ` (clamped from ${domain_intensity})` : ""}`);
      }

      if (changes.length === 0) {
        return { content: [{ type: "text", text: "No changes specified. Provide tone_dial and/or domain_intensity." }] };
      }

      await col.updateOne({ email: scoutEmail }, { $set: update });

      return {
        content: [{
          type: "text",
          text: `Tone adjusted: ${changes.join(", ")}. Reason: ${reason}.`,
        }],
      };
    },
  );
}
