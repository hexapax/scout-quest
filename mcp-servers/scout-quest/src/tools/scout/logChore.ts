import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, choreLogs, requirements } from "../../db.js";
import { validateChoreBackdate } from "../../validation.js";
import { STREAK_MILESTONES } from "../../constants.js";

export function registerLogChore(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "log_chore",
    {
      title: "Log Chores",
      description: "Record completed chores for today (or a recent date). Updates savings, chore streak, and FL Req 3 progress.",
      inputSchema: {
        chores_completed: z.array(z.string()).min(1).describe("IDs of chores completed from the scout's chore list"),
        notes: z.string().optional().describe("Optional notes about today's chores"),
        date: z.string().date().optional().describe("ISO date (YYYY-MM-DD) for backdating, max 3 days ago. Defaults to today."),
      },
    },
    async ({ chores_completed, notes, date }) => {
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { content: [{ type: "text", text: "Error: Scout profile not found." }] };
      }

      // Resolve date
      const choreDate = date ? new Date(date + "T00:00:00") : new Date();
      choreDate.setHours(0, 0, 0, 0);

      if (!validateChoreBackdate(choreDate)) {
        return { content: [{ type: "text", text: "Error: Can only log chores for today or up to 3 days ago." }] };
      }

      // Check for duplicate day entry
      const choreCol = await choreLogs();
      const nextDay = new Date(choreDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const existing = await choreCol.findOne({
        scout_email: scoutEmail,
        date: { $gte: choreDate, $lt: nextDay },
      });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Chores already logged for ${choreDate.toISOString().split("T")[0]}. One entry per day.` }] };
      }

      // Calculate income from completed chores
      let incomeEarned = 0;
      const choreMap = new Map(scout.chore_list.map(c => [c.id, c]));
      for (const choreId of chores_completed) {
        const chore = choreMap.get(choreId);
        if (chore?.earns_income && chore.income_amount) {
          incomeEarned += chore.income_amount;
        }
      }

      // Insert chore log
      await choreCol.insertOne({
        scout_email: scoutEmail,
        date: choreDate,
        chores_completed,
        income_earned: incomeEarned,
        notes,
        created_at: new Date(),
      });

      // Update savings
      if (incomeEarned > 0) {
        await scoutsCol.updateOne(
          { email: scoutEmail },
          { $inc: { "quest_state.current_savings": incomeEarned } },
        );
      }

      // Calculate streak
      const recentLogs = await choreCol.find({ scout_email: scoutEmail })
        .sort({ date: -1 }).limit(100).toArray();
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);
      for (const log of recentLogs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      // Update FL Req 3 tracking if active
      const reqCol = await requirements();
      const flReq3 = await reqCol.findOne({ scout_email: scoutEmail, req_id: "fl_3" });
      if (flReq3 && (flReq3.status === "tracking" || flReq3.status === "in_progress")) {
        await reqCol.updateOne(
          { scout_email: scoutEmail, req_id: "fl_3" },
          {
            $inc: { tracking_progress: 1 },
            $set: { updated_at: new Date() },
          },
        );
      }

      // Check for milestone
      const milestone = STREAK_MILESTONES.includes(streak) ? streak : null;

      const parts = [
        `Chores logged for ${choreDate.toISOString().split("T")[0]}: ${chores_completed.length} chore(s).`,
      ];
      if (incomeEarned > 0) parts.push(`Earned: $${incomeEarned.toFixed(2)}.`);
      parts.push(`Current streak: ${streak} day${streak !== 1 ? "s" : ""}.`);
      if (milestone) parts.push(`** ${milestone}-DAY STREAK MILESTONE! Great job! **`);
      if (flReq3 && flReq3.status === "tracking") {
        const progress = (flReq3.tracking_progress ?? 0) + 1;
        parts.push(`FL Req 3 progress: ${progress}/90 days.`);
      }

      return { content: [{ type: "text", text: parts.join(" ") }] };
    },
  );
}
