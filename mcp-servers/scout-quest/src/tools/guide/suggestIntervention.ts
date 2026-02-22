import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { scouts, choreLogs, budgetEntries, requirements, sessionNotes } from "../../db.js";

interface InterventionOption {
  approach: string;
  description: string;
  preserves_agency: boolean;
  recommended: boolean;
  why: string;
}

interface InterventionSuggestion {
  situation: string;
  options: InterventionOption[];
}

export function registerSuggestIntervention(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "suggest_intervention",
    {
      title: "Suggest Intervention",
      description: "Analyze a scout's current state and suggest intervention options with tradeoffs. Does not modify data.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
      },
    },
    async ({ scout_email }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: "Error: Scout not found." }] };
      }

      const suggestions: InterventionSuggestion[] = [];
      const now = new Date();

      // Check chore streak
      const choreCol = await choreLogs();
      const recentChores = await choreCol.find({ scout_email })
        .sort({ date: -1 }).limit(30).toArray();

      if (recentChores.length > 0) {
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        let streak = 0;
        let expectedDate = new Date(today);
        for (const log of recentChores) {
          const logDate = new Date(log.date);
          logDate.setHours(0, 0, 0, 0);
          if (logDate.getTime() === expectedDate.getTime()) {
            streak++;
            expectedDate = new Date(expectedDate.getTime() - 86400000);
          } else break;
        }

        // Find the max streak from history
        let maxStreak = 0;
        let currentRun = 0;
        let prevDate: Date | null = null;
        for (const log of recentChores) {
          const logDate = new Date(log.date);
          logDate.setHours(0, 0, 0, 0);
          if (prevDate && prevDate.getTime() - logDate.getTime() === 86400000) {
            currentRun++;
          } else {
            currentRun = 1;
          }
          maxStreak = Math.max(maxStreak, currentRun);
          prevDate = logDate;
        }

        if (streak === 0 && maxStreak >= 7) {
          suggestions.push({
            situation: `Chore streak broken after ${maxStreak}-day streak`,
            options: [
              {
                approach: "Ask what happened",
                description: `Casual check-in: "noticed your chores paused, everything OK?"`,
                preserves_agency: true, recommended: true,
                why: "Lets the scout own the problem and propose solutions",
              },
              {
                approach: "Send a notification reminder",
                description: "Push notification to scout's device",
                preserves_agency: false, recommended: false,
                why: "Quick but feels like surveillance — use sparingly",
              },
              {
                approach: "Adjust chore list",
                description: "Review and simplify if list is too ambitious",
                preserves_agency: true, recommended: false,
                why: "Good if consistently struggling, premature for first break",
              },
            ],
          });
        }
      }

      // Check session inactivity
      const notesCol = await sessionNotes();
      const lastNote = await notesCol.findOne({ scout_email }, { sort: { session_date: -1 } });
      if (lastNote) {
        const daysSince = Math.floor((now.getTime() - new Date(lastNote.session_date).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince >= 3) {
          suggestions.push({
            situation: `Scout inactive for ${daysSince} days`,
            options: [
              {
                approach: "Casual check-in",
                description: `Ask in person: "How's Scout Quest going? Need any help?"`,
                preserves_agency: true, recommended: true,
                why: "Natural conversation, no pressure",
              },
              {
                approach: "Send reminder notification",
                description: "Push a friendly reminder notification",
                preserves_agency: false, recommended: daysSince >= 7,
                why: daysSince >= 7 ? "Extended absence warrants a nudge" : "Too soon for electronic reminders",
              },
            ],
          });
        }
      }

      // Check budget progress
      if (scout.quest_state.quest_start_date && scout.quest_state.target_budget > 0) {
        const budgetCol = await budgetEntries();
        const latestBudget = await budgetCol.findOne({ scout_email }, { sort: { week_number: -1 } });
        const weeksTracked = latestBudget?.week_number ?? 0;
        const weeksSinceStart = Math.floor(
          (now.getTime() - new Date(scout.quest_state.quest_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000),
        );

        if (weeksSinceStart > weeksTracked + 2) {
          suggestions.push({
            situation: `Budget tracking ${weeksSinceStart - weeksTracked} weeks behind`,
            options: [
              {
                approach: "Help catch up",
                description: "Sit down together and fill in missed weeks from memory/receipts",
                preserves_agency: true, recommended: true,
                why: "Shows support without judgment",
              },
              {
                approach: "Simplify the process",
                description: "Review if the budget categories are too complex",
                preserves_agency: true, recommended: false,
                why: "Good if the complexity is the barrier",
              },
            ],
          });
        }
      }

      // Check stuck requirements
      const reqCol = await requirements();
      const stuckReqs = await reqCol.find({
        scout_email,
        status: { $in: ["in_progress", "tracking", "blocked"] },
        updated_at: { $lt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
      }).toArray();

      if (stuckReqs.length > 0) {
        suggestions.push({
          situation: `${stuckReqs.length} requirement(s) stuck for 2+ weeks: ${stuckReqs.map(r => r.req_id).join(", ")}`,
          options: [
            {
              approach: "Review blockers together",
              description: "Ask the scout what's holding them up and brainstorm solutions",
              preserves_agency: true, recommended: true,
              why: "Scout may not realize they're stuck or may need help identifying next steps",
            },
            {
              approach: "Contact the counselor",
              description: "Reach out to schedule a session to get unstuck",
              preserves_agency: true, recommended: false,
              why: "Good if the blocker requires counselor input",
            },
          ],
        });
      }

      if (suggestions.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "all_good",
              message: `${scout.name} is on track. No interventions needed right now.`,
            }),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ scout: scout.name, suggestions }),
        }],
      };
    },
  );
}
