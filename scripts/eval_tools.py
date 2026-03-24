"""Tool registry for the unified eval engine.

Ports all tool definitions and handlers from the TypeScript MCP test harness
to Python with real MongoDB state management. Each test gets its own database,
enabling stateful multi-turn evaluation where tool calls mutate real data.

Tools are always registered with the API (the model sees them). Authorization
is handled by the layer config, not here. This module defines schemas,
manages per-test MongoDB state, and executes tool handlers.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database

# ---------------------------------------------------------------------------
# Requirement definitions — ported from mcp-servers/scout-quest/src/constants.ts
# ---------------------------------------------------------------------------

REQUIREMENT_DEFINITIONS: list[dict[str, str]] = [
    # Personal Management
    {"req_id": "pm_1a", "name": "Choose major expense", "description": "Choose an item that your family might want to purchase that is considered a major expense."},
    {"req_id": "pm_1b", "name": "Savings plan", "description": "Write a plan for how your family would save money for the purchase."},
    {"req_id": "pm_1c", "name": "Shopping strategy", "description": "Develop a written shopping strategy with quality research and price comparison."},
    {"req_id": "pm_2a", "name": "Prepare budget", "description": "Prepare a budget reflecting expected income, expenses, and savings for 13 weeks."},
    {"req_id": "pm_2b", "name": "Compare income vs expenses", "description": "Compare expected income with expected expenses."},
    {"req_id": "pm_2c", "name": "Track budget 13 weeks", "description": "Track and record actual income, expenses, and savings for 13 consecutive weeks."},
    {"req_id": "pm_2d", "name": "Budget review", "description": "Compare budget with actual and discuss what to do differently."},
    {"req_id": "pm_3", "name": "Money concepts discussion", "description": "Discuss 5 of 8 money-related concepts with counselor."},
    {"req_id": "pm_4", "name": "Saving vs investing", "description": "Explain saving vs investing, ROI, risk, interest, diversification, retirement."},
    {"req_id": "pm_5", "name": "Investment types", "description": "Explain stocks, mutual funds, life insurance, CDs, savings accounts, US savings bonds."},
    {"req_id": "pm_6", "name": "Insurance types", "description": "Explain auto, health, homeowner/renter, whole/term life insurance."},
    {"req_id": "pm_7", "name": "Loans and credit", "description": "Explain loans, APR, borrowing methods, card types, credit reports, reducing debt."},
    {"req_id": "pm_8a", "name": "To-do list", "description": "Write a prioritized to-do list for the coming week."},
    {"req_id": "pm_8b", "name": "7-day schedule", "description": "Make a seven-day calendar with set activities and planned tasks."},
    {"req_id": "pm_8c", "name": "Follow schedule + diary", "description": "Follow the one-week schedule and keep a daily diary."},
    {"req_id": "pm_8d", "name": "Schedule review", "description": "Review to-do list, schedule, and diary with counselor."},
    {"req_id": "pm_9", "name": "Project plan", "description": "Prepare a written project plan with goal, timeline, description, resources, budget."},
    {"req_id": "pm_10", "name": "Career exploration", "description": "Choose and discuss a career, qualifications, education, costs."},
    # Family Life
    {"req_id": "fl_1", "name": "What is a family", "description": "Prepare an outline on what a family is and discuss with counselor."},
    {"req_id": "fl_2", "name": "Importance to family", "description": "List reasons you are important to your family, discuss with parent and counselor."},
    {"req_id": "fl_3", "name": "90-day chores", "description": "Prepare list of 5+ chores, do them for 90 days, keep a record."},
    {"req_id": "fl_4", "name": "Individual home project", "description": "Decide on and carry out an individual project around the home."},
    {"req_id": "fl_5", "name": "Family project", "description": "Plan and carry out a project involving family participation."},
    {"req_id": "fl_6a", "name": "Plan family meetings", "description": "Discuss with counselor how to plan and carry out a family meeting."},
    {"req_id": "fl_6b", "name": "Family meeting topics", "description": "Prepare agenda covering 7 topics, review with parent, carry out meetings."},
    {"req_id": "fl_7", "name": "Effective parenting", "description": "Discuss understanding of effective parenting and parent's role."},
]

# Lookup map: req_id -> {name, description}
REQ_TEXT: dict[str, dict[str, str]] = {
    d["req_id"]: {"name": d["name"], "description": d["description"]}
    for d in REQUIREMENT_DEFINITIONS
}

# ---------------------------------------------------------------------------
# Tool definitions — Anthropic tool_use format
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    # ===== MUTATION TOOLS =====
    {
        "name": "log_chore",
        "description": (
            "Record completed chores for today (or a recent date). Pass ALL chore IDs "
            "completed today — if chores were already logged today, this replaces the "
            "entry with the new list. Use read_chore_streak to see available chores and "
            "their IDs. Updates savings, chore streak, and FL Req 3 progress."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "chores_completed": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "description": "IDs of chores completed from the scout's chore list",
                },
                "notes": {
                    "type": "string",
                    "description": "Optional notes about today's chores",
                },
                "date": {
                    "type": "string",
                    "format": "date",
                    "description": "ISO date (YYYY-MM-DD) for backdating, max 3 days ago. Defaults to today.",
                },
            },
            "required": ["chores_completed"],
        },
    },
    {
        "name": "log_budget_entry",
        "description": "Record a weekly budget entry (income, expenses, savings) for PM Req 2c 13-week tracking.",
        "input_schema": {
            "type": "object",
            "properties": {
                "week_number": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 13,
                    "description": "Week number (1-13)",
                },
                "income": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source": {"type": "string"},
                            "amount": {"type": "number", "minimum": 0},
                        },
                        "required": ["source", "amount"],
                    },
                    "description": "Income sources for this week",
                },
                "expenses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string"},
                            "amount": {"type": "number", "minimum": 0},
                            "description": {"type": "string"},
                        },
                        "required": ["category", "amount", "description"],
                    },
                    "description": "Expenses for this week",
                },
                "savings_deposited": {
                    "type": "number",
                    "minimum": 0,
                    "description": "Amount saved this week",
                },
                "notes": {
                    "type": "string",
                    "description": "Optional notes",
                },
            },
            "required": ["week_number", "income", "expenses", "savings_deposited"],
        },
    },
    {
        "name": "advance_requirement",
        "description": "Move a requirement to the next status in the state machine. Scouts cannot set 'signed_off' (admin only).",
        "input_schema": {
            "type": "object",
            "properties": {
                "req_id": {
                    "type": "string",
                    "description": "Requirement ID (e.g. pm_1a, fl_3)",
                },
                "new_status": {
                    "type": "string",
                    "description": "Target status",
                },
                "notes": {
                    "type": "string",
                    "description": "Notes about this transition",
                },
                "document": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["name", "content"],
                    "description": "Deliverable document to attach",
                },
            },
            "required": ["req_id", "new_status"],
        },
    },
    {
        "name": "log_diary_entry",
        "description": "Record a daily diary entry for the PM Req 8c time management exercise.",
        "input_schema": {
            "type": "object",
            "properties": {
                "day": {
                    "type": "string",
                    "description": "Date or day name for this entry",
                },
                "entries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "scheduled_time": {"type": "string"},
                            "actual_time": {"type": "string"},
                            "task": {"type": "string"},
                            "completed": {"type": "boolean"},
                            "notes": {"type": "string"},
                        },
                        "required": ["scheduled_time", "actual_time", "task", "completed"],
                    },
                    "description": "Time entries comparing scheduled vs actual",
                },
            },
            "required": ["day", "entries"],
        },
    },
    {
        "name": "log_session_notes",
        "description": "Capture what happened this session — topics, progress, pending items, next focus. Call when wrapping up.",
        "input_schema": {
            "type": "object",
            "properties": {
                "topics_discussed": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "description": "What was covered this session",
                },
                "progress_made": {
                    "type": "string",
                    "description": "What got accomplished",
                },
                "pending_items": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "What the scout committed to doing",
                },
                "next_session_focus": {
                    "type": "string",
                    "description": "Suggested focus for next session",
                },
            },
            "required": ["topics_discussed", "progress_made"],
        },
    },
    {
        "name": "update_quest_goal",
        "description": "Scout can update their quest goal item, description, or target budget. Recalculates loan_path_active.",
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_item": {
                    "type": "string",
                    "description": "New goal item name",
                },
                "goal_description": {
                    "type": "string",
                    "description": "New goal description",
                },
                "target_budget": {
                    "type": "number",
                    "minimum": 0,
                    "description": "New target budget",
                },
            },
        },
    },
    {
        "name": "update_quest_plan",
        "description": "Update the coaching plan — priorities, strategy, milestones, scout observations, or counselor session prep.",
        "input_schema": {
            "type": "object",
            "properties": {
                "current_priorities": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Replace the current priority list",
                },
                "strategy_notes": {
                    "type": "string",
                    "description": "Replace strategy notes",
                },
                "add_milestone": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string"},
                        "category": {
                            "type": "string",
                            "enum": ["savings", "streak", "requirement", "counselor", "custom"],
                        },
                        "target_metric": {"type": "string"},
                        "target_date": {"type": "string", "format": "date"},
                    },
                    "required": ["id", "label", "category"],
                    "description": "Add a new milestone to track",
                },
                "complete_milestone": {
                    "type": "string",
                    "description": "Mark a milestone as completed by its ID",
                },
                "scout_observations": {
                    "type": "object",
                    "properties": {
                        "engagement_patterns": {"type": "string"},
                        "attention_notes": {"type": "string"},
                        "motivation_triggers": {"type": "string"},
                        "tone_notes": {"type": "string"},
                    },
                    "description": "Update observations about how the scout engages",
                },
                "next_counselor_session": {
                    "type": "object",
                    "properties": {
                        "badge": {
                            "type": "string",
                            "enum": ["personal_management", "family_life"],
                        },
                        "requirements_to_present": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "prep_notes": {"type": "string"},
                    },
                    "required": ["badge", "requirements_to_present", "prep_notes"],
                    "description": "Set up prep for the next counselor meeting",
                },
                "reason": {
                    "type": "string",
                    "description": "Why this change is being made",
                },
            },
            "required": ["reason"],
        },
    },

    # ===== COMMUNICATION TOOLS =====
    {
        "name": "compose_email",
        "description": "Generate a mailto: link for the scout. ALWAYS includes parent/guardian in CC (YPT requirement).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "format": "email",
                    "description": "Recipient email address",
                },
                "subject": {
                    "type": "string",
                    "description": "Email subject line",
                },
                "body": {
                    "type": "string",
                    "description": "Email body text",
                },
                "context": {
                    "type": "string",
                    "description": "Why is this email being sent (for audit log)",
                },
            },
            "required": ["to", "subject", "body", "context"],
        },
    },
    {
        "name": "send_notification",
        "description": "Send a push notification via ntfy.sh.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "Notification message",
                },
                "title": {
                    "type": "string",
                    "description": "Notification title",
                },
                "priority": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "Priority 1-5 (3 = default)",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Emoji tags",
                },
            },
            "required": ["message"],
        },
    },

    # ===== PREFERENCE TOOLS =====
    {
        "name": "adjust_tone",
        "description": "Adjust the AI character's tone_dial or domain_intensity. Values are clamped within the scout's configured min/max bounds.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tone_dial": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "New tone dial value (1=minimal, 5=maximum)",
                },
                "domain_intensity": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "New domain intensity (1=general, 5=deep domain)",
                },
                "reason": {
                    "type": "string",
                    "description": "Why the adjustment is being made",
                },
            },
            "required": ["reason"],
        },
    },
    {
        "name": "setup_time_mgmt",
        "description": "Create the PM Req 8 time management exercise — to-do list and weekly schedule.",
        "input_schema": {
            "type": "object",
            "properties": {
                "todo_list": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "item": {"type": "string"},
                            "priority": {"type": "integer"},
                            "category": {"type": "string"},
                        },
                        "required": ["item", "priority", "category"],
                    },
                    "description": "Prioritized to-do list for the coming week",
                },
                "weekly_schedule": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "day": {"type": "string"},
                            "fixed_activities": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "time": {"type": "string"},
                                        "activity": {"type": "string"},
                                    },
                                    "required": ["time", "activity"],
                                },
                            },
                            "planned_tasks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "time": {"type": "string"},
                                        "todo_item": {"type": "string"},
                                    },
                                    "required": ["time", "todo_item"],
                                },
                            },
                        },
                        "required": ["day", "fixed_activities", "planned_tasks"],
                    },
                    "description": "7-day schedule with fixed activities and planned tasks",
                },
            },
            "required": ["todo_list", "weekly_schedule"],
        },
    },

    # ===== READ TOOLS =====
    {
        "name": "read_quest_state",
        "description": "Read THIS SCOUT's quest state: their personal goal, current savings, target budget, progress percentage. Use for personalization.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_requirements",
        "description": (
            "Read THIS SCOUT's progress on Personal Management and Family Life requirements — "
            "returns each requirement's current status (not_started, in_progress, tracking, "
            "ready_for_review, signed_off). Use this to check what the scout has completed, "
            "NOT to look up requirement text (that's in your knowledge base)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "req_id": {
                    "type": "string",
                    "description": "Optional: fetch a single requirement by ID (e.g. pm_2a)",
                },
            },
        },
    },
    {
        "name": "read_budget_summary",
        "description": (
            "Read budget tracking summary: weeks tracked, weeks remaining, "
            "projected vs actual income/expenses/savings, savings toward goal."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_chore_streak",
        "description": (
            "Read chore streak info: current streak, longest streak, total earned, "
            "whether today is logged, FL Req 3 progress."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_last_session",
        "description": "Read the most recent session notes: topics discussed, progress made, pending items, next session focus.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_quest_plan",
        "description": "Read the coaching plan: current priorities, strategy notes, milestones, scout observations, next counselor session prep.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },

    # ===== SEARCH TOOLS =====
    {
        "name": "web_search",
        "description": (
            "Search the web — LAST RESORT only. Your BSA knowledge base (in the system prompt) "
            "contains official requirements, policy, and version history. Use web_search ONLY when: "
            "(1) the knowledge base doesn't cover the topic, (2) you need very recent changes "
            "not yet in the knowledge base, or (3) you need to verify something you're unsure about. "
            "PREFER your knowledge base over web search for BSA facts."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                },
            },
            "required": ["query"],
        },
    },
]

# ---------------------------------------------------------------------------
# Tool categories
# ---------------------------------------------------------------------------

TOOL_CATEGORIES: dict[str, set[str]] = {
    "knowledge": {
        "read_quest_state", "read_requirements", "read_budget_summary",
        "read_chore_streak", "read_last_session", "read_quest_plan",
    },
    "mutation": {
        "log_chore", "log_budget_entry", "advance_requirement",
        "log_diary_entry", "log_session_notes", "update_quest_goal",
        "update_quest_plan",
    },
    "communication": {"compose_email", "send_notification"},
    "preference": {"adjust_tone", "setup_time_mgmt"},
    "search": {"web_search"},
}

ALL_TOOL_NAMES: set[str] = set().union(*TOOL_CATEGORIES.values())


# ---------------------------------------------------------------------------
# Guide endpoint tool definitions — ported from test/tool-definitions-guide.ts
# ---------------------------------------------------------------------------

GUIDE_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    # ===== READ TOOLS =====
    {
        "name": "read_linked_scouts",
        "description": "List all scouts linked to this guide with summary info: name, age, troop, quest status, savings, goal.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_scout_summary",
        "description": "Gamified progress overview for a linked scout: savings progress (current/target/percent), requirement counts (total/signed_off/in_progress/not_started), milestones.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email address",
                },
            },
            "required": ["scout_email"],
        },
    },
    {
        "name": "read_scout_chores",
        "description": "Chore streak and income data for a linked scout: current streak, next milestone, total earned, recent entries (last 7 days).",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email address",
                },
            },
            "required": ["scout_email"],
        },
    },
    {
        "name": "read_scout_budget",
        "description": "Budget tracking snapshot for a linked scout: weeks tracked, latest week number and running savings total.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email address",
                },
            },
            "required": ["scout_email"],
        },
    },
    {
        "name": "read_scout_requirements",
        "description": "All Personal Management and Family Life requirements with current status, name, and description for a linked scout.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email address",
                },
            },
            "required": ["scout_email"],
        },
    },

    # ===== MONITORING TOOLS =====
    {
        "name": "flag_conversation",
        "description": "Mark a conversation for follow-up. Creates a reminder for the guide.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email",
                },
                "reason": {
                    "type": "string",
                    "description": "Why this conversation is flagged",
                },
                "follow_up_date": {
                    "type": "string",
                    "format": "date",
                    "description": "When to follow up (ISO date)",
                },
            },
            "required": ["scout_email", "reason"],
        },
    },
    {
        "name": "adjust_character",
        "description": "Adjust a scout's AI character settings: tone_dial (1-5) and/or domain_intensity (1-5). Used by guides to fine-tune the scout's coaching experience.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scout_email": {
                    "type": "string",
                    "description": "Scout's email",
                },
                "tone_dial": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "New tone dial value (1=minimal personality, 5=maximum personality)",
                },
                "domain_intensity": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 5,
                    "description": "New domain intensity (1=general coaching, 5=deep gaming overlay)",
                },
                "reason": {
                    "type": "string",
                    "description": "Why the adjustment is being made",
                },
            },
            "required": ["scout_email", "reason"],
        },
    },
]

GUIDE_TOOL_CATEGORIES: dict[str, set[str]] = {
    "knowledge": {
        "read_linked_scouts", "read_scout_summary", "read_scout_chores",
        "read_scout_budget", "read_scout_requirements",
    },
    "monitoring": {"flag_conversation", "adjust_character"},
}

ALL_GUIDE_TOOL_NAMES: set[str] = set().union(*GUIDE_TOOL_CATEGORIES.values())


# ---------------------------------------------------------------------------
# Default fixture data — ported from profiles.ts
# ---------------------------------------------------------------------------

def _build_default_scout() -> dict[str, Any]:
    """Build the test scout profile, matching TEST_SCOUT from profiles.ts."""
    return {
        "email": "will@test.scoutquest.app",
        "name": "Test Scout Will",
        "age": 14,
        "troop": "T999",
        "patrol": "Eagles",
        "interests": {
            "likes": ["gaming", "building PCs", "coding"],
            "dislikes": ["running", "cleaning"],
            "motivations": ["save up for a gaming PC", "finish Personal Management"],
        },
        "quest_state": {
            "goal_item": "Gaming PC",
            "goal_description": "Build a custom gaming PC with RTX 4070 and Ryzen 7",
            "target_budget": 800,
            "savings_capacity": 50,
            "loan_path_active": False,
            "quest_start_date": datetime(2026, 1, 15),
            "current_savings": 120,
            "quest_status": "active",
        },
        "character": {
            "base": "pathfinder",
            "quest_overlay": "gamer_hardware",
            "tone_dial": 3,
            "domain_intensity": 3,
            "tone_min": 1,
            "tone_max": 5,
            "domain_min": 1,
            "domain_max": 5,
            "sm_notes": "",
            "parent_notes": "Keep it encouraging but don't overdo the gaming references",
            "avoid": ["cringe memes", "excessive emoji"],
            "calibration_review_enabled": True,
            "calibration_review_weeks": [4, 8],
        },
        "counselors": {
            "personal_management": {
                "name": "Mr. Chen",
                "email": "chen@example.com",
                "preferred_contact": "email",
            },
            "family_life": {
                "name": "Mrs. Johnson",
                "email": "johnson@example.com",
                "preferred_contact": "email",
            },
        },
        "unit_leaders": {
            "scoutmaster": {
                "name": "SM Rodriguez",
                "email": "sm@troop999.example.com",
                "preferred_contact": "email",
            },
        },
        "parent_guardian": {
            "name": "Sarah Thompson",
            "email": "parent@example.com",
            "preferred_contact": "email",
        },
        "guide_email": "test-guide@scoutquest.test",
        "blue_card": {
            "personal_management": {
                "requested_date": datetime(2026, 1, 10),
                "approved_date": datetime(2026, 1, 12),
                "approved_by": "SM Rodriguez",
            },
            "family_life": {
                "requested_date": datetime(2026, 1, 10),
                "approved_date": datetime(2026, 1, 12),
                "approved_by": "SM Rodriguez",
            },
        },
        "chore_list": [
            {"id": "dishes", "name": "Wash dishes", "frequency": "daily", "earns_income": True, "income_amount": 2},
            {"id": "trash", "name": "Take out trash", "frequency": "daily", "earns_income": False, "income_amount": None},
            {"id": "laundry", "name": "Do laundry", "frequency": "weekly", "earns_income": True, "income_amount": 5},
        ],
        "budget_projected": {
            "income_sources": [
                {"name": "Chore income", "weekly_amount": 19},
                {"name": "Allowance", "weekly_amount": 10},
            ],
            "expense_categories": [
                {"name": "Snacks", "weekly_amount": 5},
                {"name": "Games (digital)", "weekly_amount": 3},
            ],
            "savings_target_weekly": 21,
        },
        "session_limits": {
            "max_minutes_per_day": 30,
            "allowed_days": ["Monday", "Wednesday", "Friday", "Saturday"],
        },
        "created_at": datetime(2026, 1, 15),
        "updated_at": datetime(2026, 1, 15),
    }


def _build_default_requirements() -> list[dict[str, Any]]:
    """Build test requirements, matching buildTestRequirements() from profiles.ts."""
    now = datetime.now(timezone.utc)
    base: dict[str, Any] = {
        "notes": "",
        "updated_at": now,
    }

    return [
        # PM requirements
        {**base, "req_id": "pm_1a", "badge": "personal_management", "status": "signed_off", "quest_driven": True, "interaction_mode": "email"},
        {**base, "req_id": "pm_1b", "badge": "personal_management", "status": "in_progress", "quest_driven": True, "interaction_mode": "email"},
        {**base, "req_id": "pm_1c", "badge": "personal_management", "status": "not_started", "quest_driven": True, "interaction_mode": "email"},
        {**base, "req_id": "pm_2a", "badge": "personal_management", "status": "in_progress", "quest_driven": True, "interaction_mode": "digital_submission"},
        {**base, "req_id": "pm_2b", "badge": "personal_management", "status": "not_started", "quest_driven": True, "interaction_mode": "email"},
        {**base, "req_id": "pm_2c", "badge": "personal_management", "status": "tracking", "quest_driven": True, "interaction_mode": "digital_submission",
         "tracking_start_date": datetime(2026, 2, 1), "tracking_duration": {"weeks": 13}, "tracking_progress": 4},
        {**base, "req_id": "pm_2d", "badge": "personal_management", "status": "not_started", "quest_driven": True, "interaction_mode": "in_person"},
        {**base, "req_id": "pm_3", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "pm_4", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "pm_5", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "email"},
        {**base, "req_id": "pm_6", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "email"},
        {**base, "req_id": "pm_7", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "email"},
        {**base, "req_id": "pm_8a", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "digital_submission"},
        {**base, "req_id": "pm_8b", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "digital_submission"},
        {**base, "req_id": "pm_8c", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "digital_submission"},
        {**base, "req_id": "pm_8d", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "pm_9", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "email"},
        {**base, "req_id": "pm_10", "badge": "personal_management", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        # FL requirements
        {**base, "req_id": "fl_1", "badge": "family_life", "status": "in_progress", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "fl_2", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "fl_3", "badge": "family_life", "status": "tracking", "quest_driven": True, "interaction_mode": "digital_submission",
         "tracking_start_date": datetime(2026, 2, 1), "tracking_duration": {"days": 90}, "tracking_progress": 28},
        {**base, "req_id": "fl_4", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "parent_verify"},
        {**base, "req_id": "fl_5", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "fl_6a", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
        {**base, "req_id": "fl_6b", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "parent_verify"},
        {**base, "req_id": "fl_7", "badge": "family_life", "status": "not_started", "quest_driven": False, "interaction_mode": "in_person"},
    ]


def _build_default_chore_history() -> list[dict[str, Any]]:
    """Build 10 consecutive days of chore history ending yesterday.

    Matches buildTestChoreHistory() from profiles.ts.
    """
    entries: list[dict[str, Any]] = []
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    for i in range(1, 11):
        date = today - timedelta(days=i)
        entries.append({
            "date": date,
            "chores_completed": ["dishes", "trash"],
            "income_earned": 2,
            "notes": None,
            "created_at": date,
        })
    return entries


def _build_default_budget_history() -> list[dict[str, Any]]:
    """Build 4 weeks of budget entries.

    Matches buildTestBudgetHistory() from profiles.ts.
    """
    return [
        {
            "week_number": week,
            "week_start": datetime(2026, 2, week),
            "income": [{"source": "Chore income", "amount": 19}, {"source": "Allowance", "amount": 10}],
            "expenses": [{"category": "Snacks", "amount": 5, "description": "Weekly snacks"},
                         {"category": "Games", "amount": 3, "description": "Steam sale"}],
            "savings_deposited": 21,
            "running_savings_total": week * 21,
            "notes": None,
            "created_at": datetime(2026, 2, week),
        }
        for week in [1, 2, 3, 4]
    ]


DEFAULT_FIXTURES: dict[str, Any] = {
    "scout": _build_default_scout(),
    "requirements": _build_default_requirements(),
    "chore_logs": _build_default_chore_history(),
    "budget_entries": _build_default_budget_history(),
    "session_notes": [
        {
            "session_date": datetime(2026, 3, 22, 15, 0, 0),
            "source": "agent",
            "topics_discussed": ["chore streak progress", "budget week 4 review", "PM 2c tracking"],
            "progress_made": "Logged week 4 budget. Chore streak at 10 days. Discussed savings pace.",
            "pending_items": ["Log chores this weekend", "Start working on PM 5 goals essay"],
            "next_session_focus": "Review PM 5 essay draft and plan counselor meeting for PM 1b sign-off",
            "created_at": datetime(2026, 3, 22, 15, 0, 0),
        },
    ],
}


# ---------------------------------------------------------------------------
# TestState — per-test MongoDB state management
# ---------------------------------------------------------------------------

class TestState:
    """Manages per-test MongoDB state. Each test gets its own database."""

    def __init__(
        self,
        test_id: str,
        scout_email: str = "will@test.scoutquest.app",
        mongo_uri: str = "mongodb://localhost:27017",
    ):
        self.client = MongoClient(mongo_uri)
        self.db_name = f"scoutquest_test_{test_id}"
        self.db: Database = self.client[self.db_name]
        self.scout_email = scout_email

    def seed(self, fixtures: dict[str, Any] | None = None) -> None:
        """Drop and recreate with fixture data.

        If fixtures is provided, it is MERGED with DEFAULT_FIXTURES:
        - 'scout' dict: shallow-merged (overrides individual keys)
        - 'requirements' list: extended (adds to defaults)
        - Other keys: replaced if present, defaults used otherwise
        """
        self.client.drop_database(self.db_name)
        # Re-acquire reference after drop
        self.db = self.client[self.db_name]

        if fixtures is None:
            data = DEFAULT_FIXTURES
        else:
            data = dict(DEFAULT_FIXTURES)
            for key, val in fixtures.items():
                if key == "scout" and isinstance(val, dict):
                    # Shallow-merge scout fields
                    data["scout"] = {**DEFAULT_FIXTURES.get("scout", {}), **val}
                elif key == "requirements" and isinstance(val, list):
                    # Extend default requirements with extra badges
                    data["requirements"] = list(DEFAULT_FIXTURES.get("requirements", [])) + val
                else:
                    data[key] = val

        # Insert scout profile
        if data.get("scout"):
            self.db.scouts.insert_one({**data["scout"], "email": self.scout_email})

        # Insert requirements
        if data.get("requirements"):
            for req in data["requirements"]:
                self.db.requirements.insert_one({**req, "scout_email": self.scout_email})

        # Insert chore logs
        if data.get("chore_logs"):
            for log in data["chore_logs"]:
                self.db.chore_logs.insert_one({**log, "scout_email": self.scout_email})

        # Insert budget entries
        if data.get("budget_entries"):
            for entry in data["budget_entries"]:
                self.db.budget_entries.insert_one({**entry, "scout_email": self.scout_email})

        # Insert session notes
        if data.get("session_notes"):
            for note in data["session_notes"]:
                self.db.session_notes.insert_one({**note, "scout_email": self.scout_email})

    def snapshot(self) -> dict[str, Any]:
        """Capture current state for comparison."""
        scout = self.db.scouts.find_one({"email": self.scout_email}, {"_id": 0})
        return {
            "scout": scout,
            "chore_log_count": self.db.chore_logs.count_documents({"scout_email": self.scout_email}),
            "budget_entry_count": self.db.budget_entries.count_documents({"scout_email": self.scout_email}),
            "requirements": list(self.db.requirements.find({"scout_email": self.scout_email}, {"_id": 0})),
            "session_notes": list(
                self.db.session_notes.find({"scout_email": self.scout_email}, {"_id": 0})
                .sort("session_date", -1)
            ),
            "savings": scout.get("quest_state", {}).get("current_savings", 0) if scout else 0,
        }

    def apply_mutation(self, mutation: dict) -> None:
        """Apply a pre-step mutation to the test database.

        Used in chain steps to simulate external events (time passing,
        counselor sign-off, etc.) between steps.

        Format: {"collection": "requirements", "filter": {...}, "update": {"$set": {...}}}
        Or for inserts: {"collection": "chore_logs", "insert": {...}}
        """
        coll_name = mutation.get("collection", "")
        coll = self.db[coll_name]

        if "insert" in mutation:
            doc = {**mutation["insert"], "scout_email": self.scout_email}
            coll.insert_one(doc)
        elif "filter" in mutation and "update" in mutation:
            filt = mutation["filter"]
            if "scout_email" not in filt:
                filt["scout_email"] = self.scout_email
            coll.update_one(filt, mutation["update"])

    @staticmethod
    def diff_snapshots(before: dict, after: dict) -> dict:
        """Compute a human-readable diff between two snapshots."""
        diffs = {}

        # Count changes
        for key in ["chore_log_count", "budget_entry_count"]:
            b, a = before.get(key, 0), after.get(key, 0)
            if a != b:
                diffs[key] = {"before": b, "after": a, "delta": a - b}

        # Savings
        b_sav, a_sav = before.get("savings", 0), after.get("savings", 0)
        if a_sav != b_sav:
            diffs["savings"] = {"before": b_sav, "after": a_sav, "delta": a_sav - b_sav}

        # Requirement status changes
        b_reqs = {r["req_id"]: r.get("status") for r in before.get("requirements", [])}
        a_reqs = {r["req_id"]: r.get("status") for r in after.get("requirements", [])}
        req_changes = {}
        for rid in set(b_reqs) | set(a_reqs):
            bs, astat = b_reqs.get(rid), a_reqs.get(rid)
            if bs != astat:
                req_changes[rid] = {"before": bs, "after": astat}
        if req_changes:
            diffs["requirements"] = req_changes

        # Session notes count
        b_notes = len(before.get("session_notes", []))
        a_notes = len(after.get("session_notes", []))
        if a_notes != b_notes:
            diffs["session_notes_count"] = {"before": b_notes, "after": a_notes, "delta": a_notes - b_notes}

        return diffs

    def cleanup(self) -> None:
        """Drop the test database."""
        self.client.drop_database(self.db_name)


# ---------------------------------------------------------------------------
# Tool handlers — ported from TypeScript dispatchToolCall in tool-definitions.ts
# ---------------------------------------------------------------------------

def handle_log_chore(db: Database, scout_email: str, args: dict) -> str:
    """Record completed chores. Insert/update chore_logs, update savings."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return "Error: Scout profile not found."

    # Parse date
    if args.get("date"):
        chore_date = datetime.strptime(args["date"], "%Y-%m-%d")
    else:
        chore_date = datetime.now(timezone.utc)
    chore_date = chore_date.replace(hour=0, minute=0, second=0, microsecond=0)

    next_day = chore_date + timedelta(days=1)
    chores_completed: list[str] = args.get("chores_completed", [])

    # Calculate income from chore_list
    income = 0.0
    chore_map: dict[str, dict] = {c["id"]: c for c in (scout.get("chore_list") or [])}
    for chore_id in chores_completed:
        chore = chore_map.get(chore_id)
        if chore and chore.get("earns_income") and chore.get("income_amount"):
            income += chore["income_amount"]

    # Check for existing entry on this date — update if found
    existing = db.chore_logs.find_one({
        "scout_email": scout_email,
        "date": {"$gte": chore_date, "$lt": next_day},
    })

    date_str = chore_date.strftime("%Y-%m-%d")

    if existing:
        prev_income = existing.get("income_earned", 0) or 0
        income_diff = income - prev_income
        db.chore_logs.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "chores_completed": chores_completed,
                "income_earned": income,
                "notes": args.get("notes"),
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        if income_diff != 0:
            db.scouts.update_one(
                {"email": scout_email},
                {"$inc": {"quest_state.current_savings": income_diff}},
            )
        return (
            f"Chores updated for {date_str}: {len(chores_completed)} chore(s). "
            f"Earned: ${income:.2f} (updated from ${prev_income:.2f})."
        )

    # New entry
    db.chore_logs.insert_one({
        "scout_email": scout_email,
        "date": chore_date,
        "chores_completed": chores_completed,
        "income_earned": income,
        "notes": args.get("notes"),
        "created_at": datetime.now(timezone.utc),
    })
    if income > 0:
        db.scouts.update_one(
            {"email": scout_email},
            {"$inc": {"quest_state.current_savings": income}},
        )

    return f"Chores logged for {date_str}: {len(chores_completed)} chore(s). Earned: ${income:.2f}."


