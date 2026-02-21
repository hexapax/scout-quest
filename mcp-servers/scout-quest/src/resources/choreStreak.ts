import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { choreLogs, requirements } from "../db.js";

export function registerChoreStreak(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "chore_streak",
    "scout://chore-streak",
    {
      title: "Chore Streak",
      description: "Current and longest chore streak, total earned, today's status, and FL Req 3 progress.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await choreLogs();
      const logs = await col.find({ scout_email: scoutEmail }).sort({ date: -1 }).toArray();

      // Calculate current streak
      let currentStreak = 0;
      let longestStreak = 0;
      let totalEarned = 0;
      let loggedToday = false;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (logs.length > 0) {
        // Check if today has an entry
        const latestDate = new Date(logs[0].date);
        latestDate.setHours(0, 0, 0, 0);
        loggedToday = latestDate.getTime() === today.getTime();

        // Calculate streak: consecutive days with entries
        let expectedDate = loggedToday ? today : new Date(today.getTime() - 86400000);
        let streak = 0;

        for (const log of logs) {
          const logDate = new Date(log.date);
          logDate.setHours(0, 0, 0, 0);
          totalEarned += log.income_earned;

          if (logDate.getTime() === expectedDate.getTime()) {
            streak++;
            expectedDate = new Date(expectedDate.getTime() - 86400000);
          } else if (logDate.getTime() < expectedDate.getTime()) {
            // Gap found — streak broken
            if (streak > longestStreak) longestStreak = streak;
            break;
          }
          // Skip duplicate days
        }
        currentStreak = streak;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      }

      // FL Req 3 progress (90-day chore tracking)
      const reqCol = await requirements();
      const flReq3 = await reqCol.findOne({ scout_email: scoutEmail, req_id: "fl_3" });
      const fl3Progress = flReq3?.tracking_progress ?? 0;
      const fl3DaysRemaining = Math.max(0, 90 - fl3Progress);

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            current_streak: currentStreak,
            longest_streak: longestStreak,
            total_earned: Math.round(totalEarned * 100) / 100,
            logged_today: loggedToday,
            total_log_entries: logs.length,
            fl_req_3: {
              days_completed: fl3Progress,
              days_remaining: fl3DaysRemaining,
              status: flReq3?.status ?? "not_started",
            },
          }),
        }],
      };
    },
  );
}
