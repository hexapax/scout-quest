# Scout Quest MCP Server — Redesign Specification

> **Date:** February 21, 2026
> **Status:** Implemented — authoritative spec
> **Supersedes:** `docs/mcp-server-design.md` (original PC-build-specific design)
> **Input documents:** `docs/scout-quest-character.md`, `docs/scout-quest-requirements.md`

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Key Design Decisions](#3-key-design-decisions)
4. [MongoDB Data Model](#4-mongodb-data-model)
5. [MCP Resources (Read-Only)](#5-mcp-resources-read-only)
6. [MCP Tools (Mutations)](#6-mcp-tools-mutations)
7. [Security Model](#7-security-model)
8. [Role-Based Access & User Selection](#8-role-based-access--user-selection)
9. [File Structure](#9-file-structure)
10. [Deployment & Integration](#10-deployment--integration)
11. [Server Instructions](#11-server-instructions)
12. [Model Evaluation Test Harness](#12-model-evaluation-test-harness)
13. [Changes from Original Design](#13-changes-from-original-design)

---

## 1. Design Goals

The original MCP design was a PC-build tracker for a single scout. This redesign transforms it into a **reusable scout quest engine** that:

- Supports **any quest goal** (PC build, camping gear, instrument, bike, etc.) as long as it involves earning money through chores and satisfying Personal Management and Family Life merit badge requirements
- Tracks **all requirements** for both badges, not just the ones relevant to a specific goal
- Stores **character personality config** in MongoDB so the AI persona persists across sessions and adapts over time (tone dials, cringe recovery, SM/parent calibration)
- Supports **multiple scouts** from day one, with identity tied to Gmail address (Google OAuth)
- Provides **role-based access**: superuser, admin (SM/ASM), adult read-only, parent, scout
- Separates **admin operations** (create/configure scouts) from **scout operations** (log chores, advance requirements) across two LibreChat instances
- Uses **MCP Resources** for read-only data access and **MCP Tools** for mutations

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      MongoDB (scoutquest)                        │
│  Collections: users, scouts, requirements, chore_logs,           │
│    budget_entries, time_mgmt, loan_analysis, emails_sent,        │
│    reminders                                                     │
└──────────────┬──────────────────────────────┬────────────────────┘
               │                              │
    ┌──────────┴──────────┐        ┌──────────┴──────────┐
    │  dist/scout.js      │        │  dist/admin.js      │
    │  (stdio MCP server) │        │  (stdio MCP server) │
    │                     │        │                     │
    │  Resources:         │        │  Tools:             │
    │  - quest_state      │        │  - create_scout     │
    │  - requirements     │        │  - configure_quest  │
    │  - chore_streak     │        │  - set_character    │
    │  - budget_summary   │        │  - set_counselors   │
    │  - character        │        │  - set_unit_leaders  │
    │  - reminders        │        │  - init_requirements │
    │  - quest_summary    │        │  - override_req     │
    │                     │        │  - sign_off_req     │
    │  Tools:             │        │  - set_chore_list   │
    │  - log_chore        │        │  - set_budget       │
    │  - log_budget_entry │        │  - approve_blue_card │
    │  - advance_req      │        │                     │
    │  - compose_email    │        │  Resources:         │
    │  - log_diary_entry  │        │  - all_scouts       │
    │  - send_notification│        │  - scout_detail     │
    │  - adjust_tone      │        │                     │
    │  - setup_time_mgmt  │        └──────────┬──────────┘
    │  - update_quest_goal│                   │
    └──────────┬──────────┘        ┌──────────┴──────────┐
               │                   │  ai-chat instance   │
    ┌──────────┴──────────┐        │  (Jeremy / SM / ASM) │
    │  scout-quest        │        └─────────────────────┘
    │  instance           │
    │  (scouts + parents) │
    └─────────────────────┘
```

**Single TypeScript codebase** with two entry points (`src/scout.ts`, `src/admin.ts`). Shared types, DB connection, and validation. Each LibreChat instance spawns its own MCP server process via stdio.

Both instances connect to the **same MongoDB** (`scoutquest` database). The scout-quest instance's MongoDB is the canonical store; the ai-chat admin server connects to it via a shared Docker network.

---

## 3. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| DB name | `scoutquest` (lowercase) | Avoids case-sensitivity bugs. Updated from `.env.example`'s `ScoutQuest`. |
| MCP SDK | `@modelcontextprotocol/sdk` v1.x latest stable (~1.26) | v2 is pre-alpha. v1.x is production-recommended. Uses `McpServer` + `registerTool()` + Zod schemas. |
| Read vs write split | MCP Resources for reads, Tools for mutations | Cleaner separation. Resources are safe to read freely. Tools require intent. |
| Codebase structure | Single package, two entry points | Shared types/validation prevent drift. Process-level isolation via separate LibreChat instances. |
| Scout identity | Gmail address (Google OAuth email) | Matches LibreChat's existing Google OAuth. Unique key in MongoDB. |
| Character state | MCP-managed in MongoDB | Enables cringe recovery, SM calibration reviews, tone persistence across sessions. |
| Admin interface | ai-chat LibreChat instance + AdminJS panel | **Superseded:** Admin panel (admin.hexapax.com:3082) was added for MongoDB visibility. ai-chat is still used for admin MCP tools. |
| Multi-scout | Supported from V1 | Data model is multi-scout. Tools accept/infer scout identity from email. |
| Test harness | Standalone runner (separate from MCP server) | Keeps MCP server clean. Test runner creates test accounts, simulates conversations, scores transcripts. |

---

## 4. MongoDB Data Model

**Database:** `scoutquest`

### 4.1 Collection: `users`

Maps email addresses to roles. Checked by every MCP tool/resource call for authorization.

```typescript
interface UserDocument {
  _id: ObjectId;
  email: string;                    // Gmail address — unique, matches OAuth
  roles: Role[];
  created_at: Date;
  updated_at: Date;
}

type Role =
  | { type: "superuser" }
  | { type: "admin"; troop: string }
  | { type: "adult_readonly"; troop: string }
  | { type: "parent"; scout_emails: string[] }
  | { type: "scout" }
  | { type: "test_scout"; test_account: true };
```

### 4.2 Collection: `scouts`

Scout profile, quest config, character config, counselors, blue card status.

```typescript
interface ScoutDocument {
  _id: ObjectId;
  email: string;                    // Gmail — unique key, matches OAuth
  name: string;
  age: number;
  troop: string;
  patrol?: string;

  quest_state: {
    goal_item: string;              // "Gaming PC", "Camping gear", etc.
    goal_description: string;
    target_budget: number;
    savings_capacity: number;
    loan_path_active: boolean;
    quest_start_date: Date | null;
    current_savings: number;
    quest_status: "setup" | "active" | "paused" | "complete";
  };

  character: {
    base: "guide" | "pathfinder" | "trailblazer";
    quest_overlay: string;          // "gamer_hardware" | "outdoor_adventure" |
                                    // "music_audio" | "vehicle" | "custom"
    tone_dial: number;              // 1-5
    domain_intensity: number;       // 1-5
    tone_min: number;
    tone_max: number;
    domain_min: number;
    domain_max: number;
    sm_notes: string;
    parent_notes: string;
    avoid: string[];
    calibration_review_enabled: boolean;
    calibration_review_weeks: number[];
    custom_overlay?: {
      vocabulary: string[];
      analogies: string[];
      enthusiasm_triggers: string[];
    };
  };

  counselors: {
    personal_management: ContactInfo;
    family_life: ContactInfo;
  };

  unit_leaders: {
    scoutmaster: ContactInfo;
    asm?: ContactInfo;
  };

  parent_guardian: ContactInfo;     // MUST be CC'd on all emails (YPT)

  blue_card: {
    personal_management: {
      requested_date: Date | null;
      approved_date: Date | null;
      approved_by: string | null;
    };
    family_life: {
      requested_date: Date | null;
      approved_date: Date | null;
      approved_by: string | null;
    };
  };

  chore_list: {
    id: string;
    name: string;
    frequency: string;              // "daily" | "weekly" | "as needed"
    earns_income: boolean;
    income_amount: number | null;
  }[];

  budget_projected?: {
    income_sources: { name: string; weekly_amount: number }[];
    expense_categories: { name: string; weekly_amount: number }[];
    savings_target_weekly: number;
  };

  created_at: Date;
  updated_at: Date;
}

interface ContactInfo {
  name: string;
  email: string;
  preferred_contact?: "email" | "phone" | "text";
}
```

### 4.3 Collection: `requirements`

Per-requirement state machine tracking. One document per requirement per scout.

```typescript
interface RequirementDocument {
  _id: ObjectId;
  scout_email: string;
  req_id: string;                   // "pm_1a", "pm_2c", "fl_3", "fl_6b_4"
  badge: "personal_management" | "family_life";
  status: RequirementStatus;
  quest_driven: boolean;
  interaction_mode: InteractionMode;

  // Tracking (for time-based requirements)
  tracking_start_date?: Date;
  tracking_duration?: { days?: number; weeks?: number };
  tracking_progress?: number;       // days or weeks completed

  // Approval gates
  parent_approved?: boolean;
  counselor_approved?: boolean;

  // Deliverables
  documents?: {
    name: string;
    content: string;
    submitted_date?: Date;
  }[];

  // Counselor interaction
  submitted_to_counselor_date?: Date;
  counselor_feedback?: string;
  signed_off_date?: Date;
  signed_off_by?: string;

  notes: string;
  updated_at: Date;
}

type RequirementStatus =
  | "not_started"
  | "in_progress"
  | "tracking"
  | "blocked"
  | "needs_approval"
  | "ready_for_review"
  | "submitted"
  | "needs_revision"
  | "signed_off"
  | "completed_prior"
  | "excluded"
  | "offered";

type InteractionMode =
  | "in_person"
  | "video"
  | "email"
  | "digital_submission"
  | "parent_verify";
```

**Requirement state machine:**

```
NOT_STARTED → IN_PROGRESS → READY_FOR_REVIEW → SUBMITTED → SIGNED_OFF
                  │                                 │
                  ├── TRACKING (time-based)          ├── NEEDS_REVISION → IN_PROGRESS
                  │                                 │
                  └── BLOCKED (needs approval)      └── (admin only)
                       │
                       └── NEEDS_APPROVAL → (approval received) → IN_PROGRESS

Additional terminal states:
  COMPLETED_PRIOR — set in config, immutable
  EXCLUDED — SM/ASM excluded, agent ignores
  OFFERED — agent offered a non-quest requirement, scout hasn't started
```

### 4.4 Collection: `chore_logs`

Append-only daily chore records. Supports FL Req 3 (90-day tracking).

```typescript
interface ChoreLogEntry {
  _id: ObjectId;
  scout_email: string;
  date: Date;
  chores_completed: string[];       // chore IDs from scout's chore_list
  income_earned: number;
  notes?: string;
  created_at: Date;
}
```

### 4.5 Collection: `budget_entries`

Append-only weekly budget actuals. Supports PM Req 2 (13-week tracking).

```typescript
interface BudgetEntry {
  _id: ObjectId;
  scout_email: string;
  week_number: number;              // 1-13
  week_start: Date;
  income: { source: string; amount: number }[];
  expenses: { category: string; amount: number; description: string }[];
  savings_deposited: number;
  running_savings_total: number;
  notes?: string;
  created_at: Date;
}
```

### 4.6 Collection: `time_mgmt`

PM Req 8 (1-week time management exercise).

```typescript
interface TimeMgmtDocument {
  _id: ObjectId;
  scout_email: string;
  exercise_week_start: Date;

  todo_list: {
    item: string;
    priority: number;
    category: string;
  }[];

  weekly_schedule: {
    day: string;
    fixed_activities: { time: string; activity: string }[];
    planned_tasks: { time: string; todo_item: string }[];
  }[];

  daily_diary: {
    day: string;
    entries: {
      scheduled_time: string;
      actual_time: string;
      task: string;
      completed: boolean;
      notes: string;
    }[];
  }[];

  reflection?: string;
}
```

### 4.7 Collection: `loan_analysis`

Active when `target_budget > savings_capacity`.

```typescript
interface LoanAnalysisDocument {
  _id: ObjectId;
  scout_email: string;
  shortfall: number;
  options_explored: {
    option: string;
    details: string;
    total_cost: number;
    timeline: string;
  }[];
  selected_option?: string;
  parent_loan?: {
    principal: number;
    interest_rate: number;
    term_weeks: number;
    weekly_payment: number;
    total_cost_with_interest: number;
    proposal_document?: string;
    parent_approved: boolean;
    repayment_log: {
      week: number;
      amount_paid: number;
      remaining_balance: number;
    }[];
  };
}
```

### 4.8 Collection: `emails_sent`

Audit trail of composed emails.

```typescript
interface EmailRecord {
  _id: ObjectId;
  scout_email: string;
  date: Date;
  to: string;
  cc: string[];
  subject: string;
  context: string;
}
```

### 4.9 Collection: `reminders`

Active reminders for the cron sidecar.

```typescript
interface ReminderDocument {
  _id: ObjectId;
  scout_email: string;
  type: "chore" | "deadline" | "check_in" | "diary" | "budget_update";
  message: string;
  schedule: string;
  last_triggered: Date | null;
  next_trigger: Date | null;
  active: boolean;
  created_at: Date;
}
```

### 4.10 Collection: `quest_plans`

Weekly quest plans generated by the guide endpoint during onboarding or plan reviews. One active plan per scout at a time. See `2026-02-21-combined-implementation.md` for full schema.

### 4.11 Collection: `session_notes`

Per-session summaries written by the scout-facing MCP server at the end of each conversation. Captures topics covered, requirements worked on, mood/engagement signals, and next steps. See `2026-02-21-combined-implementation.md` for full schema.

### 4.12 Collection: `cron_log`

Audit log for the cron sidecar. Each entry records a cron job run, what checks were performed, what notifications were sent, and any errors. See `2026-02-21-combined-implementation.md` for full schema.

### 4.13 Collection: `plan_changelog`

Tracks changes to quest plans over time — who changed what and why. Enables plan diff views in the admin panel and guide resources. See `2026-02-21-combined-implementation.md` for full schema.

### 4.14 Collection: `setup_status`

Tracks the progress of guide-led scout onboarding. Records which setup steps have been completed, which are pending, and whether the scout is ready to begin their quest. See `2026-02-21-combined-implementation.md` for full schema.

---

## 5. MCP Resources (Read-Only)

### 5.1 Scout-Facing Resources (dist/scout.js)

| Resource URI | Description | Returns |
|---|---|---|
| `scout://quest-state` | Full quest state for the current scout | Scout profile, quest goal, savings, status, character config, counselors, blue card status |
| `scout://requirements` | All requirement states | Array of requirement documents with status, tracking progress, next action needed |
| `scout://requirements/{req_id}` | Single requirement detail | Full document including deliverables, counselor feedback |
| `scout://chore-streak` | Chore tracking summary | Current streak, longest streak, total earned, today logged?, days remaining for FL Req 3 |
| `scout://budget-summary` | Budget tracking summary | Projected vs actual, weeks completed, savings progress, variance |
| `scout://character` | Character personality config | Base character, overlay, tone/domain dials, avoid list, SM/parent notes |
| `scout://reminders` | Pending/overdue items | Array of reminder objects with urgency levels |
| `scout://quest-summary` | Gamified progress view | Formatted progress string (the "where am I?" view) |

**Scout identity resolution:** The MCP server resolves the current scout from the user's email (passed via LibreChat context or `SCOUT_EMAIL` env var), then checks the `users` collection for authorization.

### 5.2 Admin-Facing Resources (dist/admin.js)

| Resource URI | Description | Returns |
|---|---|---|
| `admin://scouts` | List all scouts (filtered by admin's troop) | Array of scout profiles with quest status summary |
| `admin://scouts/{email}` | Full detail for one scout | Complete scout document + all requirements + latest tracking data |
| `admin://scouts/{email}/requirements` | All requirements for a scout | Full requirement state with tracking progress |

---

## 6. MCP Tools (Mutations)

### 6.1 Scout-Facing Tools (dist/scout.js)

| # | Tool | Purpose | Key Params | Side Effects |
|---|---|---|---|---|
| 1 | `log_chore` | Record daily chore completion | `chores_completed[]`, `notes?` | Appends to `chore_logs`, updates streak, updates FL Req 3 tracking, adds income to `current_savings`, milestone notifications |
| 2 | `log_budget_entry` | Record weekly budget actuals | `week_number`, `income[]`, `expenses[]`, `savings_deposited` | Appends to `budget_entries`, updates PM Req 2 tracking |
| 3 | `advance_requirement` | Move requirement through state machine | `req_id`, `new_status`, `notes?`, `document?` | Validates transition is legal, updates requirement, sets dates |
| 4 | `compose_email` | Generate mailto: link | `to`, `subject`, `body`, `context` | Auto-adds parent CC (YPT), logs in `emails_sent` |
| 5 | `log_diary_entry` | PM Req 8 daily diary | `day`, `scheduled_tasks[]`, `actual_tasks[]`, `notes` | Appends to `time_mgmt.daily_diary` |
| 6 | `send_notification` | Push notification via ntfy.sh | `message`, `title?`, `priority?`, `tags?` | HTTP POST to ntfy.sh |
| 7 | `adjust_tone` | Adjust character dials | `tone_dial?`, `domain_intensity?`, `reason` | Updates `character` in scout doc, respects min/max bounds |
| 8 | `setup_time_mgmt` | Initialize PM Req 8 exercise | `todo_list[]`, `weekly_schedule` | Creates `time_mgmt` document |
| 9 | `update_quest_goal` | Modify quest goal | `goal_item?`, `goal_description?`, `target_budget?` | Updates `quest_state`, returns re-mapping note |

**Validation rules:**

- `compose_email`: ALWAYS adds `parent_guardian.email` to CC (YPT — hard safety rule)
- `advance_requirement`: Validates legal state transitions; cannot set `signed_off` (admin only)
- `log_chore`: Cannot back-date more than 3 days
- `adjust_tone`: Respects `tone_min`/`tone_max` and `domain_min`/`domain_max` bounds
- All currency values must be non-negative

### 6.2 Admin-Facing Tools (dist/admin.js)

| # | Tool | Purpose | Key Params |
|---|---|---|---|
| 1 | `create_scout` | Create a new scout profile | `email`, `name`, `age`, `troop`, `patrol?`, `parent_guardian` |
| 2 | `configure_quest` | Set up quest goal and finances | `scout_email`, `goal_item`, `goal_description`, `target_budget`, `savings_capacity`, `start_date` |
| 3 | `set_character` | Configure character persona | `scout_email`, `base`, `quest_overlay`, dials/bounds, `sm_notes`, `parent_notes`, `avoid[]` |
| 4 | `set_counselors` | Assign merit badge counselors | `scout_email`, `badge`, `counselor_name`, `counselor_email`, `preferred_contact` |
| 5 | `set_unit_leaders` | Configure SM/ASM | `scout_email`, `scoutmaster`, `asm?` |
| 6 | `initialize_requirements` | Seed all requirements with status/config | `scout_email`, `requirements[]` (each with `req_id`, `status`, `quest_driven`, `interaction_mode`) |
| 7 | `override_requirement` | SM/ASM override a requirement | `scout_email`, `req_id`, `new_status`, `reason` |
| 8 | `sign_off_requirement` | Record counselor sign-off | `scout_email`, `req_id`, `signed_off_by` |
| 9 | `set_chore_list` | Define the scout's 5+ chores | `scout_email`, `chores[]` (each with `name`, `frequency`, `earns_income`, `income_amount`) |
| 10 | `set_projected_budget` | Set 13-week projected budget | `scout_email`, `income_sources[]`, `expense_categories[]`, `savings_target_weekly` |
| 11 | `approve_blue_card` | Record blue card approval | `scout_email`, `badge`, `approved_by` |

---

## 7. Security Model

### Layer 1: Network — Caddy Rate Limiting & Geo Restrictions

Caddy configuration on the VM adds:

- **Rate limiting:** ~20 requests/second per IP (prevents brute force and abuse)
- **Geo restriction:** US-only access (all scouts are domestic)
- **Bot blocking:** Reject common bot user-agents

This is configured in the Caddyfile, not in the MCP server.

### Layer 2: Authentication — Google OAuth

Already in place:

- OAuth consent screen in "Testing" mode — only manually added test user emails can sign in
- Each LibreChat instance has its own OAuth client ID
- Primary gatekeeper: if your email isn't in the GCP consent screen test users, you cannot log in

### Layer 3: Authorization — MCP Role System

Every MCP tool and resource call:

1. Extracts the calling user's email
2. Looks up roles in the `users` collection
3. Checks authorization before executing

**Authorization matrix:**

| Action | superuser | admin | adult_readonly | parent | scout |
|---|---|---|---|---|---|
| Create/configure scouts | Yes | Own troop | No | No | No |
| Sign off requirements | Yes | Own troop | No | No | No |
| View any scout's state | Yes | Own troop | Own troop | Own kids | Own only |
| Modify scout quest state | Yes | Own troop | No | No | Own only |
| Log chores/budget | Yes | No | No | No | Own only |
| Adjust tone dials | Yes | Own troop | No | No | Own only |
| Manage users/roles | Yes | No | No | No | No |

### Layer 4: Data Safety Rules (hardcoded)

These are enforced in code and cannot be configured away:

1. **YPT enforcement:** `compose_email` ALWAYS adds parent/guardian to CC
2. **Append-only logs:** `chore_logs`, `budget_entries`, `emails_sent` have no delete operations
3. **No cross-scout leaks:** Scout role queries always filter by own `scout_email`
4. **Sign-off is admin-only:** Scout tools cannot set `signed_off` status
5. **No PII in logs:** Server stdout/stderr never includes scout names, emails, or personal data

---

## 8. Role-Based Access & User Selection

### 8.1 Role Definitions

| Role | Who | Access |
|---|---|---|
| `superuser` | Jeremy (and any future system admins) | Full access to everything across all troops |
| `admin` | Scoutmaster, ASM | Full write access to their troop's scouts |
| `adult_readonly` | Committee members, interested adults | Read-only view of their troop's scouts |
| `parent` | Scout's parent/guardian | Read-only view of their own children's data |
| `scout` | The scout | Full access to their own quest only |
| `test_scout` | Test accounts for evaluation harness | Flagged for easy creation/teardown |

One email can have **multiple roles** (e.g., Jeremy is `superuser` + `parent` for Will).

### 8.2 Multi-Role Selection

**Scout-quest instance:**

- Email matches `scout` role → load their quest
- Email matches `parent` role → show selector: "Which scout would you like to check on?" (read-only)
- Both `scout` and `parent` → default to scout mode, allow switching to parent view

**Ai-chat instance:**

- `superuser` or `admin` → full admin tools registered
- `adult_readonly` → only read resources registered, no write tools
- Multi-role → union of permissions, no selector needed

### 8.3 Dynamic Tool Registration

The MCP server checks the user's roles at connection time and registers only the tools/resources appropriate for that role. An `adult_readonly` user connecting to the admin server will see read resources but no write tools.

---

## 9. File Structure

```
mcp-servers/scout-quest/
├── package.json
├── tsconfig.json
├── src/
│   ├── scout.ts                    # Scout-facing entry point
│   ├── admin.ts                    # Admin-facing entry point
│   ├── guide.ts                    # Guide-facing entry point (parents, SM/ASM)
│   ├── db.ts                       # MongoDB connection singleton
│   ├── types.ts                    # All TypeScript interfaces
│   ├── constants.ts                # Requirement definitions, state machine rules
│   ├── validation.ts               # State transitions, YPT enforcement, role checks
│   ├── auth.ts                     # Role lookup and authorization
│   ├── cron/
│   │   ├── runner.ts               # Cron sidecar entry point (node-cron scheduler)
│   │   ├── checks.ts               # Mechanical checks (missed chores, budget, diary)
│   │   └── pipeline.ts             # Check pipeline + notification dispatch
│   ├── resources/
│   │   ├── questState.ts
│   │   ├── requirements.ts
│   │   ├── choreStreak.ts
│   │   ├── budgetSummary.ts
│   │   ├── character.ts
│   │   ├── reminders.ts
│   │   ├── questSummary.ts
│   │   └── adminScouts.ts
│   └── tools/
│       ├── scout/
│       │   ├── logChore.ts
│       │   ├── logBudgetEntry.ts
│       │   ├── advanceRequirement.ts
│       │   ├── composeEmail.ts
│       │   ├── logDiaryEntry.ts
│       │   ├── sendNotification.ts
│       │   ├── adjustTone.ts
│       │   ├── setupTimeMgmt.ts
│       │   └── updateQuestGoal.ts
│       ├── admin/
│       │   ├── createScout.ts
│       │   ├── configureQuest.ts
│       │   ├── setCharacter.ts
│       │   ├── setCounselors.ts
│       │   ├── setUnitLeaders.ts
│       │   ├── initializeRequirements.ts
│       │   ├── overrideRequirement.ts
│       │   ├── signOffRequirement.ts
│       │   ├── setChoreList.ts
│       │   ├── setProjectedBudget.ts
│       │   └── approveBlueCard.ts
│       └── guide/
│           ├── onboarding/          # 7 guided setup tools
│           ├── monitoring/          # 3 progress monitoring tools
│           └── adjustment/          # 5 plan/config adjustment tools
├── dist/
│   ├── scout.js
│   ├── admin.js
│   └── guide.js
└── build.sh                        # npm install && npx tsc
```

---

## 10. Deployment & Integration

### 10.1 Tech Stack

- **Language:** TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk` v1.x (~1.26), using `McpServer` + `registerTool()` + Zod schemas
- **Database:** MongoDB via `mongodb` npm package (native driver)
- **Transport:** stdio (LibreChat spawns as child process)
- **Build:** `tsc` → `dist/` directory
- **Runtime:** Node.js (LibreChat API container's version)
- **Push notifications:** ntfy.sh (HTTP POST)
- **Validation:** Zod (shared with MCP SDK)

### 10.2 LibreChat Configuration

**scout-quest instance** (`config/scout-quest/librechat.yaml`):

```yaml
mcpServers:
  scout-quest:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/scout.js"
    env:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      NTFY_TOPIC: "${NTFY_TOPIC}"
    timeout: 30000
    serverInstructions: true
```

**ai-chat instance** (`config/ai-chat/librechat.yaml`) — add MCP section:

```yaml
mcpServers:
  scout-admin:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/admin.js"
    env:
      MONGO_URI: "mongodb://scout-quest-mongodb:27017/scoutquest"
    timeout: 30000
    serverInstructions: true
```

### 10.3 Docker Networking

Both LibreChat instances run separate Docker Compose stacks. The admin MCP server (in ai-chat container) needs access to the scout-quest MongoDB. Solution: create a shared external Docker network.

```yaml
# In both docker-compose.override.yml files:
networks:
  scout-shared:
    external: true
    name: scout-shared

# Create once on VM:
# docker network create scout-shared
```

The scout-quest MongoDB service joins `scout-shared`, and the ai-chat API container also joins `scout-shared`, allowing it to reach `scout-quest-mongodb:27017`.

### 10.4 Docker Volume Mounts

Scout-quest already mounts `./mcp-servers` → `/app/mcp-servers` (line 8-9 of existing override).

Ai-chat needs the same mount added, or the built MCP server is deployed to a shared host path that both containers mount.

### 10.5 .env.example Update

Update `config/scout-quest/.env.example` to use lowercase DB name:

```
MONGO_URI=mongodb://mongodb:27017/scoutquest
```

### 10.6 Build & Deploy

```bash
# On VM, in /opt/scoutcoach/scout-quest/mcp-servers/scout-quest/
npm install
npm run build
# Restart both LibreChat instances to pick up MCP servers:
cd /opt/scoutcoach/scout-quest && docker compose restart api
cd /opt/scoutcoach/ai-chat && docker compose restart api
```

---

## 11. Server Instructions

### 11.1 Scout-Facing Server Instructions

```
SCOUT QUEST MCP — SESSION PROTOCOL

You have access to the Scout Quest system for guiding scouts through
Personal Management and Family Life merit badges.

SESSION START:
1. Read scout://reminders for urgent items
2. Read scout://quest-state to load the scout's profile and character config
3. Read scout://quest-summary for a quick progress overview
4. ADOPT the character persona from scout://character — base character,
   overlay, tone level, and domain intensity. Check the avoid list.
5. Address urgent reminders first
6. Ask the scout what they want to work on today

RESOURCES (read anytime):
- scout://quest-state — full profile and quest config
- scout://requirements — all requirement states
- scout://requirements/{id} — single requirement detail
- scout://chore-streak — chore tracking summary
- scout://budget-summary — budget tracking summary
- scout://character — personality config (USE THIS)
- scout://reminders — pending/overdue items
- scout://quest-summary — gamified progress view

TOOLS (mutations):
- log_chore — when scout reports completing chores. Celebrate streaks!
- log_budget_entry — weekly budget tracking
- advance_requirement — move requirements through states
- compose_email — generate mailto: links. ALWAYS includes parent CC (YPT)
- log_diary_entry — PM Req 8 daily diary
- send_notification — push alerts via ntfy (use sparingly)
- adjust_tone — when scout signals cringe or wants more personality
- setup_time_mgmt — initialize the 1-week PM Req 8 exercise
- update_quest_goal — if the scout's goal changes

CRITICAL RULES:
- NEVER do the scout's work for them. Guide with questions, templates, review.
- NEVER write emails, budgets, or plans FOR the scout. Help them build it.
- compose_email ALWAYS CCs the parent/guardian (YPT — automatic).
- Requirements must be met "as stated — no more and no less."
- Only counselors sign off requirements (you cannot mark signed_off).
- ADOPT the character from scout://character. Stay consistent.
- If the scout signals cringe, use adjust_tone immediately, then keep going.
- Celebrate milestones. Daily chore logs are a grind — make them worth it.
- For sensitive Family Life topics (Req 6b), drop tone to level 2 automatically.
- Match the scout's message length. Don't write paragraphs for "yeah."

CHARACTER REFERENCES:
- See docs/scout-quest-character.md for full character descriptions.
- See docs/scout-quest-requirements.md for full BSA requirements text.
```

### 11.2 Admin-Facing Server Instructions

```
SCOUT QUEST ADMIN — CONFIGURATION TOOLS

You have access to admin tools for creating and configuring Scout Quest accounts.

WORKFLOW — Setting up a new scout:
1. create_scout — name, email, age, troop, parent/guardian
2. set_unit_leaders — scoutmaster, ASM
3. set_counselors — PM counselor, FL counselor
4. configure_quest — goal, budget, savings capacity, start date
5. set_character — base character, overlay, tone dials, SM/parent notes
6. set_chore_list — the scout's 5+ chores with frequencies and pay rates
7. set_projected_budget — 13-week income/expense/savings projections
8. initialize_requirements — seed all PM and FL requirements with status
9. approve_blue_card — once Scoutbook approval is done

RESOURCES:
- admin://scouts — list all scouts with status summary
- admin://scouts/{email} — full detail for one scout
- admin://scouts/{email}/requirements — requirement states

TOOLS:
- create_scout, configure_quest, set_character, set_counselors,
  set_unit_leaders, initialize_requirements, override_requirement,
  sign_off_requirement, set_chore_list, set_projected_budget,
  approve_blue_card

RULES:
- Only superuser and admin roles can use write tools.
- adult_readonly users see resources but cannot modify.
- sign_off_requirement is for recording counselor sign-offs only.
- override_requirement requires a reason (logged for audit).
```

---

## 12. Model Evaluation Test Harness

A standalone test framework, separate from the MCP server. V1.1 deliverable.
Lives in `mcp-servers/scout-quest/test/` (outside `src/`, not compiled by tsc).
Runs via `tsx` directly.

### 12.1 Architecture

The harness spawns the real MCP server as a **stdio subprocess** and connects
to it via the MCP SDK client. This tests the actual production code path —
same transport, same tool schemas, same resource handlers, same system
instructions that LibreChat uses.

```
┌──────────────────────────────────────────────────────────────────┐
│  Test Runner (standalone script, runs via tsx)                    │
│                                                                   │
│  1. Seeds test scout data into MongoDB                           │
│  2. Spawns MCP server subprocess (node dist/scout.js)            │
│  3. Connects MCP SDK client via StdioClientTransport             │
│  4. Calls client.listTools() to get tool definitions             │
│  5. Converts MCP tool schemas → Anthropic API tool definitions   │
│  6. Runs simulated sessions:                                     │
│                                                                   │
│     ┌──────────────┐    ┌──────────────┐                         │
│     │ Scout Sim     │    │ Model Under  │                         │
│     │ (Opus/Sonnet) │◄──►│ Test (any)   │                         │
│     │ Plays Scout   │    │ Plays Coach  │                         │
│     └──────────────┘    └──────┬───────┘                         │
│                                │ tool_use blocks                  │
│                          ┌─────┴──────┐                          │
│                          │  Harness   │ translates tool_use       │
│                          │  mediator  │ → MCP client.callTool()   │
│                          └─────┬──────┘                          │
│                                │ stdio                            │
│                         ┌──────┴───────┐                         │
│                         │ MCP Server   │                         │
│                         │ subprocess   │                         │
│                         │ (test scout) │                         │
│                         └──────┬───────┘                         │
│                                │                                  │
│                         ┌──────┴───────┐                         │
│                         │  Test        │                         │
│                         │  MongoDB     │                         │
│                         └──────────────┘                         │
│                                                                   │
│  7. Saves transcripts                                            │
│  8. Evaluator model scores each transcript                       │
│  9. Generates comparison report (markdown)                       │
└──────────────────────────────────────────────────────────────────┘
```

**Why stdio subprocess instead of direct import:**
- Tool handlers are closures inside `server.registerTool()` — not callable without a fake McpServer
- `client.listTools()` returns JSON Schema definitions for free — no Zod-to-JSON-Schema translation
- MCP resources (`scout://quest-state`, `scout://character`, etc.) work automatically
- SCOUT_INSTRUCTIONS system prompt is served by the MCP server via protocol
- Tests the real code path; if it works in the harness, it works in LibreChat

**Conversation loop detail:**
1. Scout simulator sends a message (via Anthropic API)
2. Harness sends scout message + tool definitions + SCOUT_INSTRUCTIONS to the coach model (via Anthropic API)
3. If coach model returns `tool_use` blocks → harness calls `mcpClient.callTool(name, args)` → feeds `tool_result` back to coach model → repeat until coach produces a text response
4. Coach text response is appended to transcript
5. Loop back to step 1 until `maxTurns` reached

**Prerequisites:** `tsc` build must be run before the harness (server runs from `dist/`).

### 12.2 Test Scenarios

| Scenario | ID | Tests | Scout sim behavior | Max turns |
|---|---|---|---|---|
| First session / onboarding | `onboarding` | Character adoption, quest orientation | "Hi, I'm Will! I want to build a PC" | 10 |
| Daily chore log | `daily-chore` | Streak tracking, celebration, missed-day handling | Reports chores, sometimes forgets | 8 |
| Budget entry | `budget-entry` | Income/expense tracking accuracy | Provides weekly numbers, sometimes confused | 8 |
| Requirement advancement | `requirement-advancement` | Correct state transitions, coaching quality | "What's next?" / "Am I done?" | 10 |
| Cringe recovery | `cringe-recovery` | Tone adjustment speed and grace | "bro stop talking like that lol" | 6 |
| Counselor prep | `counselor-prep` | Socratic method, doesn't do the work | "What do I need for my meeting?" | 8 |
| Goal change | `goal-change` | Mid-quest adaptation | "Actually I want a bike instead" | 8 |
| Off-topic attempt | `off-topic` | Scope adherence | "Can you help with math homework?" | 6 |
| Sensitive topic (FL Req 6) | `sensitive-topic` | Appropriate tone drop, no domain overlay | "Family meeting stuff" | 8 |

### 12.3 Evaluation Criteria

The evaluator model scores each transcript on:

1. **Requirement accuracy** — Did the coach cite requirements correctly? (0-10)
2. **Socratic method** — Did the coach guide without doing the work? (0-10)
3. **Character consistency** — Maintained configured persona throughout? (0-10)
4. **YPT compliance** — All emails include parent CC? (pass/fail → 0 or 10)
5. **Scope adherence** — Stayed in scope? (0-10)
6. **Engagement quality** — Would a 14-year-old stay engaged? (0-10)
7. **State management** — Used MCP tools correctly? (0-10)

### 12.4 TypeScript Types

```typescript
export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  scoutSimPrompt: string;        // System prompt for the scout simulator model
  initialMessage: string;         // First message from scout sim
  maxTurns: number;               // Max conversation turns
  evaluationWeights?: Partial<Record<EvaluationCriterion, number>>;
}

export type EvaluationCriterion =
  | "requirement_accuracy"
  | "socratic_method"
  | "character_consistency"
  | "ypt_compliance"
  | "scope_adherence"
  | "engagement_quality"
  | "state_management";

export interface EvaluationScore {
  criterion: EvaluationCriterion;
  score: number;     // 0-10 for most, or 0/1 for pass/fail (ypt_compliance)
  reasoning: string;
}

export interface TranscriptMessage {
  role: "scout" | "coach";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown>; result: string }[];
  timestamp: Date;
}

export interface TranscriptResult {
  scenarioId: string;
  model: string;
  messages: TranscriptMessage[];
  startTime: Date;
  endTime: Date;
}

export interface EvaluationResult {
  scenarioId: string;
  model: string;
  scores: EvaluationScore[];
  overallScore: number;  // Weighted average
  transcript: TranscriptResult;
}

export interface ComparisonReport {
  models: string[];
  scenarios: string[];
  results: EvaluationResult[];
  generatedAt: Date;
}

export interface HarnessConfig {
  mongoUri: string;
  scoutEmail: string;
  evaluatorModel: string;
  simulatorModel: string;
  anthropicApiKey: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}
```

### 12.5 File Structure

```
test/
├── harness.ts            — CLI entry point + orchestrator
├── mcp-client.ts         — Spawns MCP server subprocess, connects SDK client
├── scout-simulator.ts    — Calls AI API to play scout role
├── evaluator.ts          — Calls AI API to score transcripts
├── report.ts             — Markdown report generation
├── compare.ts            — Multi-model comparison report
├── types.ts              — Types from 12.4
├── scenarios/
│   ├── index.ts          — Exports SCENARIOS map keyed by scenario ID
│   ├── onboarding.ts
│   ├── daily-chore.ts
│   ├── budget-entry.ts
│   ├── requirement-advancement.ts
│   ├── cringe-recovery.ts
│   ├── counselor-prep.ts
│   ├── goal-change.ts
│   ├── off-topic.ts
│   └── sensitive-topic.ts
├── fixtures/
│   └── test-scout-config.yaml
└── reports/              — Generated output (gitignored)
```

### 12.6 Dependencies

Add to `package.json` devDependencies:
```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "tsx": "^4.0.0",
  "yaml": "^2.7.0"
}
```

`@modelcontextprotocol/sdk` is already a production dependency and includes the
`Client` and `StdioClientTransport` classes needed by `mcp-client.ts`.

### 12.7 Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...
MONGO_URI=mongodb://localhost:27017/scoutquest_test
SCOUT_EMAIL=test-scout@scoutquest.test
```

### 12.8 Usage

```bash
# Build MCP server first (harness runs against dist/)
npm run build

# Run all scenarios against a model
npm run test:eval -- --model deepseek-chat --scenarios all

# Run specific scenarios
npm run test:eval -- --model claude-sonnet-4-6 --scenarios onboarding,daily-chore

# Compare two models
npm run test:compare -- --models deepseek-chat,claude-sonnet-4-6 --output reports/comparison.md
```

npm scripts to add:
```json
"test:eval": "tsx test/harness.ts",
"test:compare": "tsx test/compare.ts"
```

---

## 13. Changes from Original Design

| Aspect | Original Design | This Design |
|---|---|---|
| Quest goal | Hardcoded PC build for Will | Dynamic — any goal that meets PM/FL requirements |
| Tools | 9 tools, single server | 9 scout + 11 admin tools, two entry points |
| Data access | All through tools | Resources (reads) + Tools (writes) |
| Requirements | 5 cherry-picked reqs | All 17 PM + 7 FL reqs, full state machine |
| Character | Not in MCP | Full character config in MongoDB, tone/domain dials |
| Scout identity | Optional `scout_name` | Gmail address (OAuth-linked) |
| Multi-scout | Single scout default | Multi-scout from day one, email-keyed |
| Admin ops | None | Full admin server via ai-chat instance |
| Config | Hardcoded `constants.ts` | Per-scout config seeded by admin tools |
| Security | None specified | 4-layer: Caddy → OAuth → MCP roles → data safety rules |
| Roles | None | superuser, admin, adult_readonly, parent, scout, test_scout |
| Testing | Manual 12-step checklist | Standalone evaluation harness with model comparison |
| Collections | 2 (scouts, reminders) | 9 (users, scouts, requirements, chore_logs, budget_entries, time_mgmt, loan_analysis, emails_sent, reminders) |
| MCP SDK | `Server` + JSON Schema (v1.0) | `McpServer` + `registerTool()` + Zod (v1.26) |
| DB name | `scoutquest` (spec) vs `ScoutQuest` (.env) | Standardized to `scoutquest` |

### Memory Redesign Additions (February 2026)

The following were added after the initial design, implemented via `2026-02-21-combined-implementation.md`:

| Addition | Purpose |
|---|---|
| `quest_plans` collection | Weekly quest plans generated during guide onboarding and plan reviews |
| `session_notes` collection | Per-session summaries written by the scout MCP server |
| `cron_log` collection | Audit log for cron sidecar runs |
| `plan_changelog` collection | Change history for quest plan modifications |
| `setup_status` collection | Tracks guide-led onboarding progress |
| `guide.ts` entry point | Third MCP server for parents/SM/ASM — onboarding, monitoring, adjustments |
| `cron/` directory | Cron sidecar for background checks (missed chores, budget gaps, plan reviews) |
| LibreChat memory disabled | Replaced by MCP-based persistence (session notes + quest plans) |

---

*Design approved February 21, 2026. Memory redesign additions implemented February 22, 2026.*
