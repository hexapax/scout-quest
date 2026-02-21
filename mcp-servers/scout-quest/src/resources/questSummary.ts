import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts, requirements, choreLogs, budgetEntries } from "../db.js";

export function registerQuestSummary(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "quest_summary",
    "scout://quest-summary",
    {
      title: "Quest Summary",
      description: "Gamified status overview combining quest state, requirements, chore streak, and budget progress.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: "Scout not found." }] };
      }

      const qs = scout.quest_state;
      const reqCol = await requirements();
      const allReqs = await reqCol.find({ scout_email: scoutEmail }).toArray();
      const signedOff = allReqs.filter(r => r.status === "signed_off").length;
      const inProgress = allReqs.filter(r => r.status === "in_progress" || r.status === "tracking").length;
      const total = allReqs.length;

      const choreCol = await choreLogs();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const recentLogs = await choreCol.find({ scout_email: scoutEmail })
        .sort({ date: -1 }).limit(100).toArray();

      let currentStreak = 0;
      if (recentLogs.length > 0) {
        let expectedDate = new Date(today);
        for (const log of recentLogs) {
          const logDate = new Date(log.date);
          logDate.setHours(0, 0, 0, 0);
          if (logDate.getTime() === expectedDate.getTime()) {
            currentStreak++;
            expectedDate = new Date(expectedDate.getTime() - 86400000);
          } else break;
        }
      }

      const budgetCol = await budgetEntries();
      const weeksTracked = await budgetCol.countDocuments({ scout_email: scoutEmail });

      const progressBar = (current: number, total: number, width: number = 20) => {
        if (total === 0) return "[" + "-".repeat(width) + "]";
        const filled = Math.round((current / total) * width);
        return "[" + "=".repeat(filled) + "-".repeat(width - filled) + "]";
      };

      const savingsPercent = qs.target_budget > 0
        ? Math.round((qs.current_savings / qs.target_budget) * 100)
        : 0;

      const lines = [
        `=== QUEST: ${qs.goal_item || "Not set"} ===`,
        `Status: ${qs.quest_status.toUpperCase()}`,
        "",
        `Savings: $${qs.current_savings.toFixed(2)} / $${qs.target_budget.toFixed(2)} (${savingsPercent}%)`,
        `${progressBar(qs.current_savings, qs.target_budget)}`,
        "",
        `Chore Streak: ${currentStreak} day${currentStreak !== 1 ? "s" : ""}`,
        `Budget: ${weeksTracked}/13 weeks tracked`,
        "",
        `Requirements: ${signedOff}/${total} signed off, ${inProgress} in progress`,
        `${progressBar(signedOff, total)}`,
      ];

      if (qs.loan_path_active) {
        lines.push("", "** LOAN PATH ACTIVE — budget exceeds savings capacity **");
      }

      return {
        contents: [{
          uri: uri.href,
          text: lines.join("\n"),
        }],
      };
    },
  );
}
