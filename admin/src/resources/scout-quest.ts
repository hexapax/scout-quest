import type { ResourceWithOptions } from "adminjs";
import {
  User, Scout, Requirement, ChoreLog, BudgetEntry,
  TimeMgmt, LoanAnalysis, EmailSent, Reminder, AuditLog,
  QuestPlan, SessionNote, CronLog, PlanChangelog, SetupStatus,
} from "../models/scout-quest/index.js";

// Valid state transitions from mcp-servers/scout-quest/src/constants.ts
const VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ["in_progress", "offered", "excluded", "completed_prior"],
  offered: ["in_progress", "not_started"],
  in_progress: ["tracking", "blocked", "ready_for_review", "needs_approval"],
  tracking: ["ready_for_review", "in_progress"],
  blocked: ["in_progress"],
  needs_approval: ["in_progress", "blocked"],
  ready_for_review: ["submitted", "in_progress"],
  submitted: ["signed_off", "needs_revision"],
  needs_revision: ["in_progress"],
  signed_off: [],
  completed_prior: [],
  excluded: ["in_progress"],
};

export const scoutQuestResources: ResourceWithOptions[] = [
  {
    resource: Scout,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["name", "email", "troop", "quest_state.quest_status", "quest_state.current_savings", "updated_at"],
      showProperties: [
        "name", "email", "age", "troop", "patrol",
        "quest_state", "character", "counselors", "unit_leaders",
        "parent_guardian", "blue_card", "chore_list", "budget_projected",
        "created_at", "updated_at",
      ],
    },
  },
  {
    resource: Requirement,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "req_id", "badge", "status", "updated_at"],
      filterProperties: ["scout_email", "badge", "status", "quest_driven"],
      actions: {
        edit: {
          before: async (request, context) => {
            // Validate status transitions
            const oldStatus = context.record?.param("status");
            const newStatus = request.payload?.status;
            if (oldStatus && newStatus && oldStatus !== newStatus) {
              const allowed = VALID_TRANSITIONS[oldStatus] || [];
              if (!allowed.includes(newStatus)) {
                throw new Error(
                  `Invalid status transition: ${oldStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none (terminal state)"}`
                );
              }
            }
            return request;
          },
        },
      },
    },
  },
  {
    resource: ChoreLog,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "date", "chores_completed", "income_earned", "created_at"],
      filterProperties: ["scout_email", "date"],
      actions: {
        delete: { isAccessible: false }, // Financial records — no deletion
      },
    },
  },
  {
    resource: BudgetEntry,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "week_number", "week_start", "savings_deposited", "running_savings_total"],
      filterProperties: ["scout_email", "week_number"],
      actions: {
        delete: { isAccessible: false }, // Financial records — no deletion
      },
    },
  },
  {
    resource: TimeMgmt,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "exercise_week_start"],
    },
  },
  {
    resource: LoanAnalysis,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "shortfall", "selected_option"],
    },
  },
  {
    resource: EmailSent,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "date", "to", "subject"],
      actions: {
        edit: { isAccessible: false },   // Audit trail — read-only
        delete: { isAccessible: false },
        new: { isAccessible: false },
      },
    },
  },
  {
    resource: Reminder,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "type", "message", "active", "next_trigger"],
      filterProperties: ["scout_email", "type", "active"],
    },
  },
  {
    resource: User,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["email", "roles", "created_at"],
    },
  },
  {
    resource: AuditLog,
    options: {
      navigation: { name: "System", icon: "Settings" },
      listProperties: ["admin_email", "action", "resource", "record_id", "timestamp"],
      actions: {
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        new: { isAccessible: false },
      },
    },
  },
  {
    resource: QuestPlan,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "current_priorities", "last_reviewed", "updated_at"],
    },
  },
  {
    resource: SessionNote,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "session_date", "source", "topics_discussed"],
      filterProperties: ["scout_email", "source", "session_date"],
      actions: {
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        new: { isAccessible: false },
      },
    },
  },
  {
    resource: CronLog,
    options: {
      navigation: { name: "System", icon: "Settings" },
      listProperties: ["run_date", "scout_email", "action", "details", "model_used"],
      filterProperties: ["scout_email", "action", "run_date"],
      actions: {
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        new: { isAccessible: false },
      },
    },
  },
  {
    resource: PlanChangelog,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "change_date", "source", "field_changed", "reason"],
      filterProperties: ["scout_email", "source"],
      actions: {
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        new: { isAccessible: false },
      },
    },
  },
  {
    resource: SetupStatus,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "guide_email", "updated_at"],
    },
  },
];
