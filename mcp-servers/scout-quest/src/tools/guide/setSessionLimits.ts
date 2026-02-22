import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus } from "../../db.js";

export function registerSetSessionLimits(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_session_limits",
    {
      title: "Set Session Limits",
      description: "Set daily time limits and allowed days for scout sessions.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        max_minutes_per_day: z.number().int().min(5).max(120).describe("Max minutes per day (5-120)"),
        allowed_days: z.array(z.string()).optional().describe("Allowed days of the week (e.g., ['Monday', 'Wednesday'])"),
      },
    },
    async ({ scout_email, max_minutes_per_day, allowed_days }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const sessionLimits: { max_minutes_per_day: number; allowed_days?: string[] } = { max_minutes_per_day };
      if (allowed_days) sessionLimits.allowed_days = allowed_days;

      const col = await scouts();
      const result = await col.updateOne(
        { email: scout_email },
        { $set: { session_limits: sessionLimits, updated_at: new Date() } },
      );
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, "steps.id": "session_limits" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      return {
        content: [{
          type: "text",
          text: `Session limits set: ${max_minutes_per_day} min/day${allowed_days ? `, allowed on ${allowed_days.join(", ")}` : ""}.`,
        }],
      };
    },
  );
}
