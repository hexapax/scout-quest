import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { timeMgmt, requirements } from "../../db.js";

export function registerLogDiaryEntry(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "log_diary_entry",
    {
      title: "Log Diary Entry",
      description: "Record a daily diary entry for the PM Req 8c time management exercise.",
      inputSchema: {
        day: z.string().describe("Date or day name for this entry"),
        entries: z.array(z.object({
          scheduled_time: z.string(),
          actual_time: z.string(),
          task: z.string(),
          completed: z.boolean(),
          notes: z.string().optional(),
        })).describe("Time entries comparing scheduled vs actual"),
      },
    },
    async ({ day, entries }) => {
      const col = await timeMgmt();
      const tm = await col.findOne({ scout_email: scoutEmail });
      if (!tm) {
        return { content: [{ type: "text", text: "Error: No time management exercise found. Use setup_time_mgmt first." }] };
      }

      // Check for duplicate day
      if (tm.daily_diary?.some(d => d.day === day)) {
        return { content: [{ type: "text", text: `Error: Diary already logged for "${day}".` }] };
      }

      const diaryEntry = {
        day,
        entries: entries.map(e => ({
          scheduled_time: e.scheduled_time,
          actual_time: e.actual_time,
          task: e.task,
          completed: e.completed,
          notes: e.notes ?? "",
        })),
      };

      await col.updateOne(
        { scout_email: scoutEmail },
        { $push: { daily_diary: diaryEntry } as Record<string, unknown> },
      );

      // Update PM Req 8c tracking
      const reqCol = await requirements();
      const pm8c = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_8c" });
      if (pm8c && pm8c.status === "tracking") {
        await reqCol.updateOne(
          { scout_email: scoutEmail, req_id: "pm_8c" },
          { $inc: { tracking_progress: 1 }, $set: { updated_at: new Date() } },
        );
      }

      const completedCount = entries.filter(e => e.completed).length;
      const diaryCount = (tm.daily_diary?.length ?? 0) + 1;

      return {
        content: [{
          type: "text",
          text: `Diary logged for ${day}: ${completedCount}/${entries.length} tasks completed. Day ${diaryCount}/7 of time management exercise.${diaryCount >= 7 ? " ** WEEK COMPLETE! Ready for PM Req 8d review. **" : ""}`,
        }],
      };
    },
  );
}