def handle_log_budget_entry(db: Database, scout_email: str, args: dict) -> str:
    """Record a weekly budget entry."""
    week_number = args.get("week_number", 0)

    existing = db.budget_entries.find_one({"scout_email": scout_email, "week_number": week_number})
    if existing:
        return f"Error: Week {week_number} already logged."

    # Calculate running savings total
    prev_entries = list(db.budget_entries.find({"scout_email": scout_email}).sort("week_number", 1))
    prev_savings = sum(e.get("savings_deposited", 0) for e in prev_entries)
    saved_amt = args.get("savings_deposited", 0)

    db.budget_entries.insert_one({
        "scout_email": scout_email,
        "week_number": week_number,
        "week_start": datetime.now(timezone.utc),
        "income": args.get("income", []),
        "expenses": args.get("expenses", []),
        "savings_deposited": saved_amt,
        "running_savings_total": prev_savings + saved_amt,
        "notes": args.get("notes"),
        "created_at": datetime.now(timezone.utc),
    })

    return f"Week {week_number} logged. Saved: ${saved_amt:.2f}. Running total: ${prev_savings + saved_amt:.2f}."


def handle_advance_requirement(db: Database, scout_email: str, args: dict) -> str:
    """Move a requirement to the next status. Reject 'signed_off'."""
    req_id = args.get("req_id", "")
    new_status = args.get("new_status", "")

    if new_status == "signed_off":
        return "Error: Only an admin can sign off requirements."

    req = db.requirements.find_one({"scout_email": scout_email, "req_id": req_id})
    if not req:
        return f"Error: Requirement {req_id} not found."

    old_status = req.get("status", "not_started")
    db.requirements.update_one(
        {"scout_email": scout_email, "req_id": req_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc)}},
    )

    return f"Requirement {req_id}: {old_status} \u2192 {new_status}."


