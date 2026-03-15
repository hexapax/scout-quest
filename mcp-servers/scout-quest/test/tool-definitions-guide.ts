/**
 * Guide endpoint tool definitions for the test harness.
 *
 * Mirrors the guide:// MCP resources as Anthropic API tools so the
 * model-under-test can read scout data from the parent/scouter perspective.
 * Also includes guide mutation tools (flag_conversation, suggest_intervention, etc.).
 */

import { Db } from "mongodb";
import type { AnthropicToolDef } from "./types.js";
import { REQUIREMENT_DEFINITIONS } from "../src/constants.js";
import { STREAK_MILESTONES } from "../src/constants.js";

const REQ_TEXT = new Map(
  REQUIREMENT_DEFINITIONS.map(d => [d.req_id, { name: d.name, description: d.description }]),
);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const GUIDE_TOOL_DEFINITIONS: AnthropicToolDef[] = [
  // =========================================================================
  // READ TOOLS — mirror guide:// resources
  // =========================================================================
  {
    name: "read_linked_scouts",
    description: "List all scouts linked to this guide with summary info: name, age, troop, quest status, savings, goal.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_scout_summary",
    description: "Gamified progress overview for a linked scout: savings progress (current/target/percent), requirement counts (total/signed_off/in_progress/not_started), milestones.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_chores",
    description: "Chore streak and income data for a linked scout: current streak, next milestone, total earned, recent entries (last 7 days).",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_budget",
    description: "Budget tracking snapshot for a linked scout: weeks tracked, latest week number and running savings total.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_requirements",
    description: "All Personal Management and Family Life requirements with current status, name, and description for a linked scout.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_reminders",
    description: "Pending and overdue reminders for a linked scout.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_conversations",
    description: "Recent session summaries for a linked scout (last 10): date, topics discussed, progress made, pending items.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },
  {
    name: "read_scout_setup_status",
    description: "Onboarding checklist progress for a linked scout.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email address" },
      },
      required: ["scout_email"],
    },
  },

  // =========================================================================
  // MONITORING TOOLS
  // =========================================================================
  {
    name: "flag_conversation",
    description: "Mark a conversation for follow-up. Creates a reminder for the guide.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email" },
        reason: { type: "string", description: "Why this conversation is flagged" },
        follow_up_date: { type: "string", format: "date", description: "When to follow up (ISO date)" },
      },
      required: ["scout_email", "reason"],
    },
  },
  {
    name: "send_notification_guide",
    description: "Send a push notification to the scout.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email" },
        message: { type: "string", description: "Notification message" },
        title: { type: "string", description: "Notification title" },
      },
      required: ["scout_email", "message"],
    },
  },
  {
    name: "suggest_intervention",
    description: "Analyze scout state and propose intervention options with tradeoffs. Returns structured suggestions.",
    input_schema: {
      type: "object",
      properties: {
        scout_email: { type: "string", description: "Scout's email" },
        concern: { type: "string", description: "What the guide is worried about" },
      },
      required: ["scout_email", "concern"],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchGuideToolCall(
  db: Db,
  guideEmail: string,
  linkedScoutEmails: string[],
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const scouts = db.collection("scouts");
  const reqs = db.collection("requirements");
  const choreLogs = db.collection("chore_logs");
  const budgetEntries = db.collection("budget_entries");
  const sessionNotes = db.collection("session_notes");
  const remindersCol = db.collection("reminders");
  const setupStatusCol = db.collection("setup_status");
  const questPlans = db.collection("quest_plans");

  // Auth check helper
  function checkAuth(email: string): string | null {
    if (!linkedScoutEmails.includes(email)) {
      return JSON.stringify({ error: "Not authorized for this scout" });
    }
    return null;
  }

  switch (toolName) {
    // =====================================================================
    // READ TOOLS
    // =====================================================================

    case "read_linked_scouts": {
      if (linkedScoutEmails.length === 0) {
        return JSON.stringify({ scouts: [], message: "No scouts linked to this guide." });
      }
      const scoutDocs = await scouts.find({ email: { $in: linkedScoutEmails } }).toArray();
      return JSON.stringify({
        scouts: scoutDocs.map(s => ({
          email: s.email,
          name: s.name,
          age: s.age,
          troop: s.troop,
          quest_status: s.quest_state.quest_status,
          goal_item: s.quest_state.goal_item,
          current_savings: s.quest_state.current_savings,
          target_budget: s.quest_state.target_budget,
        })),
      });
    }

    case "read_scout_summary": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const scout = await scouts.findOne({ email });
      if (!scout) return JSON.stringify({ error: "Scout not found" });

      const allReqs = await reqs.find({ scout_email: email }).toArray();
      const plan = await questPlans.findOne({ scout_email: email });

      return JSON.stringify({
        name: scout.name,
        quest_status: scout.quest_state.quest_status,
        goal_item: scout.quest_state.goal_item,
        savings_progress: {
          current: scout.quest_state.current_savings,
          target: scout.quest_state.target_budget,
          percent: scout.quest_state.target_budget > 0
            ? Math.round((scout.quest_state.current_savings / scout.quest_state.target_budget) * 100)
            : 0,
        },
        requirements: {
          total: allReqs.length,
          signed_off: allReqs.filter(r => r.status === "signed_off").length,
          in_progress: allReqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
          not_started: allReqs.filter(r => r.status === "not_started").length,
        },
        milestones: plan?.milestones?.map((m: Record<string, unknown>) => ({
          label: m.label,
          completed: m.completed,
          category: m.category,
        })) ?? [],
      });
    }

    case "read_scout_chores": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const scout = await db.collection("scouts").findOne({ email });
      const logs = await choreLogs.find({ scout_email: email })
        .sort({ date: -1 }).limit(100).toArray();

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);

      for (const log of logs) {
        const logDate = new Date(log.date as Date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      const totalIncome = logs.reduce((sum, l) => sum + ((l.income_earned as number) || 0), 0);

      const choreList = (scout?.chore_list || []).map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        frequency: c.frequency,
        earns_income: c.earns_income ?? false,
        income_amount: c.income_amount ?? 0,
      }));

      return JSON.stringify({
        current_streak: streak,
        next_milestone: STREAK_MILESTONES.find(m => m > streak) ?? null,
        total_income_earned: Math.round(totalIncome * 100) / 100,
        available_chores: choreList,
        recent_entries: logs.slice(0, 7).map(l => ({
          date: l.date,
          chores: l.chores_completed,
          income: l.income_earned,
        })),
      });
    }

    case "read_scout_budget": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const entries = await budgetEntries.find({ scout_email: email })
        .sort({ week_number: -1 }).limit(13).toArray();

      return JSON.stringify({
        weeks_tracked: entries.length,
        latest: entries[0] ? {
          week: entries[0].week_number,
          savings: entries[0].running_savings_total,
        } : null,
      });
    }

    case "read_scout_requirements": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const allReqs = await reqs.find({ scout_email: email }).sort({ req_id: 1 }).toArray();
      return JSON.stringify(allReqs.map(r => {
        const def = REQ_TEXT.get(r.req_id);
        return {
          req_id: r.req_id,
          badge: r.badge,
          name: def?.name ?? r.req_id,
          description: def?.description ?? "",
          status: r.status,
          quest_driven: r.quest_driven,
          interaction_mode: r.interaction_mode,
          tracking_progress: r.tracking_progress,
          tracking_duration: r.tracking_duration,
        };
      }));
    }

    case "read_scout_reminders": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const active = await remindersCol.find({ scout_email: email, active: true }).toArray();
      return JSON.stringify(active.map(({ _id, ...r }) => r));
    }

    case "read_scout_conversations": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const notes = await sessionNotes.find({ scout_email: email })
        .sort({ session_date: -1 }).limit(10).toArray();

      return JSON.stringify(notes.map(({ _id, ...n }) => ({
        date: n.session_date,
        source: n.source,
        topics: n.topics_discussed,
        progress: n.progress_made,
        pending: n.pending_items,
      })));
    }

    case "read_scout_setup_status": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      const status = await setupStatusCol.findOne({ scout_email: email });
      if (!status) {
        return JSON.stringify({ status: "not_started", message: "Onboarding not started" });
      }
      const { _id, ...data } = status;
      return JSON.stringify(data);
    }

    // =====================================================================
    // MONITORING TOOLS
    // =====================================================================

    case "flag_conversation": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      await remindersCol.insertOne({
        scout_email: email,
        guide_email: guideEmail,
        type: "flagged_conversation",
        reason: args.reason as string,
        follow_up_date: args.follow_up_date ? new Date(args.follow_up_date as string) : null,
        active: true,
        created_at: new Date(),
      });

      return `Conversation flagged for follow-up. Reason: ${args.reason}`;
    }

    case "send_notification_guide": {
      // In test harness, don't actually send
      return `Notification sent to scout: ${args.title || args.message}`;
    }

    case "suggest_intervention": {
      const email = args.scout_email as string;
      const authErr = checkAuth(email);
      if (authErr) return authErr;

      // Read scout state to generate context-aware suggestions
      const scout = await scouts.findOne({ email });
      const allReqs = await reqs.find({ scout_email: email }).toArray();
      const recentLogs = await choreLogs.find({ scout_email: email })
        .sort({ date: -1 }).limit(7).toArray();

      const lastLog = recentLogs[0];
      const daysSinceLastChore = lastLog
        ? Math.floor((Date.now() - new Date(lastLog.date as Date).getTime()) / 86400000)
        : -1;

      const stuckReqs = allReqs.filter(r =>
        r.status === "in_progress" && r.updated_at &&
        (Date.now() - new Date(r.updated_at as Date).getTime()) > 14 * 86400000
      );

      return JSON.stringify({
        scout_name: scout?.name ?? "Unknown",
        concern: args.concern,
        state_summary: {
          days_since_last_chore: daysSinceLastChore,
          chore_streak: recentLogs.length,
          stuck_requirements: stuckReqs.map(r => r.req_id),
          savings_progress: scout ? Math.round((scout.quest_state.current_savings / scout.quest_state.target_budget) * 100) : 0,
        },
        suggestions: [
          {
            option: "Gentle nudge",
            description: "Send a casual notification reminding the scout about their quest progress",
            tradeoff: "Low intrusion, but may not be enough if motivation has dropped significantly",
          },
          {
            option: "Direct conversation",
            description: "Talk to the scout directly about their progress and ask what's going on",
            tradeoff: "More personal and effective, but may feel like pressure if the scout is going through something",
          },
          {
            option: "Wait and observe",
            description: "Set a reminder to check again in a few days — temporary drops are normal",
            tradeoff: "Respects scout autonomy, but delays intervention if there's a real issue",
          },
        ],
      });
    }

    default:
      return `Error: Unknown guide tool "${toolName}".`;
  }
}
