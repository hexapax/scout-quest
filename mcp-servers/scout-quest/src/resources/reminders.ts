import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { choreLogs, scouts, requirements, budgetEntries, timeMgmt } from "../db.js";
import { STREAK_MILESTONES } from "../constants.js";

interface Reminder {
  type: string;
  message: string;
  urgency: "low" | "medium" | "high";
}

export function registerReminders(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "reminders",
    "scout://reminders",
    {
      title: "Reminders",
      description: "Active reminders — chore logging, diary entries, budget updates, streak alerts, celebrations.",
      mimeType: "application/json",
    },
    async (uri) => {
      const reminders: Reminder[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if chores logged today
      const choreCol = await choreLogs();
      const todaysChores = await choreCol.findOne({
        scout_email: scoutEmail,
        date: { $gte: today },
      });
      if (!todaysChores) {
        reminders.push({
          type: "chore",
          message: "You haven't logged your chores today! Keep that streak going.",
          urgency: "high",
        });
      }

      // Check streak milestone proximity
      const recentLogs = await choreCol.find({ scout_email: scoutEmail })
        .sort({ date: -1 }).limit(100).toArray();
      if (recentLogs.length > 0) {
        let streak = 0;
        let expectedDate = new Date(today);
        if (todaysChores) {
          for (const log of recentLogs) {
            const logDate = new Date(log.date);
            logDate.setHours(0, 0, 0, 0);
            if (logDate.getTime() === expectedDate.getTime()) {
              streak++;
              expectedDate = new Date(expectedDate.getTime() - 86400000);
            } else break;
          }
        }
        const nextMilestone = STREAK_MILESTONES.find(m => m > streak);
        if (nextMilestone && nextMilestone - streak <= 3) {
          reminders.push({
            type: "streak_alert",
            message: `You're ${nextMilestone - streak} day(s) away from a ${nextMilestone}-day streak milestone!`,
            urgency: "medium",
          });
        }
        if (STREAK_MILESTONES.includes(streak) && todaysChores) {
          reminders.push({
            type: "celebration",
            message: `${streak}-DAY STREAK! Amazing dedication!`,
            urgency: "low",
          });
        }
      }

      // Check PM Req 8c diary
      const tmCol = await timeMgmt();
      const tm = await tmCol.findOne({ scout_email: scoutEmail });
      if (tm) {
        const reqCol = await requirements();
        const pm8c = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_8c" });
        if (pm8c?.status === "tracking") {
          const todayStr = today.toISOString().split("T")[0];
          const hasDiaryToday = tm.daily_diary?.some(d => d.day === todayStr);
          if (!hasDiaryToday) {
            reminders.push({
              type: "diary",
              message: "Don't forget your daily diary entry for your time management exercise!",
              urgency: "high",
            });
          }
        }
      }

      // Check budget update
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (scout?.budget_projected) {
        const budgetCol = await budgetEntries();
        const latestBudget = await budgetCol.findOne(
          { scout_email: scoutEmail },
          { sort: { week_number: -1 } },
        );
        const weeksTracked = latestBudget?.week_number ?? 0;
        if (weeksTracked < 13) {
          const questStart = scout.quest_state.quest_start_date;
          if (questStart) {
            const weeksSinceStart = Math.floor(
              (Date.now() - new Date(questStart).getTime()) / (7 * 24 * 60 * 60 * 1000),
            );
            if (weeksSinceStart > weeksTracked) {
              reminders.push({
                type: "budget_update",
                message: `You're ${weeksSinceStart - weeksTracked} week(s) behind on budget tracking. Week ${weeksTracked + 1} is due!`,
                urgency: "medium",
              });
            }
          }
        }
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(reminders),
        }],
      };
    },
  );
}