def handle_compose_email(db: Database, scout_email: str, args: dict) -> str:
    """Generate a mailto: link. Always CC parent. MOCK - never sends."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return "Error: Scout profile not found."

    parent_email = (scout.get("parent_guardian") or {}).get("email", "parent@unknown.com")
    to = args.get("to", "")
    subject = args.get("subject", "")

    db.emails_sent.insert_one({
        "scout_email": scout_email,
        "date": datetime.now(timezone.utc),
        "to": to,
        "cc": [parent_email],
        "subject": subject,
        "context": args.get("context", ""),
    })

    return f"Email link generated. To: {to}, CC: {parent_email} (YPT). Subject: {subject}"


def handle_send_notification(db: Database, scout_email: str, args: dict) -> str:
    """Send a push notification. MOCK - never sends."""
    return f"Notification sent: {args.get('title') or args.get('message', '')}"


def handle_adjust_tone(db: Database, scout_email: str, args: dict) -> str:
    """Adjust tone_dial or domain_intensity, clamped to min/max."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return "Error: Scout profile not found."

    char = scout.get("character", {})
    updates: dict[str, Any] = {"character.updated_at": datetime.now(timezone.utc)}
    changes: list[str] = []

    if args.get("tone_dial") is not None:
        val = min(max(args["tone_dial"], char.get("tone_min", 1)), char.get("tone_max", 5))
        updates["character.tone_dial"] = val
        changes.append(f"tone_dial \u2192 {val}")

    if args.get("domain_intensity") is not None:
        val = min(max(args["domain_intensity"], char.get("domain_min", 1)), char.get("domain_max", 5))
        updates["character.domain_intensity"] = val
        changes.append(f"domain_intensity \u2192 {val}")

    if changes:
        db.scouts.update_one({"email": scout_email}, {"$set": updates})

    return f"Adjusted: {', '.join(changes)}. Reason: {args.get('reason', '')}" if changes else "No changes made."


