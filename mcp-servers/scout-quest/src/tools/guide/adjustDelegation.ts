import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { setupStatus } from "../../db.js";

export function registerAdjustDelegation(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_delegation",
    {
      title: "Adjust Delegation",
      description: "Set which onboarding tasks the scout handles vs the guide. Changes step status to 'delegated_to_scout' or back to 'pending'.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        changes: z.array(z.object({
          step_id: z.string().describe("Setup step ID"),
          delegate_to_scout: z.boolean().describe("true = delegate to scout, false = guide handles"),
        })).describe("Steps to change delegation for"),
      },
    },
    async ({ scout_email, changes }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const col = await setupStatus();
      const status = await col.findOne({ scout_email });
      if (!status) {
        return { content: [{ type: "text", text: "Error: No setup status found. Create scout profile first." }] };
      }

      const now = new Date();
      const results: string[] = [];

      for (const change of changes) {
        const step = status.steps.find(s => s.id === change.step_id);
        if (!step) {
          results.push(`${change.step_id}: not found`);
          continue;
        }
        if (step.status === "complete") {
          results.push(`${change.step_id}: already complete, skipped`);
          continue;
        }

        const newStatus = change.delegate_to_scout ? "delegated_to_scout" as const : "pending" as const;
        await col.updateOne(
          { scout_email, "steps.id": change.step_id },
          {
            $set: {
              "steps.$.status": newStatus,
              ...(change.delegate_to_scout ? { "steps.$.delegated_at": now } : {}),
              updated_at: now,
            },
          },
        );
        results.push(`${change.step_id}: ${newStatus}`);
      }

      return { content: [{ type: "text", text: `Delegation updated:\n${results.join("\n")}` }] };
    },
  );
}
