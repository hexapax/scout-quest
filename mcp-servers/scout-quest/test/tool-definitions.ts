/**
 * Builds Anthropic API tool definitions from the Scout Quest MCP tool schemas.
 *
 * Instead of spawning the MCP server as a subprocess, the harness imports
 * tool handler logic directly and presents tools in the Anthropic API
 * `tool_use` format.  This module builds the tool definition list and
 * provides a dispatcher that executes tool calls against the test MongoDB.
 */

import { MongoClient, Db } from "mongodb";
import type { AnthropicToolDef, ToolCallRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Anthropic-format tool definitions (mirroring MCP Zod schemas)
// ---------------------------------------------------------------------------

export const SCOUT_TOOL_DEFINITIONS: AnthropicToolDef[] = [
  {
    name: "log_chore",
    description: "Record completed chores for today (or a recent date). Updates savings, chore streak, and FL Req 3 progress.",
    input_schema: {
      type: "object",
      properties: {
        chores_completed: { type: "array", items: { type: "string" }, minItems: 1, description: "IDs of chores completed from the scout's chore list" },
        notes: { type: "string", description: "Optional notes about today's chores" },
        date: { type: "string", format: "date", description: "ISO date (YYYY-MM-DD) for backdating, max 3 days ago. Defaults to today." },
      },
      required: ["chores_completed"],
    },
  },
  {
    name: "log_budget_entry",
    description: "Record a weekly budget entry (income, expenses, savings) for PM Req 2c 13-week tracking.",
    input_schema: {
      type: "object",
      properties: {
        week_number: { type: "integer", minimum: 1, maximum: 13, description: "Week number (1-13)" },
        income: { type: "array", items: { type: "object", properties: { source: { type: "string" }, amount: { type: "number", minimum: 0 } }, required: ["source", "amount"] }, description: "Income sources for this week" },
        expenses: { type: "array", items: { type: "object", properties: { category: { type: "string" }, amount: { type: "number", minimum: 0 }, description: { type: "string" } }, required: ["category", "amount", "description"] }, description: "Expenses for this week" },
        savings_deposited: { type: "number", minimum: 0, description: "Amount saved this week" },
        notes: { type: "string", description: "Optional notes" },
      },
      required: ["week_number", "income", "expenses", "savings_deposited"],
    },
  },
  {
    name: "advance_requirement",
    description: "Move a requirement to the next status in the state machine. Scouts cannot set 'signed_off' (admin only).",
    input_schema: {
      type: "object",
      properties: {
        req_id: { type: "string", description: "Requirement ID (e.g. pm_1a, fl_3)" },
        new_status: { type: "string", description: "Target status" },
        notes: { type: "string", description: "Notes about this transition" },
        document: {
          type: "object",
          properties: { name: { type: "string" }, content: { type: "string" } },
          required: ["name", "content"],
          description: "Deliverable document to attach",
        },
      },
      required: ["req_id", "new_status"],
    },
  },
  {
    name: "compose_email",
    description: "Generate a mailto: link for the scout. ALWAYS includes parent/guardian in CC (YPT requirement).",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", format: "email", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
        context: { type: "string", description: "Why is this email being sent (for audit log)" },
      },
      required: ["to", "subject", "body", "context"],
    },
  },
  {
    name: "send_notification",
    description: "Send a push notification via ntfy.sh.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Notification message" },
        title: { type: "string", description: "Notification title" },
        priority: { type: "integer", minimum: 1, maximum: 5, description: "Priority 1-5 (3 = default)" },
        tags: { type: "array", items: { type: "string" }, description: "Emoji tags" },
      },
      required: ["message"],
    },
  },
  {
    name: "adjust_tone",
    description: "Adjust the AI character's tone_dial or domain_intensity. Values are clamped within the scout's configured min/max bounds.",
    input_schema: {
      type: "object",
      properties: {
        tone_dial: { type: "integer", minimum: 1, maximum: 5, description: "New tone dial value (1=minimal, 5=maximum)" },
        domain_intensity: { type: "integer", minimum: 1, maximum: 5, description: "New domain intensity (1=general, 5=deep domain)" },
        reason: { type: "string", description: "Why the adjustment is being made" },
      },
      required: ["reason"],
    },
  },
  {
    name: "setup_time_mgmt",
    description: "Create the PM Req 8 time management exercise — to-do list and weekly schedule.",
    input_schema: {
      type: "object",
      properties: {
        todo_list: {
          type: "array",
          items: { type: "object", properties: { item: { type: "string" }, priority: { type: "integer" }, category: { type: "string" } }, required: ["item", "priority", "category"] },
          description: "Prioritized to-do list for the coming week",
        },
        weekly_schedule: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string" },
              fixed_activities: { type: "array", items: { type: "object", properties: { time: { type: "string" }, activity: { type: "string" } }, required: ["time", "activity"] } },
              planned_tasks: { type: "array", items: { type: "object", properties: { time: { type: "string" }, todo_item: { type: "string" } }, required: ["time", "todo_item"] } },
            },
            required: ["day", "fixed_activities", "planned_tasks"],
          },
          description: "7-day schedule with fixed activities and planned tasks",
        },
      },
      required: ["todo_list", "weekly_schedule"],
    },
  },
  {
    name: "log_diary_entry",
    description: "Record a daily diary entry for the PM Req 8c time management exercise.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "Date or day name for this entry" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scheduled_time: { type: "string" },
              actual_time: { type: "string" },
              task: { type: "string" },
              completed: { type: "boolean" },
              notes: { type: "string" },
            },
            required: ["scheduled_time", "actual_time", "task", "completed"],
          },
          description: "Time entries comparing scheduled vs actual",
        },
      },
      required: ["day", "entries"],
    },
  },
  {
    name: "update_quest_goal",
    description: "Scout can update their quest goal item, description, or target budget. Recalculates loan_path_active.",
    input_schema: {
      type: "object",
      properties: {
        goal_item: { type: "string", description: "New goal item name" },
        goal_description: { type: "string", description: "New goal description" },
        target_budget: { type: "number", minimum: 0, description: "New target budget" },
      },
    },
  },
  {
    name: "update_quest_plan",
    description: "Update the coaching plan — priorities, strategy, milestones, scout observations, or counselor session prep.",
    input_schema: {
      type: "object",
      properties: {
        current_priorities: { type: "array", items: { type: "string" }, description: "Replace the current priority list" },
        strategy_notes: { type: "string", description: "Replace strategy notes" },
        add_milestone: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            category: { type: "string", enum: ["savings", "streak", "requirement", "counselor", "custom"] },
            target_metric: { type: "string" },
            target_date: { type: "string", format: "date" },
          },
          required: ["id", "label", "category"],
          description: "Add a new milestone to track",
        },
        complete_milestone: { type: "string", description: "Mark a milestone as completed by its ID" },
        scout_observations: {
          type: "object",
          properties: {
            engagement_patterns: { type: "string" },
            attention_notes: { type: "string" },
            motivation_triggers: { type: "string" },
            tone_notes: { type: "string" },
          },
          description: "Update observations about how the scout engages",
        },
        next_counselor_session: {
          type: "object",
          properties: {
            badge: { type: "string", enum: ["personal_management", "family_life"] },
            requirements_to_present: { type: "array", items: { type: "string" } },
            prep_notes: { type: "string" },
          },
          required: ["badge", "requirements_to_present", "prep_notes"],
          description: "Set up prep for the next counselor meeting",
        },
        reason: { type: "string", description: "Why this change is being made" },
      },
      required: ["reason"],
    },
  },
  {
    name: "log_session_notes",
    description: "Capture what happened this session — topics, progress, pending items, next focus. Call when wrapping up.",
    input_schema: {
      type: "object",
      properties: {
        topics_discussed: { type: "array", items: { type: "string" }, minItems: 1, description: "What was covered this session" },
        progress_made: { type: "string", description: "What got accomplished" },
        pending_items: { type: "array", items: { type: "string" }, description: "What the scout committed to doing" },
        next_session_focus: { type: "string", description: "Suggested focus for next session" },
      },
      required: ["topics_discussed", "progress_made"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher — executes tool calls against test MongoDB
// ---------------------------------------------------------------------------

/**
 * Dispatches an Anthropic tool_use call to the corresponding handler logic.
 *
 * This is a simplified version of the MCP tool handlers that operates
 * directly on MongoDB collections.  It does NOT import the MCP server's
 * handler functions (which are tightly coupled to the MCP SDK's
 * `server.registerTool` API).  Instead it re-implements the core logic
 * needed for testing: DB mutations, validation, and response text.
 */
export async function dispatchToolCall(
  db: Db,
  scoutEmail: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const scouts = db.collection("scouts");
  const choreLogs = db.collection("chore_logs");
  const budgetEntries = db.collection("budget_entries");
  const reqs = db.collection("requirements");
  const emailsSent = db.collection("emails_sent");
  const timeMgmt = db.collection("time_mgmt");
  const sessionNotes = db.collection("session_notes");
  const questPlans = db.collection("quest_plans");
  const planChangelog = db.collection("plan_changelog");

  switch (toolName) {
    // -----------------------------------------------------------------------
    case "log_chore": {
      const scout = await scouts.findOne({ email: scoutEmail });
      if (!scout) return "Error: Scout profile not found.";

      const choreDate = args.date ? new Date(args.date + "T00:00:00") : new Date();
      choreDate.setHours(0, 0, 0, 0);

      const nextDay = new Date(choreDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const existing = await choreLogs.findOne({ scout_email: scoutEmail, date: { $gte: choreDate, $lt: nextDay } });
      if (existing) return `Error: Chores already logged for ${choreDate.toISOString().split("T")[0]}.`;

      const choresCompleted = args.chores_completed as string[];
      let income = 0;
      const choreMap = new Map((scout.chore_list || []).map((c: Record<string, unknown>) => [c.id, c]));
      for (const id of choresCompleted) {
        const chore = choreMap.get(id) as Record<string, unknown> | undefined;
        if (chore?.earns_income && chore.income_amount) income += chore.income_amount as number;
      }

      await choreLogs.insertOne({ scout_email: scoutEmail, date: choreDate, chores_completed: choresCompleted, income_earned: income, notes: args.notes || null, created_at: new Date() });
      if (income > 0) await scouts.updateOne({ email: scoutEmail }, { $inc: { "quest_state.current_savings": income } });

      return `Chores logged for ${choreDate.toISOString().split("T")[0]}: ${choresCompleted.length} chore(s). Earned: $${income.toFixed(2)}.`;
    }

    // -----------------------------------------------------------------------
    case "log_budget_entry": {
      const weekNumber = args.week_number as number;
      const existing = await budgetEntries.findOne({ scout_email: scoutEmail, week_number: weekNumber });
      if (existing) return `Error: Week ${weekNumber} already logged.`;

      const prev = await budgetEntries.find({ scout_email: scoutEmail }).sort({ week_number: 1 }).toArray();
      const prevSavings = prev.reduce((s, e) => s + (e.savings_deposited || 0), 0);
      const savedAmt = args.savings_deposited as number;

      await budgetEntries.insertOne({
        scout_email: scoutEmail, week_number: weekNumber, week_start: new Date(),
        income: args.income, expenses: args.expenses, savings_deposited: savedAmt,
        running_savings_total: prevSavings + savedAmt, notes: args.notes || null, created_at: new Date(),
      });

      return `Week ${weekNumber} logged. Saved: $${savedAmt.toFixed(2)}. Running total: $${(prevSavings + savedAmt).toFixed(2)}.`;
    }

    // -----------------------------------------------------------------------
    case "advance_requirement": {
      const reqId = args.req_id as string;
      const newStatus = args.new_status as string;
      if (newStatus === "signed_off") return "Error: Only an admin can sign off requirements.";

      const req = await reqs.findOne({ scout_email: scoutEmail, req_id: reqId });
      if (!req) return `Error: Requirement ${reqId} not found.`;

      await reqs.updateOne({ scout_email: scoutEmail, req_id: reqId }, { $set: { status: newStatus, updated_at: new Date() } });
      return `Requirement ${reqId}: ${req.status} → ${newStatus}.`;
    }

    // -----------------------------------------------------------------------
    case "compose_email": {
      const scout = await scouts.findOne({ email: scoutEmail });
      if (!scout) return "Error: Scout profile not found.";

      const parentEmail = scout.parent_guardian?.email || "parent@unknown.com";
      const to = args.to as string;
      const subject = args.subject as string;

      await emailsSent.insertOne({
        scout_email: scoutEmail, date: new Date(), to, cc: [parentEmail],
        subject, context: args.context as string,
      });

      return `Email link generated. To: ${to}, CC: ${parentEmail} (YPT). Subject: ${subject}`;
    }

    // -----------------------------------------------------------------------
    case "adjust_tone": {
      const scout = await scouts.findOne({ email: scoutEmail });
      if (!scout) return "Error: Scout profile not found.";

      const updates: Record<string, unknown> = { "character.updated_at": new Date() };
      const changes: string[] = [];

      if (args.tone_dial !== undefined) {
        const val = Math.min(Math.max(args.tone_dial as number, scout.character.tone_min), scout.character.tone_max);
        updates["character.tone_dial"] = val;
        changes.push(`tone_dial → ${val}`);
      }
      if (args.domain_intensity !== undefined) {
        const val = Math.min(Math.max(args.domain_intensity as number, scout.character.domain_min), scout.character.domain_max);
        updates["character.domain_intensity"] = val;
        changes.push(`domain_intensity → ${val}`);
      }

      if (changes.length > 0) {
        await scouts.updateOne({ email: scoutEmail }, { $set: updates });
      }

      return changes.length > 0 ? `Adjusted: ${changes.join(", ")}. Reason: ${args.reason}` : "No changes made.";
    }

    // -----------------------------------------------------------------------
    case "setup_time_mgmt": {
      const existing = await timeMgmt.findOne({ scout_email: scoutEmail });
      if (existing) return "Error: Time management exercise already exists.";

      await timeMgmt.insertOne({
        scout_email: scoutEmail, exercise_week_start: new Date(),
        todo_list: args.todo_list, weekly_schedule: args.weekly_schedule,
        daily_diary: [],
      });

      return "Time management exercise created. Use log_diary_entry to record daily diary entries.";
    }

    // -----------------------------------------------------------------------
    case "log_diary_entry": {
      const tmDoc = await timeMgmt.findOne({ scout_email: scoutEmail });
      if (!tmDoc) return "Error: No time management exercise found. Use setup_time_mgmt first.";

      await timeMgmt.updateOne(
        { scout_email: scoutEmail },
        { $push: { daily_diary: { day: args.day, entries: args.entries } } as Record<string, unknown> },
      );

      return `Diary entry for ${args.day} recorded.`;
    }

    // -----------------------------------------------------------------------
    case "update_quest_goal": {
      const scout = await scouts.findOne({ email: scoutEmail });
      if (!scout) return "Error: Scout profile not found.";

      const updates: Record<string, unknown> = { updated_at: new Date() };
      const changes: string[] = [];

      if (args.goal_item !== undefined) { updates["quest_state.goal_item"] = args.goal_item; changes.push(`goal_item → ${args.goal_item}`); }
      if (args.goal_description !== undefined) { updates["quest_state.goal_description"] = args.goal_description; changes.push(`goal_description updated`); }
      if (args.target_budget !== undefined) {
        updates["quest_state.target_budget"] = args.target_budget;
        updates["quest_state.loan_path_active"] = (args.target_budget as number) > scout.quest_state.savings_capacity;
        changes.push(`target_budget → $${args.target_budget}`);
      }

      if (changes.length > 0) await scouts.updateOne({ email: scoutEmail }, { $set: updates });
      return changes.length > 0 ? `Quest goal updated: ${changes.join(", ")}.` : "No changes specified.";
    }

    // -----------------------------------------------------------------------
    case "update_quest_plan": {
      let plan = await questPlans.findOne({ scout_email: scoutEmail });
      if (!plan) {
        await questPlans.insertOne({
          scout_email: scoutEmail, current_priorities: [], strategy_notes: "",
          milestones: [], scout_observations: { engagement_patterns: "", attention_notes: "", motivation_triggers: "", tone_notes: "" },
          last_reviewed: new Date(), updated_at: new Date(),
        });
        plan = await questPlans.findOne({ scout_email: scoutEmail });
      }

      const updates: Record<string, unknown> = { last_reviewed: new Date(), updated_at: new Date() };
      if (args.current_priorities) updates.current_priorities = args.current_priorities;
      if (args.strategy_notes) updates.strategy_notes = args.strategy_notes;

      await questPlans.updateOne({ scout_email: scoutEmail }, { $set: updates });

      await planChangelog.insertOne({
        scout_email: scoutEmail, change_date: new Date(), source: "agent",
        field_changed: "plan_update", old_value: "", new_value: JSON.stringify(args),
        reason: args.reason as string, created_at: new Date(),
      });

      return `Quest plan updated. Reason: ${args.reason}`;
    }

    // -----------------------------------------------------------------------
    case "log_session_notes": {
      await sessionNotes.insertOne({
        scout_email: scoutEmail, session_date: new Date(), source: "agent",
        topics_discussed: args.topics_discussed as string[], progress_made: args.progress_made as string,
        pending_items: (args.pending_items as string[]) || [], next_session_focus: args.next_session_focus || null,
        created_at: new Date(),
      });

      return `Session notes logged. Topics: ${(args.topics_discussed as string[]).join(", ")}.`;
    }

    // -----------------------------------------------------------------------
    case "send_notification": {
      // In test harness, we don't actually send notifications
      return `Notification sent: ${args.title || args.message}`;
    }

    // -----------------------------------------------------------------------
    default:
      return `Error: Unknown tool "${toolName}".`;
  }
}