def handle_setup_time_mgmt(db: Database, scout_email: str, args: dict) -> str:
    """Create PM Req 8 time management exercise."""
    existing = db.time_mgmt.find_one({"scout_email": scout_email})
    if existing:
        return "Error: Time management exercise already exists."

    db.time_mgmt.insert_one({
        "scout_email": scout_email,
        "exercise_week_start": datetime.now(timezone.utc),
        "todo_list": args.get("todo_list", []),
        "weekly_schedule": args.get("weekly_schedule", []),
        "daily_diary": [],
    })

    return "Time management exercise created. Use log_diary_entry to record daily diary entries."


def handle_log_diary_entry(db: Database, scout_email: str, args: dict) -> str:
    """Record a daily diary entry for PM Req 8c."""
    tm_doc = db.time_mgmt.find_one({"scout_email": scout_email})
    if not tm_doc:
        return "Error: No time management exercise found. Use setup_time_mgmt first."

    db.time_mgmt.update_one(
        {"scout_email": scout_email},
        {"$push": {"daily_diary": {"day": args.get("day", ""), "entries": args.get("entries", [])}}},
    )

    return f"Diary entry for {args.get('day', '')} recorded."


def handle_update_quest_goal(db: Database, scout_email: str, args: dict) -> str:
    """Update quest goal item, description, or target budget."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return "Error: Scout profile not found."

    updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    changes: list[str] = []

    if args.get("goal_item") is not None:
        updates["quest_state.goal_item"] = args["goal_item"]
        changes.append(f"goal_item \u2192 {args['goal_item']}")

    if args.get("goal_description") is not None:
        updates["quest_state.goal_description"] = args["goal_description"]
        changes.append("goal_description updated")

    if args.get("target_budget") is not None:
        updates["quest_state.target_budget"] = args["target_budget"]
        updates["quest_state.loan_path_active"] = args["target_budget"] > scout.get("quest_state", {}).get("savings_capacity", 0)
        changes.append(f"target_budget \u2192 ${args['target_budget']}")

    if changes:
        db.scouts.update_one({"email": scout_email}, {"$set": updates})

    return f"Quest goal updated: {', '.join(changes)}." if changes else "No changes specified."


def handle_update_quest_plan(db: Database, scout_email: str, args: dict) -> str:
    """Update the coaching plan."""
    plan = db.quest_plans.find_one({"scout_email": scout_email})
    if not plan:
        db.quest_plans.insert_one({
            "scout_email": scout_email,
            "current_priorities": [],
            "strategy_notes": "",
            "milestones": [],
            "scout_observations": {
                "engagement_patterns": "",
                "attention_notes": "",
                "motivation_triggers": "",
                "tone_notes": "",
            },
            "last_reviewed": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        })

    updates: dict[str, Any] = {
        "last_reviewed": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    if args.get("current_priorities"):
        updates["current_priorities"] = args["current_priorities"]
    if args.get("strategy_notes"):
        updates["strategy_notes"] = args["strategy_notes"]

    db.quest_plans.update_one({"scout_email": scout_email}, {"$set": updates})

    # Log change
    db.plan_changelog.insert_one({
        "scout_email": scout_email,
        "change_date": datetime.now(timezone.utc),
        "source": "agent",
        "field_changed": "plan_update",
        "old_value": "",
        "new_value": json.dumps(args, default=str),
        "reason": args.get("reason", ""),
        "created_at": datetime.now(timezone.utc),
    })

    return f"Quest plan updated. Reason: {args.get('reason', '')}"


def handle_log_session_notes(db: Database, scout_email: str, args: dict) -> str:
    """Capture session notes."""
    topics = args.get("topics_discussed", [])

    db.session_notes.insert_one({
        "scout_email": scout_email,
        "session_date": datetime.now(timezone.utc),
        "source": "agent",
        "topics_discussed": topics,
        "progress_made": args.get("progress_made", ""),
        "pending_items": args.get("pending_items", []),
        "next_session_focus": args.get("next_session_focus"),
        "created_at": datetime.now(timezone.utc),
    })

    return f"Session notes logged. Topics: {', '.join(topics)}."


def handle_read_quest_state(db: Database, scout_email: str, args: dict) -> str:
    """Read quest state: goal, savings, target, progress."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return json.dumps({"error": "Scout not found"})

    qs = scout.get("quest_state", {})
    quest_start = qs.get("quest_start_date")
    if quest_start:
        days_since_start = (datetime.now(timezone.utc) - quest_start.replace(tzinfo=timezone.utc) if quest_start.tzinfo is None else datetime.now(timezone.utc) - quest_start).days
    else:
        days_since_start = 0

    target = qs.get("target_budget", 0)
    current = qs.get("current_savings", 0)
    budget_remaining = target - current

    return json.dumps({
        "goal_item": qs.get("goal_item"),
        "goal_description": qs.get("goal_description"),
        "target_budget": target,
        "current_savings": current,
        "quest_status": qs.get("quest_status"),
        "days_since_start": max(0, days_since_start),
        "budget_remaining": max(0, budget_remaining),
        "progress_percent": round((current / target) * 100) if target > 0 else 0,
    })


