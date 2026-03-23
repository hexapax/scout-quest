"""Tool registry for the unified eval engine.

Ports all tool definitions from the TypeScript MCP test harness to Python,
provides mock handlers for eval testing, and exposes a ToolRegistry class
for the eval engine to use.

Tools are always registered with the API (the model sees them). Authorization
is handled by the layer config, not here. This module only defines schemas
and mock execution behavior.
"""

from __future__ import annotations

import json
from typing import Any

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
        "description": "Read the scout's quest state: goal, savings, target budget, progress percentage.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "read_requirements",
        "description": (
            "Read all Personal Management and Family Life requirements with current status "
            "(not_started, in_progress, tracking, ready_for_review, signed_off)."
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
        "description": "Search the web for current BSA policy, merit badge requirements, scouting procedures, or other factual information.",
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
# Default fixture data — realistic mock data for eval testing
# ---------------------------------------------------------------------------

DEFAULT_FIXTURES: dict[str, Any] = {
    "scout": {
        "email": "test-scout@scoutquest.test",
        "name": "Test Scout Will",
        "age": 14,
        "troop": "T999",
        "patrol": "Eagles",
        "interests": {
            "likes": ["gaming", "building PCs", "coding"],
            "dislikes": ["running", "cleaning"],
            "motivations": ["save up for a gaming PC", "finish Personal Management"],
        },
        "parent_guardian": {
            "name": "Sarah Thompson",
            "email": "parent@example.com",
            "preferred_contact": "email",
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
        "character": {
            "base": "pathfinder",
            "quest_overlay": "gamer_hardware",
            "tone_dial": 3,
            "domain_intensity": 3,
            "tone_min": 1,
            "tone_max": 5,
            "domain_min": 1,
            "domain_max": 5,
        },
        "chore_list": [
            {"id": "dishes", "name": "Wash dishes", "frequency": "daily", "earns_income": True, "income_amount": 2},
            {"id": "trash", "name": "Take out trash", "frequency": "daily", "earns_income": False, "income_amount": 0},
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
    },

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
        {"req_id": "pm_1a", "badge": "personal_management", "name": "PM 1a: Discuss with counselor", "status": "signed_off", "quest_driven": True},
        {"req_id": "pm_1b", "badge": "personal_management", "name": "PM 1b: Budget plan", "status": "in_progress", "quest_driven": True},
        {"req_id": "pm_1c", "badge": "personal_management", "name": "PM 1c: Budget comparison", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_2a", "badge": "personal_management", "name": "PM 2a: Discuss with parent", "status": "in_progress", "quest_driven": True},
        {"req_id": "pm_2b", "badge": "personal_management", "name": "PM 2b: Career exploration", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_2c", "badge": "personal_management", "name": "PM 2c: 13-week budget tracking", "status": "tracking", "quest_driven": True, "tracking_progress": 4},
        {"req_id": "pm_2d", "badge": "personal_management", "name": "PM 2d: Discuss results", "status": "not_started", "quest_driven": True},
        {"req_id": "pm_3", "badge": "personal_management", "name": "PM 3: Discuss organization", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_4", "badge": "personal_management", "name": "PM 4: Time management project", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_5", "badge": "personal_management", "name": "PM 5: Goals essay", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_6", "badge": "personal_management", "name": "PM 6: Goal-setting activity", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_7", "badge": "personal_management", "name": "PM 7: Life skills inventory", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8a", "badge": "personal_management", "name": "PM 8a: To-do list", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8b", "badge": "personal_management", "name": "PM 8b: Weekly schedule", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8c", "badge": "personal_management", "name": "PM 8c: Daily diary", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_8d", "badge": "personal_management", "name": "PM 8d: Discuss time mgmt", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_9", "badge": "personal_management", "name": "PM 9: Character development", "status": "not_started", "quest_driven": False},
        {"req_id": "pm_10", "badge": "personal_management", "name": "PM 10: Final interview", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_1", "badge": "family_life", "name": "FL 1: Family discussion", "status": "in_progress", "quest_driven": False},
        {"req_id": "fl_2", "badge": "family_life", "name": "FL 2: Chore chart", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_3", "badge": "family_life", "name": "FL 3: 90-day chore tracking", "status": "tracking", "quest_driven": True, "tracking_progress": 28},
        {"req_id": "fl_4", "badge": "family_life", "name": "FL 4: Family meeting", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_5", "badge": "family_life", "name": "FL 5: Family outing", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_6a", "badge": "family_life", "name": "FL 6a: Service project plan", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_6b", "badge": "family_life", "name": "FL 6b: Service project execute", "status": "not_started", "quest_driven": False},
        {"req_id": "fl_7", "badge": "family_life", "name": "FL 7: Final discussion", "status": "not_started", "quest_driven": False},
    ],

    "budget_summary": {
        "weeks_tracked": 4,
        "weeks_remaining": 9,
        "projected": {
            "weekly_income": 29,
            "weekly_expenses": 8,
            "weekly_savings_target": 21,
        },
        "actual": {
            "total_income": 116,
            "total_expenses": 32,
            "total_savings": 84,
        },
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
        "fl_req_3": {
            "days_completed": 28,
            "days_remaining": 62,
            "status": "tracking",
        },
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
            "Keep sessions focused — he zones out after 15 min of abstract discussion."
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
}


# ---------------------------------------------------------------------------
# Mock tool handler
# ---------------------------------------------------------------------------

def mock_tool_handler(tool_name: str, args: dict, fixtures: dict | None = None) -> str:
    """Execute a tool with mock/fixture data for eval testing.

    Read tools return fixture data.
    Mutation tools return success confirmation.
    Communication tools return mock confirmation (never actually send).
    Search tools delegate to real search (Brave API).
    """
    fx = fixtures or DEFAULT_FIXTURES

    # ----- Read tools -----
    if tool_name == "read_quest_state":
        return json.dumps(fx.get("quest_state", {}), indent=2)

    if tool_name == "read_requirements":
        req_id = args.get("req_id")
        all_reqs = fx.get("requirements", [])
        if req_id:
            for r in all_reqs:
                if r["req_id"] == req_id:
                    return json.dumps(r, indent=2)
            return json.dumps({"error": f"Requirement {req_id} not found"})
        return json.dumps(all_reqs, indent=2)

    if tool_name == "read_budget_summary":
        return json.dumps(fx.get("budget_summary", {}), indent=2)

    if tool_name == "read_chore_streak":
        return json.dumps(fx.get("chore_streak", {}), indent=2)

    if tool_name == "read_last_session":
        session = fx.get("last_session")
        if not session:
            return json.dumps({"status": "no_sessions"})
        return json.dumps(session, indent=2)

    if tool_name == "read_quest_plan":
        plan = fx.get("quest_plan")
        if not plan:
            return json.dumps({"status": "no_plan"})
        return json.dumps(plan, indent=2)

    # ----- Mutation tools -----
    if tool_name == "log_chore":
        chores = args.get("chores_completed", [])
        # Calculate income from fixture chore list
        chore_map = {c["id"]: c for c in fx.get("scout", {}).get("chore_list", [])}
        income = sum(
            chore_map.get(cid, {}).get("income_amount", 0)
            for cid in chores
            if chore_map.get(cid, {}).get("earns_income", False)
        )
        streak = fx.get("chore_streak", {}).get("current_streak", 0) + 1
        savings = fx.get("quest_state", {}).get("current_savings", 0) + income
        date_str = args.get("date", "today")
        return (
            f"Chores logged for {date_str}: {', '.join(chores)}. "
            f"{len(chores)} chore(s). Earned: ${income:.2f}. "
            f"Streak: {streak} days. Savings: ${savings:.2f}."
        )

    if tool_name == "log_budget_entry":
        week = args.get("week_number", "?")
        saved = args.get("savings_deposited", 0)
        prev_savings = fx.get("budget_summary", {}).get("actual", {}).get("total_savings", 0)
        running = prev_savings + saved
        return f"Week {week} logged. Saved: ${saved:.2f}. Running total: ${running:.2f}."

    if tool_name == "advance_requirement":
        req_id = args.get("req_id", "?")
        new_status = args.get("new_status", "?")
        if new_status == "signed_off":
            return "Error: Only an admin can sign off requirements."
        # Find current status from fixtures
        all_reqs = fx.get("requirements", [])
        old_status = "not_started"
        for r in all_reqs:
            if r["req_id"] == req_id:
                old_status = r["status"]
                break
        return f"Requirement {req_id}: {old_status} -> {new_status}."

    if tool_name == "log_diary_entry":
        day = args.get("day", "?")
        entries = args.get("entries", [])
        return f"Diary entry for {day} recorded. {len(entries)} time entries logged."

    if tool_name == "log_session_notes":
        topics = args.get("topics_discussed", [])
        return f"Session notes logged. Topics: {', '.join(topics)}."

    if tool_name == "update_quest_goal":
        changes = []
        if args.get("goal_item"):
            changes.append(f"goal_item -> {args['goal_item']}")
        if args.get("goal_description"):
            changes.append("goal_description updated")
        if args.get("target_budget") is not None:
            changes.append(f"target_budget -> ${args['target_budget']}")
        if changes:
            return f"Quest goal updated: {', '.join(changes)}."
        return "No changes specified."

    if tool_name == "update_quest_plan":
        reason = args.get("reason", "no reason given")
        return f"Quest plan updated. Reason: {reason}"

    # ----- Communication tools (always mocked) -----
    if tool_name == "compose_email":
        to = args.get("to", "unknown@example.com")
        subject = args.get("subject", "No subject")
        parent_email = fx.get("scout", {}).get("parent_guardian", {}).get("email", "parent@example.com")
        return f"Email link generated. To: {to}, CC: {parent_email} (YPT). Subject: {subject}"

    if tool_name == "send_notification":
        title = args.get("title", args.get("message", ""))
        return f"Notification sent: {title}"

    # ----- Preference tools -----
    if tool_name == "adjust_tone":
        changes = []
        reason = args.get("reason", "no reason")
        char = fx.get("scout", {}).get("character", {})
        if args.get("tone_dial") is not None:
            val = max(char.get("tone_min", 1), min(char.get("tone_max", 5), args["tone_dial"]))
            changes.append(f"tone_dial -> {val}")
        if args.get("domain_intensity") is not None:
            val = max(char.get("domain_min", 1), min(char.get("domain_max", 5), args["domain_intensity"]))
            changes.append(f"domain_intensity -> {val}")
        if changes:
            return f"Adjusted: {', '.join(changes)}. Reason: {reason}"
        return "No changes made."

    if tool_name == "setup_time_mgmt":
        todo = args.get("todo_list", [])
        schedule = args.get("weekly_schedule", [])
        return (
            f"Time management exercise created. "
            f"{len(todo)} to-do items, {len(schedule)} days scheduled. "
            f"Use log_diary_entry to record daily diary entries."
        )

    # ----- Search tools -----
    if tool_name == "web_search":
        # Delegate to real Brave search — imported lazily to avoid circular imports
        query = args.get("query", "")
        try:
            from perspectives.knowledge import _do_brave_search
            return _do_brave_search(query)
        except Exception as e:
            return f"Web search failed: {e}"

    return f"Error: Unknown tool '{tool_name}'."


# ---------------------------------------------------------------------------
# ToolRegistry class
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Registry of all available tools with definitions and mock handlers.

    All tools are always registered (model sees them all). Authorization
    is handled by the layer config, not here.
    """

    def __init__(self, fixtures: dict | None = None):
        self.definitions = TOOL_DEFINITIONS
        self.fixtures = fixtures or DEFAULT_FIXTURES

    def all_definitions(self) -> list[dict]:
        """All tool definitions for Anthropic API tools parameter."""
        return self.definitions

    def execute(self, tool_name: str, args: dict, authorized: bool = True) -> dict:
        """Execute a tool call.

        If authorized: runs the mock handler, returns result.
        If not authorized: returns error message, but the CALL IS STILL LOGGED
        by the caller (EvalEngine tracks all calls).
        """
        if not authorized:
            return {
                "error": f"Tool '{tool_name}' is not enabled in this evaluation layer.",
                "unauthorized": True,
            }
        result = mock_tool_handler(tool_name, args, self.fixtures)
        return {"result": result}

    def get_category(self, tool_name: str) -> str | None:
        """Get the category for a tool name, or None if unknown."""
        for category, names in TOOL_CATEGORIES.items():
            if tool_name in names:
                return category
        return None
