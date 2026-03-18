/** Tool: get_onboarding_status
 * Returns the onboarding checklist for a scout — which steps are done, pending, or delegated.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { setupStatus } from "../../db.js";

export function registerGetOnboardingStatus(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "get_onboarding_status",
    {
      title: "Get Onboarding Status",
      description:
        "Check which onboarding steps are complete, pending, or delegated to the scout. " +
        "Call at session start before running any setup tools.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
      },
    },
    async ({ scout_email }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find((r) => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const statusCol = await setupStatus();
      const doc = await statusCol.findOne({ scout_email });

      if (!doc) {
        return {
          content: [{
            type: "text",
            text: `No onboarding record for ${scout_email}. Run setup_scout first.`,
          }],
        };
      }

      const lines: string[] = [`Onboarding status for ${scout_email}:`];
      let pendingCount = 0;
      let completeCount = 0;

      for (const step of doc.steps as Array<{ id: string; label: string; status: string; completed_at?: Date }>) {
        const icon =
          step.status === "complete" ? "✓" :
          step.status === "delegated_to_scout" ? "→" :
          "○";
        const completedStr = step.completed_at
          ? ` (${new Date(step.completed_at).toLocaleDateString()})`
          : "";
        lines.push(`  ${icon} ${step.label} [${step.status}]${completedStr}`);

        if (step.status === "complete") completeCount++;
        else pendingCount++;
      }

      lines.push("");
      lines.push(`${completeCount}/${doc.steps.length} steps complete, ${pendingCount} remaining.`);

      if (pendingCount === 0) {
        lines.push("✓ Onboarding complete!");
      } else {
        const nextPending = (doc.steps as Array<{ status: string; label: string }>).find((s) => s.status === "pending");
        if (nextPending) lines.push(`Next: ${nextPending.label}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