def handle_read_requirements(db: Database, scout_email: str, args: dict) -> str:
    """Read requirements with current status."""
    if args.get("req_id"):
        req = db.requirements.find_one({"scout_email": scout_email, "req_id": args["req_id"]})
        if not req:
            return json.dumps({"error": f"Requirement {args['req_id']} not found"})
        # Remove _id and add name/description from constants
        result = {k: v for k, v in req.items() if k != "_id"}
        defn = REQ_TEXT.get(args["req_id"])
        result["name"] = defn["name"] if defn else req.get("req_id", "")
        result["description"] = defn["description"] if defn else ""
        return json.dumps(result, default=str)

    all_reqs = list(db.requirements.find({"scout_email": scout_email}).sort("req_id", 1))
    return json.dumps([
        {
            "req_id": r.get("req_id"),
            "badge": r.get("badge"),
            "name": REQ_TEXT.get(r.get("req_id", ""), {}).get("name", r.get("req_id", "")),
            "description": REQ_TEXT.get(r.get("req_id", ""), {}).get("description", ""),
            "status": r.get("status"),
            "quest_driven": r.get("quest_driven"),
            "interaction_mode": r.get("interaction_mode"),
            "tracking_progress": r.get("tracking_progress"),
            "tracking_duration": r.get("tracking_duration"),
        }
        for r in all_reqs
    ], default=str)


