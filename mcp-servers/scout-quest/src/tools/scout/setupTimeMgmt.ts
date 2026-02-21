import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { timeMgmt, requirements } from "../../db.js";

export function registerSetupTimeMgmt(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "setup_time_mgmt",
    {
      title: "Setup Time Management",
      description: "Create the PM Req 8 time management exercise — to-do list and weekly schedule. Advances PM Req 8a and 8b.",
      inputSchema: {
        todo_list: z.array(z.object({
          item: z.string(),
          priority: z.number().int(),
          category: z.string(),
        })).describe("Prioritized to-do list for the week"),
        weekly_schedule: z.array(z.object({
          day: z.string().describe("Day of week or date"),
          fixed_activities: z.array(z.object({
            time: z.string(),
            activity: z.string(),
          })),
          planned_tasks: z.array(z.object({
            time: z.string(),
            todo_item: z.string(),
          })),
        })).describe("7-day schedule with fixed activities and planned tasks"),
      },
    },
    async ({ todo_list, weekly_schedule }) => {
      const col = await timeMgmt();

      // Check for existing
      const existing = await col.findOne({ scout_email: scoutEmail });
      if (existing) {
        return { content: [{ type: "text", text: "Error: Time management exercise already set up. Use log_diary_entry to record daily progress." }] };
      }

      await col.insertOne({
        scout_email: scoutEmail,
        exercise_week_start: new Date(),
        todo_list,
        weekly_schedule,
        daily_diary: [],
      });

      // Advance PM Req 8a (to-do list) and 8b (schedule) if applicable
      const reqCol = await requirements();
      for (const reqId of ["pm_8a", "pm_8b"]) {
        const req = await reqCol.findOne({ scout_email: scoutEmail, req_id: reqId });
        if (req && (req.status === "not_started" || req.status === "in_progress")) {
          await reqCol.updateOne(
            { scout_email: scoutEmail, req_id: reqId },
            { $set: { status: "ready_for_review", updated_at: new Date() } },
          );
        }
      }

      // Advance PM Req 8c to tracking
      const pm8c = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_8c" });
      if (pm8c && (pm8c.status === "not_started" || pm8c.status === "in_progress")) {
        await reqCol.updateOne(
          { scout_email: scoutEmail, req_id: "pm_8c" },
          { $set: { status: "tracking", tracking_start_date: new Date(), updated_at: new Date() } },
        );
      }

      return {
        content: [{
          type: "text",
          text: `Time management exercise started. ${todo_list.length} to-do items, ${weekly_schedule.length} days scheduled. PM Req 8a/8b → ready_for_review, 8c → tracking. Use log_diary_entry each day.`,
        }],
      };
    },
  );
}
