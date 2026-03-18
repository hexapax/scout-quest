/** Tool: get_scout_dashboard
 * Returns a consolidated summary of a scout's current status across all dimensions:
 * advancement, quest goal, budget, chore streak, and onboarding.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, setupStatus, choreLogs, budgetEntries } from "../../db.js";

export function registerGetScoutDashboard(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "get_scout_dashboard",
    {
      title: "Get Scout Dashboard",
      description:
        "Get a complete overview of a scout's current status: quest goal progress, " +
        "budget health, chore streak, and onboarding completion. " +
        "Use at session start to orient yourself before coaching. " +
        "Do NOT call for every message — once per session is enough.",
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

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Scout ${scout_email} not found.` }] };
      }

      const statusCol = await setupStatus();
      const status = await statusCol.findOne({ scout_email });

      const now = new Date();
      const lines: string[] = [];

      // --- Header ---
      lines.push(`Scout Dashboard: ${scout.name} (${scout_email})`);
      lines.push(`Troop ${scout.troop}${scout.patrol ? `, Patrol: ${scout.patrol}` : ""} | Age ${scout.age}`);
      lines.push("");

      // --- Onboarding ---
      if (status) {
        const steps = status.steps as Array<{ status: string }>;
        const done = steps.filter((s) => s.status === "complete").length;
        const total = steps.length;
        if (done < total) {
          lines.push(`⚠ Onboarding: ${done}/${total} steps complete`);
        } else {
          lines.push(`✓ Onboarding complete`);
        }
      } else {
        lines.push(`⚠ Onboarding not started`);
      }

      // --- Quest goal ---
      const qs = scout.quest_state;
      if (qs?.goal_item) {
        const pct = qs.target_budget > 0
          ? Math.round((qs.current_savings / qs.target_budget) * 100)
          : 0;
        lines.push(`Quest: "${qs.goal_item}" — $${qs.current_savings ?? 0} / $${qs.target_budget} (${pct}%)`);
        lines.push(`Status: ${qs.quest_status ?? "setup"}`);
      } else {
        lines.push(`Quest goal: not set`);
      }

      // --- Chore streak (last 7 days) ---
      try {
        const choreLogsCol = await choreLogs();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const recentChores = await choreLogsCol
          .find({ scout_email, logged_at: { $gte: sevenDaysAgo } })
          .toArray();
        lines.push(`Chores logged (last 7 days): ${recentChores.length}`);
      } catch {
        // Non-fatal
      }

      // --- Budget health (last 30 days) ---
      try {
        const budgetCol = await budgetEntries();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const recentEntries = await budgetCol
          .find({ scout_email, date: { $gte: thirtyDaysAgo } })
          .toArray();
        const income = recentEntries
          .filter((e) => e.type === "income")
          .reduce((sum, e) => sum + (e.amount ?? 0), 0);
        const expenses = recentEntries
          .filter((e) => e.type === "expense")
          .reduce((sum, e) => sum + (e.amount ?? 0), 0);
        if (recentEntries.length > 0) {
          lines.push(`Budget (last 30 days): +$${income.toFixed(2)} income, -$${expenses.toFixed(2)} expenses`);
        }
      } catch {
        // Non-fatal
      }

      // --- Session limits ---
      if (scout.session_limits) {
        const lim = scout.session_limits as { max_minutes_per_day: number; allowed_days?: string[] };
        lines.push(`Session limit: ${lim.max_minutes_per_day} min/day${lim.allowed_days ? ` (${lim.allowed_days.join(", ")})` : ""}`);
      }

      // --- Character ---
      if (scout.character?.base) {
        const char = scout.character as { base: string; tone_min: number; tone_max: number };
        lines.push(`Character: ${char.base}, tone ${char.tone_min}-${char.tone_max}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