def handle_read_budget_summary(db: Database, scout_email: str, args: dict) -> str:
    """Read budget tracking summary with projections."""
    scout = db.scouts.find_one({"email": scout_email})
    projected = scout.get("budget_projected") if scout else None

    entries = list(db.budget_entries.find({"scout_email": scout_email}).sort("week_number", 1))

    actual_income = 0.0
    actual_expenses = 0.0
    actual_savings = 0.0

    for e in entries:
        for inc in (e.get("income") or []):
            actual_income += inc.get("amount", 0)
        for exp in (e.get("expenses") or []):
            actual_expenses += exp.get("amount", 0)
        actual_savings += e.get("savings_deposited", 0)

    projected_weekly_income = 0.0
    projected_weekly_expenses = 0.0
    if projected:
        for src in (projected.get("income_sources") or []):
            projected_weekly_income += src.get("weekly_amount", 0)
        for cat in (projected.get("expense_categories") or []):
            projected_weekly_expenses += cat.get("weekly_amount", 0)

    return json.dumps({
        "weeks_tracked": len(entries),
        "weeks_remaining": max(0, 13 - len(entries)),
        "projected": {
            "weekly_income": projected_weekly_income,
            "weekly_expenses": projected_weekly_expenses,
            "weekly_savings_target": projected.get("savings_target_weekly"),
        } if projected else None,
        "actual": {
            "total_income": round(actual_income * 100) / 100,
            "total_expenses": round(actual_expenses * 100) / 100,
            "total_savings": round(actual_savings * 100) / 100,
        },
        "savings_toward_goal": scout.get("quest_state", {}).get("current_savings", 0) if scout else 0,
        "goal_target": scout.get("quest_state", {}).get("target_budget", 0) if scout else 0,
    })


def handle_read_chore_streak(db: Database, scout_email: str, args: dict) -> str:
    """Read chore streak: current, longest, total earned, today's status."""
    scout = db.scouts.find_one({"email": scout_email})
    logs = list(db.chore_logs.find({"scout_email": scout_email}).sort("date", -1))

    current_streak = 0
    longest_streak = 0
    total_earned = 0.0
    logged_today = False

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    if logs:
        latest_date = logs[0].get("date", today)
        if isinstance(latest_date, datetime):
            latest_date = latest_date.replace(hour=0, minute=0, second=0, microsecond=0)
            if latest_date.tzinfo is None:
                latest_date = latest_date.replace(tzinfo=timezone.utc)
        logged_today = latest_date == today

        expected_date = today if logged_today else (today - timedelta(days=1))
        streak = 0

        for log in logs:
            log_date = log.get("date", today)
            if isinstance(log_date, datetime):
                log_date = log_date.replace(hour=0, minute=0, second=0, microsecond=0)
                if log_date.tzinfo is None:
                    log_date = log_date.replace(tzinfo=timezone.utc)

            total_earned += log.get("income_earned", 0) or 0

            if log_date == expected_date:
                streak += 1
                expected_date = expected_date - timedelta(days=1)
            elif log_date < expected_date:
                if streak > longest_streak:
                    longest_streak = streak
                break

        current_streak = streak
        if current_streak > longest_streak:
            longest_streak = current_streak

    # FL Req 3 progress
    fl_req_3 = db.requirements.find_one({"scout_email": scout_email, "req_id": "fl_3"})

    # Include chore list so the coach knows valid IDs
    chore_list = [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "frequency": c.get("frequency"),
            "earns_income": c.get("earns_income", False),
            "income_amount": c.get("income_amount", 0),
        }
        for c in (scout.get("chore_list") or [] if scout else [])
    ]

    return json.dumps({
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "total_earned": round(total_earned * 100) / 100,
        "logged_today": logged_today,
        "total_log_entries": len(logs),
        "available_chores": chore_list,
        "fl_req_3": {
            "days_completed": fl_req_3.get("tracking_progress", 0) if fl_req_3 else 0,
            "days_remaining": max(0, 90 - (fl_req_3.get("tracking_progress", 0) if fl_req_3 else 0)),
            "status": fl_req_3.get("status", "not_started") if fl_req_3 else "not_started",
        },
    })


def handle_read_last_session(db: Database, scout_email: str, args: dict) -> str:
    """Read most recent session notes."""
    last_session = db.session_notes.find_one(
        {"scout_email": scout_email},
        sort=[("session_date", -1)],
    )
    if not last_session:
        return json.dumps({"status": "no_sessions"})

    return json.dumps({
        "session_date": last_session.get("session_date"),
        "source": last_session.get("source"),
        "topics_discussed": last_session.get("topics_discussed"),
        "progress_made": last_session.get("progress_made"),
        "pending_items": last_session.get("pending_items"),
        "next_session_focus": last_session.get("next_session_focus"),
    }, default=str)


def handle_read_quest_plan(db: Database, scout_email: str, args: dict) -> str:
    """Read coaching plan."""
    plan = db.quest_plans.find_one({"scout_email": scout_email})
    if not plan:
        return json.dumps({"status": "no_plan"})

    result = {k: v for k, v in plan.items() if k not in ("_id", "scout_email")}
    return json.dumps(result, default=str)


def handle_web_search(db: Database, scout_email: str, args: dict) -> str:
    """Search the web using real Brave API."""
    query = args.get("query", "")
    try:
        from perspectives.knowledge import _do_brave_search
        return _do_brave_search(query)
    except Exception as e:
        return f"Web search failed: {e}"


# ---------------------------------------------------------------------------
# Guide endpoint handlers
# ---------------------------------------------------------------------------

def handle_read_linked_scouts(db: Database, scout_email: str, args: dict) -> str:
    """Return list of scouts linked to this guide. Uses the seeded scout profile."""
    scout = db.scouts.find_one({"email": scout_email})
    if not scout:
        return json.dumps({"scouts": [], "message": "No scouts linked to this guide."})

    return json.dumps({"scouts": [{
        "email": scout.get("email"),
        "name": scout.get("name"),
        "age": scout.get("age"),
        "troop": scout.get("troop"),
        "quest_status": scout.get("quest_state", {}).get("quest_status"),
        "goal_item": scout.get("quest_state", {}).get("goal_item"),
        "current_savings": scout.get("quest_state", {}).get("current_savings"),
        "target_budget": scout.get("quest_state", {}).get("target_budget"),
    }]})


def handle_read_scout_summary(db: Database, scout_email: str, args: dict) -> str:
    """Gamified progress overview for a linked scout."""
    # Guide tools pass scout_email as an arg, but our test state uses a single scout
    email = args.get("scout_email", scout_email)
    scout = db.scouts.find_one({"email": email})
    if not scout:
        return json.dumps({"error": "Scout not found"})

    all_reqs = list(db.requirements.find({"scout_email": email}))
    qs = scout.get("quest_state", {})
    target = qs.get("target_budget", 0)
    current = qs.get("current_savings", 0)

    return json.dumps({
        "name": scout.get("name"),
        "quest_status": qs.get("quest_status"),
        "goal_item": qs.get("goal_item"),
        "savings_progress": {
            "current": current,
            "target": target,
            "percent": round((current / target) * 100) if target > 0 else 0,
        },
        "requirements": {
            "total": len(all_reqs),
            "signed_off": len([r for r in all_reqs if r.get("status") == "signed_off"]),
            "in_progress": len([r for r in all_reqs if r.get("status") in ("in_progress", "tracking")]),
            "not_started": len([r for r in all_reqs if r.get("status") == "not_started"]),
        },
    })


def handle_read_scout_chores(db: Database, scout_email: str, args: dict) -> str:
    """Chore streak and income data for a linked scout. Reuses handle_read_chore_streak logic."""
    email = args.get("scout_email", scout_email)
    return handle_read_chore_streak(db, email, {})


def handle_read_scout_budget(db: Database, scout_email: str, args: dict) -> str:
    """Budget tracking snapshot for a linked scout. Reuses handle_read_budget_summary logic."""
    email = args.get("scout_email", scout_email)
    return handle_read_budget_summary(db, email, {})


def handle_read_scout_requirements(db: Database, scout_email: str, args: dict) -> str:
    """All requirements with current status for a linked scout. Reuses handle_read_requirements logic."""
    email = args.get("scout_email", scout_email)
    return handle_read_requirements(db, email, {})


def handle_flag_conversation(db: Database, scout_email: str, args: dict) -> str:
    """Flag a conversation for follow-up. Mock: returns success JSON."""
    email = args.get("scout_email", scout_email)
    reason = args.get("reason", "")

    db.reminders.insert_one({
        "scout_email": email,
        "type": "flagged_conversation",
        "reason": reason,
        "follow_up_date": args.get("follow_up_date"),
        "active": True,
        "created_at": datetime.now(timezone.utc),
    })

    return json.dumps({
        "flagged": True,
        "reminder_set": True,
        "reason": reason,
    })


def handle_adjust_character(db: Database, scout_email: str, args: dict) -> str:
    """Adjust scout's AI character settings (tone_dial/domain_intensity). Mock: updates DB, returns confirmation."""
    email = args.get("scout_email", scout_email)
    scout = db.scouts.find_one({"email": email})
    if not scout:
        return json.dumps({"error": "Scout not found"})

    char = scout.get("character", {})
    updates: dict[str, Any] = {"character.updated_at": datetime.now(timezone.utc)}
    changes: list[str] = []

    if args.get("tone_dial") is not None:
        val = min(max(args["tone_dial"], char.get("tone_min", 1)), char.get("tone_max", 5))
        updates["character.tone_dial"] = val
        changes.append(f"tone_dial -> {val}")

    if args.get("domain_intensity") is not None:
        val = min(max(args["domain_intensity"], char.get("domain_min", 1)), char.get("domain_max", 5))
        updates["character.domain_intensity"] = val
        changes.append(f"domain_intensity -> {val}")

    if changes:
        db.scouts.update_one({"email": email}, {"$set": updates})

    return json.dumps({
        "updated": True,
        "changes": changes,
        "reason": args.get("reason", ""),
    })


# ---------------------------------------------------------------------------
# Handler dispatch table
# ---------------------------------------------------------------------------

TOOL_HANDLERS: dict[str, Any] = {
    "log_chore": handle_log_chore,
    "log_budget_entry": handle_log_budget_entry,
    "advance_requirement": handle_advance_requirement,
    "compose_email": handle_compose_email,
    "send_notification": handle_send_notification,
    "adjust_tone": handle_adjust_tone,
    "setup_time_mgmt": handle_setup_time_mgmt,
    "log_diary_entry": handle_log_diary_entry,
    "update_quest_goal": handle_update_quest_goal,
    "update_quest_plan": handle_update_quest_plan,
    "log_session_notes": handle_log_session_notes,
    "read_quest_state": handle_read_quest_state,
    "read_requirements": handle_read_requirements,
    "read_budget_summary": handle_read_budget_summary,
    "read_chore_streak": handle_read_chore_streak,
    "read_last_session": handle_read_last_session,
    "read_quest_plan": handle_read_quest_plan,
    "web_search": handle_web_search,
}

GUIDE_TOOL_HANDLERS: dict[str, Any] = {
    "read_linked_scouts": handle_read_linked_scouts,
    "read_scout_summary": handle_read_scout_summary,
    "read_scout_chores": handle_read_scout_chores,
    "read_scout_budget": handle_read_scout_budget,
    "read_scout_requirements": handle_read_scout_requirements,
    "flag_conversation": handle_flag_conversation,
    "adjust_character": handle_adjust_character,
}


# ---------------------------------------------------------------------------
# ToolRegistry class
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Registry of all available tools with definitions and handlers.

    All tools are always registered (model sees them all). Authorization
    is handled by the layer config, not here.

    Supports two modes:
    - With TestState: handlers execute against a real MongoDB database
    - Without TestState: falls back to static mock responses

    Supports two endpoints:
    - "scout" (default): scout-facing tools (TOOL_DEFINITIONS + TOOL_HANDLERS)
    - "guide": guide/parent-facing tools (GUIDE_TOOL_DEFINITIONS + GUIDE_TOOL_HANDLERS)
    """

    def __init__(
        self,
        test_state: TestState | None = None,
        fixtures: dict[str, Any] | None = None,
        endpoint: str = "scout",
    ):
        self.endpoint = endpoint
        if endpoint == "guide":
            self.definitions = GUIDE_TOOL_DEFINITIONS
            self._handlers = GUIDE_TOOL_HANDLERS
            self._categories = GUIDE_TOOL_CATEGORIES
        else:
            self.definitions = TOOL_DEFINITIONS
            self._handlers = TOOL_HANDLERS
            self._categories = TOOL_CATEGORIES
        self.test_state = test_state
        if test_state and not fixtures:
            test_state.seed()
        elif test_state and fixtures:
            test_state.seed(fixtures)

    def all_definitions(self) -> list[dict]:
        """All tool definitions for Anthropic API tools parameter."""
        return self.definitions

    def execute(self, tool_name: str, args: dict, authorized: bool = True) -> dict:
        """Execute a tool call.

        If authorized: runs the handler against MongoDB (or static mock), returns result.
        If not authorized: returns error message. Call is still logged by the caller.
        """
        if not authorized:
            return {
                "error": f"Tool '{tool_name}' is not enabled in this evaluation layer.",
                "unauthorized": True,
            }

        handler = self._handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}

        if self.test_state is None:
            # Fallback to static mock if no test state
            if self.endpoint == "guide":
                return {"result": _static_mock_guide(tool_name, args)}
            return {"result": _static_mock(tool_name, args)}

        try:
            result = handler(self.test_state.db, self.test_state.scout_email, args)
            return {"result": result}
        except Exception as e:
            return {"error": str(e)}

    def get_category(self, tool_name: str) -> str | None:
        """Get the category for a tool name, or None if unknown."""
        for category, names in self._categories.items():
            if tool_name in names:
                return category
        return None


# ---------------------------------------------------------------------------
# Static mock fallback (for when no TestState is available)
# ---------------------------------------------------------------------------

_STATIC_FIXTURES: dict[str, Any] = {
    "quest_state": {
        "goal_item": "Gaming PC",
        "goal_description": "Build a custom gaming PC with RTX 4070 and Ryzen 7",
        "target_budget": 800,
        "current_savings": 120,
        "quest_status": "active",
        "days_since_start": 67,
        "budget_remaining": 680,
        "progress_percent": 15,
    },
    "requirements": [
        {"req_id": "pm_1a", "badge": "personal_management", "name": "Choose major expense", "status": "signed_off", "quest_driven": True},
        {"req_id": "pm_1b", "badge": "personal_management", "name": "Savings plan", "status": "in_progress", "quest_driven": True},
        {"req_id": "pm_1c", "badge": "personal_management", "name": "Shopping strategy", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_2a", "badge": "personal_management", "name": "Prepare budget", "status": "in_progress", "quest_driven": True},
        {"req_id": "pm_2b", "badge": "personal_management", "name": "Compare income vs expenses", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_2c", "badge": "personal_management", "name": "Track budget 13 weeks", "status": "tracking", "quest_driven": True, "tracking_progress": 4},
        {"req_id": "pm_2d", "badge": "personal_management", "name": "Budget review", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_3", "badge": "personal_management", "name": "Money concepts discussion", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_4", "badge": "personal_management", "name": "Saving vs investing", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_5", "badge": "personal_management", "name": "Investment types", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_6", "badge": "personal_management", "name": "Insurance types", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_7", "badge": "personal_management", "name": "Loans and credit", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8a", "badge": "personal_management", "name": "To-do list", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8b", "badge": "personal_management", "name": "7-day schedule", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8c", "badge": "personal_management", "name": "Follow schedule + diary", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8d", "badge": "personal_management", "name": "Schedule review", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_9", "badge": "personal_management", "name": "Project plan", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_10", "badge": "personal_management", "name": "Career exploration", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_1", "badge": "family_life", "name": "What is a family", "status": "in_progress", "quest_driven": False},
        {"req_id": "fl_2", "badge": "family_life", "name": "Importance to family", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_3", "badge": "family_life", "name": "90-day chores", "status": "tracking", "quest_driven": True, "tracking_progress": 28},
        {"req_id": "fl_4", "badge": "family_life", "name": "Individual home project", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_5", "badge": "family_life", "name": "Family project", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_6a", "badge": "family_life", "name": "Plan family meetings", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_6b", "badge": "family_life", "name": "Family meeting topics", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_7", "badge": "family_life", "name": "Effective parenting", "status": "not_started", "quest_driven": False},
    ],
    "budget_summary": {
        "weeks_tracked": 4,
        "weeks_remaining": 9,
        "projected": {"weekly_income": 29, "weekly_expenses": 8, "weekly_savings_target": 21},
        "actual": {"total_income": 116, "total_expenses": 32, "total_savings": 84},
        "savings_toward_goal": 120,
        "goal_target": 800,
    },
    "chore_streak": {
        "current_streak": 10,
        "longest_streak": 10,
        "total_earned": 20.00,
        "logged_today": False,
        "total_log_entries": 10,
        "available_chores": [
            {"id": "dishes", "name": "Wash dishes", "frequency": "daily", "earns_income": True, "income_amount": 2},
            {"id": "trash", "name": "Take out trash", "frequency": "daily", "earns_income": False, "income_amount": 0},
            {"id": "laundry", "name": "Do laundry", "frequency": "weekly", "earns_income": True, "income_amount": 5},
        ],
        "fl_req_3": {"days_completed": 28, "days_remaining": 62, "status": "tracking"},
    },
    "last_session": {
        "session_date": "2026-03-22T15:00:00Z",
        "source": "agent",
        "topics_discussed": ["chore streak progress", "budget week 4 review", "PM 2c tracking"],
        "progress_made": "Logged week 4 budget. Chore streak at 10 days. Discussed savings pace.",
        "pending_items": ["Log chores this weekend", "Start working on PM 5 goals essay"],
        "next_session_focus": "Review PM 5 essay draft and plan counselor meeting for PM 1b sign-off",
    },
    "quest_plan": {
        "current_priorities": [
            "Maintain daily chore streak (FL 3 tracking)",
            "Continue weekly budget logging (PM 2c, week 5 next)",
            "Draft PM 5 goals essay",
            "Schedule counselor meeting for PM 1b review",
        ],
        "strategy_notes": (
            "Will is motivated by the gaming PC goal. Use savings milestones "
            "to keep him engaged. He responds well to concrete progress metrics. "
            "Keep sessions focused - he zones out after 15 min of abstract discussion."
        ),
        "milestones": [
            {"id": "m1", "label": "30-day chore streak", "category": "streak", "status": "in_progress"},
            {"id": "m2", "label": "Savings reach $200", "category": "savings", "status": "in_progress"},
            {"id": "m3", "label": "PM 2c week 8 checkpoint", "category": "requirement", "status": "pending"},
        ],
        "scout_observations": {
            "engagement_patterns": "Most engaged when discussing PC parts and budget math. Less engaged on essay writing.",
            "attention_notes": "Keeps focus for about 15 minutes. Short sessions work better.",
            "motivation_triggers": "Savings progress bars, streak counts, new PC part research",
            "tone_notes": "Responds well to casual tone (3). Dislikes being talked down to.",
        },
        "next_counselor_session": None,
        "last_reviewed": "2026-03-22T15:00:00Z",
        "updated_at": "2026-03-22T15:00:00Z",
    },
    "scout": {
        "chore_list": [
            {"id": "dishes", "name": "Wash dishes", "frequency": "daily", "earns_income": True, "income_amount": 2},
            {"id": "trash", "name": "Take out trash", "frequency": "daily", "earns_income": False, "income_amount": 0},
            {"id": "laundry", "name": "Do laundry", "frequency": "weekly", "earns_income": True, "income_amount": 5},
        ],
        "parent_guardian": {
            "name": "Sarah Thompson",
            "email": "parent@example.com",
            "preferred_contact": "email",
        },
        "character": {
            "tone_dial": 3,
            "domain_intensity": 3,
            "tone_min": 1,
            "tone_max": 5,
            "domain_min": 1,
            "domain_max": 5,
        },
    },
}


def _static_mock(tool_name: str, args: dict) -> str:
    """Static mock handler — used when no TestState is available.

    Returns plausible responses without any database interaction.
    Read tools return fixture data; mutation tools return confirmation strings.
    """
    fx = _STATIC_FIXTURES

    # ----- Read tools -----
    if tool_name == "read_quest_state":
        return json.dumps(fx["quest_state"])

    if tool_name == "read_requirements":
        req_id = args.get("req_id")
        if req_id:
            for r in fx["requirements"]:
                if r["req_id"] == req_id:
                    return json.dumps(r)
            return json.dumps({"error": f"Requirement {req_id} not found"})
        return json.dumps(fx["requirements"])

    if tool_name == "read_budget_summary":
        return json.dumps(fx["budget_summary"])

    if tool_name == "read_chore_streak":
        return json.dumps(fx["chore_streak"])

    if tool_name == "read_last_session":
        return json.dumps(fx.get("last_session") or {"status": "no_sessions"})

    if tool_name == "read_quest_plan":
        return json.dumps(fx.get("quest_plan") or {"status": "no_plan"})

    # ----- Mutation tools -----
    if tool_name == "log_chore":
        chores = args.get("chores_completed", [])
        chore_map = {c["id"]: c for c in fx["scout"]["chore_list"]}
        income = sum(
            chore_map.get(cid, {}).get("income_amount", 0)
            for cid in chores
            if chore_map.get(cid, {}).get("earns_income", False)
        )
        date_str = args.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        return f"Chores logged for {date_str}: {len(chores)} chore(s). Earned: ${income:.2f}."

    if tool_name == "log_budget_entry":
        week = args.get("week_number", "?")
        saved = args.get("savings_deposited", 0)
        prev_savings = fx["budget_summary"]["actual"]["total_savings"]
        return f"Week {week} logged. Saved: ${saved:.2f}. Running total: ${prev_savings + saved:.2f}."

    if tool_name == "advance_requirement":
        req_id = args.get("req_id", "?")
        new_status = args.get("new_status", "?")
        if new_status == "signed_off":
            return "Error: Only an admin can sign off requirements."
        old_status = "not_started"
        for r in fx["requirements"]:
            if r["req_id"] == req_id:
                old_status = r["status"]
                break
        return f"Requirement {req_id}: {old_status} \u2192 {new_status}."

    if tool_name == "log_diary_entry":
        return f"Diary entry for {args.get('day', '?')} recorded."

    if tool_name == "log_session_notes":
        topics = args.get("topics_discussed", [])
        return f"Session notes logged. Topics: {', '.join(topics)}."

    if tool_name == "update_quest_goal":
        changes = []
        if args.get("goal_item"):
            changes.append(f"goal_item \u2192 {args['goal_item']}")
        if args.get("goal_description"):
            changes.append("goal_description updated")
        if args.get("target_budget") is not None:
            changes.append(f"target_budget \u2192 ${args['target_budget']}")
        return f"Quest goal updated: {', '.join(changes)}." if changes else "No changes specified."

    if tool_name == "update_quest_plan":
        return f"Quest plan updated. Reason: {args.get('reason', 'no reason given')}"

    # ----- Communication tools -----
    if tool_name == "compose_email":
        to = args.get("to", "unknown@example.com")
        subject = args.get("subject", "No subject")
        parent_email = fx["scout"]["parent_guardian"]["email"]
        return f"Email link generated. To: {to}, CC: {parent_email} (YPT). Subject: {subject}"

    if tool_name == "send_notification":
        return f"Notification sent: {args.get('title') or args.get('message', '')}"

    # ----- Preference tools -----
    if tool_name == "adjust_tone":
        changes = []
        char = fx["scout"]["character"]
        if args.get("tone_dial") is not None:
            val = max(char["tone_min"], min(char["tone_max"], args["tone_dial"]))
            changes.append(f"tone_dial \u2192 {val}")
        if args.get("domain_intensity") is not None:
            val = max(char["domain_min"], min(char["domain_max"], args["domain_intensity"]))
            changes.append(f"domain_intensity \u2192 {val}")
        return f"Adjusted: {', '.join(changes)}. Reason: {args.get('reason', '')}" if changes else "No changes made."

    if tool_name == "setup_time_mgmt":
        return "Time management exercise created. Use log_diary_entry to record daily diary entries."

    # ----- Search tools -----
    if tool_name == "web_search":
        query = args.get("query", "")
        try:
            from perspectives.knowledge import _do_brave_search
            return _do_brave_search(query)
        except Exception as e:
            return f"Web search failed: {e}"

    return f'Error: Unknown tool "{tool_name}".'


def _static_mock_guide(tool_name: str, args: dict) -> str:
    """Static mock handler for guide endpoint — used when no TestState is available."""
    fx = _STATIC_FIXTURES

    if tool_name == "read_linked_scouts":
        return json.dumps({"scouts": [{
            "email": "will@test.scoutquest.app",
            "name": "Test Scout Will",
            "age": 14,
            "troop": "T999",
            "quest_status": "active",
            "goal_item": "Gaming PC",
            "current_savings": 120,
            "target_budget": 800,
        }]})

    if tool_name == "read_scout_summary":
        return json.dumps({
            "name": "Test Scout Will",
            "quest_status": "active",
            "goal_item": "Gaming PC",
            "savings_progress": {
                "current": 120,
                "target": 800,
                "percent": 15,
            },
            "requirements": {
                "total": 26,
                "signed_off": 1,
                "in_progress": 4,
                "not_started": 21,
            },
        })

    if tool_name == "read_scout_chores":
        return json.dumps(fx["chore_streak"])

    if tool_name == "read_scout_budget":
        return json.dumps(fx["budget_summary"])

    if tool_name == "read_scout_requirements":
        return json.dumps(fx["requirements"])

    if tool_name == "flag_conversation":
        return json.dumps({
            "flagged": True,
            "reminder_set": True,
            "reason": args.get("reason", ""),
        })

    if tool_name == "adjust_character":
        changes = []
        if args.get("tone_dial") is not None:
            changes.append(f"tone_dial -> {args['tone_dial']}")
        if args.get("domain_intensity") is not None:
            changes.append(f"domain_intensity -> {args['domain_intensity']}")
        return json.dumps({
            "updated": True,
            "changes": changes,
            "reason": args.get("reason", ""),
        })

    return f'Error: Unknown guide tool "{tool_name}".'
