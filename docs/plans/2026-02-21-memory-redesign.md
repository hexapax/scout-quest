# Scout Quest — Memory Replacement & Cleanup Design

> **Date:** February 21, 2026
> **Status:** Approved design — ready for implementation planning
> **Depends on:** `docs/plans/2026-02-21-mcp-server-redesign.md` (MCP server must be implemented first)
> **Scope:** Replace LibreChat memory with MCP-based persistence, add cron sidecar, clean up docs and config

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Goals](#2-design-goals)
3. [Memory Replacement — New Collections](#3-memory-replacement--new-collections)
4. [New MCP Tools](#4-new-mcp-tools)
5. [New MCP Resources](#5-new-mcp-resources)
6. [Updated Server Instructions](#6-updated-server-instructions)
7. [Cron Sidecar](#7-cron-sidecar)
8. [LibreChat Config Changes](#8-librechat-config-changes)
9. [Documentation Cleanup](#9-documentation-cleanup)
10. [What's Not Changing](#10-whats-not-changing)

---

## 1. Problem Statement

An audit of the quest mechanics implementation revealed three categories of issues:

### 1.1 PC-Build Remnants in Runtime Config

The MCP server was redesigned to support any quest goal, but the LibreChat configuration still hardcodes PC-build references:

- `promptPrefix` in all three Scout Coach presets references "PC-building quest" and "PC build decisions"
- Memory agent instructions reference "hardware parts purchased/installed" and "current phase of PC build quest"
- Memory agent uses the concept of "phases" (Phase 1-4) which was removed in the redesign

### 1.2 LibreChat Memory Duplicates MCP Data

The LibreChat memory system stores four categories (`quest_progress`, `personal_preferences`, `learned_facts`, `conversation_context`) that substantially overlap with MCP resources:

| Memory Category | MCP Equivalent |
|---|---|
| `quest_progress` (requirements, budget, chore streaks) | `scout://requirements`, `scout://budget-summary`, `scout://chore-streak` |
| `learned_facts` (scout name, age, counselors) | `scout://quest-state` |
| `personal_preferences` (communication style) | `scout://character` |
| `conversation_context` | No equivalent — genuine gap |

Research into LibreChat's memory architecture reveals it is a simple key-value store in MongoDB with no semantic search, no vector embeddings, and no special retrieval logic. All entries are dumped wholesale into every request. A secondary LLM call runs on **every message** to manage memory, doubling API costs.

### 1.3 Missing Strategic Planning Layer

The MCP server tracks **state** (where the scout is) but nothing captures **strategy** (how to get the scout through the quest). The agent needs a place to store:

- The dynamic plan for sequencing requirements
- Intermediate milestones for gamification
- Behavioral observations about what engages the scout
- Counselor session batching plans

### 1.4 Outdated Documentation

- `docs/mcp-server-design.md` — Original single-scout, PC-build-specific design (superseded by redesign spec)
- `docs/scout-quest-requirements.md` Section 11 — Outdated data model from pre-redesign era
- `docs/scout-quest-requirements.md` Section 10.5 — State machine uses different casing than code
- MCP server instructions reference docs the AI model cannot access at runtime

---

## 2. Design Goals

1. **Replace LibreChat memory** with MCP-backed collections that give full admin visibility and programmatic review capability
2. **Add a strategic planning layer** — quest plans with intermediate milestones, stored in MongoDB, manageable by the agent and reviewable by a cron job
3. **Add a cron sidecar** — daily automated review for drift detection, notification delivery, inactivity alerts, and session notes backfill
4. **Clean up runtime config** — remove PC-build references, disable LibreChat memory, update promptPrefix to be goal-agnostic
5. **Clean up documentation** — merge useful content from original design into the redesign spec, delete superseded docs, fix inconsistencies
6. **Preserve universal gamification** — intermediate milestones, streak celebrations, and ADHD-friendly chunking techniques should work for any quest goal, not just gaming PC builds

---

## 3. Memory Replacement — New Collections

Four new collections in the `scoutquest` database.

### 3.1 Collection: `quest_plans`

The agent's dynamic roadmap for navigating a scout through the quest. One document per scout, updated in place.

```typescript
interface QuestPlanDocument {
  _id: ObjectId;
  scout_email: string;

  // Current strategy
  current_priorities: string[];      // "Focus on PM Req 1c shopping strategy this week"
  strategy_notes: string;            // Agent's working theory of how to complete the quest

  // Intermediate milestones (gamification checkpoints)
  milestones: {
    id: string;                      // "savings_100", "chore_streak_30"
    label: string;                   // "First $100 saved!"
    category: "savings" | "streak" | "requirement" | "counselor" | "custom";
    target_metric?: string;          // "current_savings >= 100"
    target_date?: Date;
    completed: boolean;
    completed_date?: Date;
    celebrated: boolean;
  }[];

  // Counselor session batching
  next_counselor_session?: {
    badge: "personal_management" | "family_life";
    requirements_to_present: string[];  // ["pm_5", "pm_6"]
    prep_notes: string;
  };

  // Behavioral observations (replaces memory's personal_preferences)
  scout_observations: {
    engagement_patterns: string;     // "More engaged with car analogies than abstract concepts"
    attention_notes: string;         // "Keeps sessions under 10 min or loses focus"
    motivation_triggers: string;     // "Responds well to streak milestones"
    tone_notes: string;              // "Tone 3 is landing well, no cringe signals"
  };

  last_reviewed: Date;               // When the cron job last reviewed this plan
  updated_at: Date;
}
```

**Design rationale:** The plan is a single document updated in place for fast reads at session start. The `plan_changelog` collection (Section 3.4) preserves the full history of changes.

### 3.2 Collection: `session_notes`

Conversation continuity — what happened last session, what's pending. One document per session.

```typescript
interface SessionNoteDocument {
  _id: ObjectId;
  scout_email: string;
  session_date: Date;
  source: "agent" | "cron";          // Who created this note

  // What happened
  topics_discussed: string[];        // "Worked on PM Req 5 insurance explanation"
  progress_made: string;             // "Completed draft of insurance types, needs review"

  // Open threads
  pending_items: string[];           // "Scout said they'd log chores tonight"
  next_session_focus?: string;       // "Review PM Req 5 draft, then start PM Req 6"

  created_at: Date;
}
```

**Design rationale:** One document per session (not per scout) so we preserve a history of session notes. The `scout://last-session` resource returns the most recent entry.

### 3.3 Collection: `cron_log`

Audit trail of everything the cron job does — visible in AdminJS.

```typescript
interface CronLogEntry {
  _id: ObjectId;
  run_date: Date;
  scout_email: string;
  action: "drift_detected" | "session_notes_backfill" | "notification_sent"
        | "plan_review" | "inactivity_alert" | "milestone_check";
  details: string;                   // What happened and why
  model_used?: string;               // Which model was called, if any
  changes_made?: string;             // What was modified
  created_at: Date;
}
```

### 3.4 Collection: `plan_changelog`

Tracks every modification to the quest plan — full audit history.

```typescript
interface PlanChangeLogEntry {
  _id: ObjectId;
  scout_email: string;
  change_date: Date;
  source: "agent" | "cron" | "admin";
  field_changed: string;             // "milestones", "current_priorities", "strategy_notes"
  old_value?: string;                // JSON stringified for complex fields
  new_value: string;
  reason: string;                    // "Scout changed goal from PC to camping gear"
  created_at: Date;
}
```

---

## 4. New MCP Tools

### 4.1 Scout Tool: `update_quest_plan`

Updates the agent's quest plan during conversation when strategy changes.

**Params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `current_priorities` | string[] | no | Replace current priority list |
| `strategy_notes` | string | no | Replace strategy notes |
| `add_milestone` | object | no | Add milestone: `{id, label, category, target_metric?, target_date?}` |
| `complete_milestone` | string | no | Mark milestone ID as completed |
| `scout_observations` | object | no | Update any observation field |
| `next_counselor_session` | object | no | Set/update counselor session plan |
| `reason` | string | yes | Why the plan is changing |

**Side effects:**
- Appends entry to `plan_changelog` with `source: "agent"`, old value, new value, and reason
- Sets `updated_at` on the quest plan document
- If `complete_milestone`: sets `completed: true`, `completed_date: now`

**Auth:** Scout can update their own plan only.

### 4.2 Scout Tool: `log_session_notes`

Captures session summary. The agent is instructed to call this when wrapping up or after significant progress.

**Params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `topics_discussed` | string[] | yes | What was covered this session |
| `progress_made` | string | yes | What got accomplished |
| `pending_items` | string[] | no | What the scout committed to doing |
| `next_session_focus` | string | no | Suggested focus for next session |

**Side effects:**
- Creates a new `session_notes` document with `source: "agent"`

**Auth:** Scout can log notes for their own sessions only.

---

## 5. New MCP Resources

### 5.1 Scout Resources

| Resource URI | Description | Returns |
|---|---|---|
| `scout://quest-plan` | Current quest plan | Full `QuestPlanDocument` (priorities, milestones, observations, counselor prep) |
| `scout://last-session` | Most recent session notes | Latest `SessionNoteDocument` for this scout |

### 5.2 Admin Resources

| Resource URI | Description | Returns |
|---|---|---|
| `admin://scouts/{email}/plan` | Quest plan for a scout | Full `QuestPlanDocument` |
| `admin://scouts/{email}/plan-changelog` | Plan change history | Array of `PlanChangeLogEntry`, ordered by date descending |
| `admin://cron-log` | Recent cron job actions | Array of `CronLogEntry`, filterable by scout/action/date |

---

## 6. Updated Server Instructions

### 6.1 Scout-Facing Server Instructions

The `SCOUT_INSTRUCTIONS` string in `scout.ts` is updated. Changes marked with `[NEW]` and `[CHANGED]`.

```
SCOUT QUEST MCP — SESSION PROTOCOL

You have access to the Scout Quest system for guiding scouts through
Personal Management and Family Life merit badges.

SESSION START:
1. Read scout://reminders for urgent items
2. Read scout://quest-state to load the scout's profile and character config
3. Read scout://quest-plan to load your coaching strategy and milestones   [NEW]
4. Read scout://last-session for conversation continuity                   [NEW]
5. Read scout://quest-summary for a quick progress overview
6. ADOPT the character persona from scout://character — base character,
   overlay, tone level, and domain intensity. Check the avoid list.
7. Address urgent reminders first
8. Pick up where last session left off, or ask what to work on today       [CHANGED]

RESOURCES (read anytime):
- scout://quest-state — full profile and quest config
- scout://quest-plan — your coaching strategy, milestones, observations    [NEW]
- scout://last-session — what happened last session                        [NEW]
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
- update_quest_plan — when your coaching strategy changes               [NEW]
- log_session_notes — capture what happened this session                [NEW]

DURING SESSION:                                                          [NEW]
- When the plan changes significantly, call update_quest_plan
- When a milestone is reached, mark it complete and CELEBRATE using
  the quest overlay vocabulary
- Create intermediate milestones to break long requirements into
  motivating checkpoints (e.g., 30/60/90 days for chores, 4/8/13 weeks
  for budget tracking)
- Use gamification, chunking, and immediate celebration to keep daily
  tracking engaging over the full quest journey

WRAPPING UP:                                                             [NEW]
- Before ending, call log_session_notes to capture what happened
- Include any commitments the scout made
- Note what to focus on next session

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
```

**Removed:** The "CHARACTER REFERENCES" section that pointed to docs the model cannot access at runtime.

### 6.2 Admin-Facing Server Instructions

The `ADMIN_INSTRUCTIONS` in `admin.ts` adds:

```
RESOURCES:
- admin://scouts — list all scouts with status summary
- admin://scouts/{email} — full detail for one scout
- admin://scouts/{email}/plan — quest plan and coaching strategy        [NEW]
- admin://scouts/{email}/plan-changelog — plan change history           [NEW]
- admin://cron-log — recent cron job actions and audit trail             [NEW]
```

---

## 7. Cron Sidecar

A Docker container running a scheduled review process inside the scout-quest Docker Compose stack.

### 7.1 Runtime

- **Image:** `node:24-alpine` (same Node.js as MCP server)
- **Scheduler:** `node-cron` package running inside the container
- **Default schedule:** Daily at 8pm local time (configurable)
- **Entry point:** `dist/cron.js` (new entry point, shares code with MCP server)
- **Networks:** Same Docker network as scout-quest MongoDB

### 7.2 Daily Review Pipeline

For each active scout (`quest_status === "active"`):

```
Step 1: Mechanical checks (no LLM needed)
├── Chore streak risk
│   └── No chore_log entry today after 6pm? → queue ntfy reminder
├── Budget tracking pace
│   └── Current calendar week vs budget_entries count → flag if behind
├── Diary tracking
│   └── PM Req 8c active and today not logged? → queue ntfy reminder
├── Session inactivity
│   ├── Last session_notes > 3 days? → queue "check in" notification
│   └── Last session_notes > 7 days? → queue parent alert
└── Milestone check
    └── Compare quest_plan milestones against MCP state
        └── Any milestones with target_metric now satisfied but not complete?
            → Flag as drift

Step 2: Session notes backfill (cheap LLM)
├── Was there a conversation today with no session_notes from the agent?
│   → Read conversation from LibreChat's MongoDB (read-only)
│   → Extract session notes via Haiku
│   → Store with source: "cron"
│   → Log action to cron_log
└── Skip if agent already logged notes

Step 3: Plan review (triggered, not routine)
├── Only runs if:
│   ├── Step 1 found drift, OR
│   └── quest_plan.last_reviewed > 7 days ago
├── Uses configurable reasoning model (default: Sonnet)
├── Reads: quest_plan + all requirement states + chore_streak + budget_summary
├── Produces: suggested plan updates (priorities, milestones, strategy)
├── Writes updates to quest_plan with source: "cron"
├── Logs all changes to plan_changelog with full reasoning
└── Logs action to cron_log

Step 4: Notifications
├── Send accumulated ntfy notifications (batched, not spammed)
├── Parent alerts sent via separate ntfy topic (configurable)
└── Log all notifications to cron_log
```

### 7.3 Configuration

```typescript
interface CronConfig {
  schedule: string;                    // "0 20 * * *" (8pm daily)
  models: {
    backfill: string;                  // "claude-haiku-4-5-20251001"
    plan_review: string;               // "claude-sonnet-4-6"
  };
  thresholds: {
    session_inactivity_reminder_days: number;  // default: 3
    session_inactivity_parent_alert_days: number; // default: 7
    plan_review_staleness_days: number;  // default: 7
  };
  ntfy: {
    scout_topic: string;               // Push notifications to scout
    parent_topic?: string;             // Separate topic for parent alerts
  };
}
```

Configuration is passed via environment variables or a config file mounted into the container.

### 7.4 Cross-Database Access

The cron job accesses two MongoDB databases:

| Database | Access | Purpose |
|---|---|---|
| `scoutquest` | Read + Write | Quest plans, session notes, requirements, chore logs, cron log |
| `librechat` | Read only | Conversations, for session notes backfill when agent forgot |

Both databases run on the same MongoDB instance. The cron job connects via two separate URIs.

### 7.5 Docker Compose

```yaml
# Added to config/scout-quest/docker-compose.override.yml
services:
  cron:
    image: node:24-alpine
    container_name: scout-quest-cron
    volumes:
      - ./mcp-servers/scout-quest/dist:/app/dist:ro
      - ./mcp-servers/scout-quest/node_modules:/app/node_modules:ro
      - ./mcp-servers/scout-quest/package.json:/app/package.json:ro
    environment:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      LIBRECHAT_MONGO_URI: "mongodb://mongodb:27017/librechat"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
      NTFY_TOPIC: "${NTFY_TOPIC}"
      CRON_SCHEDULE: "0 20 * * *"
    command: ["node", "/app/dist/cron.js"]
    restart: unless-stopped
    depends_on:
      - mongodb
```

### 7.6 File Structure Addition

```
mcp-servers/scout-quest/src/
├── cron.ts                          # Cron entry point (new)
├── cron/
│   ├── pipeline.ts                  # Main review pipeline
│   ├── mechanicalChecks.ts          # Step 1: no-LLM checks
│   ├── sessionBackfill.ts           # Step 2: backfill session notes
│   ├── planReview.ts                # Step 3: LLM-driven plan review
│   └── notifications.ts            # Step 4: send queued notifications
```

---

## 8. LibreChat Config Changes

### 8.1 Disable Memory

In `config/scout-quest/librechat.yaml`:

```yaml
# Replace the entire memory block with:
memory:
  disabled: true
```

This eliminates:
- The secondary LLM call on every message (cost savings)
- The stale/conflicting memory state
- The PC-build-specific memory agent instructions

### 8.2 Update promptPrefix

Replace the promptPrefix in all three Scout Coach presets (Claude, Gemini, GPT) with a goal-agnostic version:

```yaml
promptPrefix: |
  You are Scout Coach, an AI mentor guiding Boy Scouts through Personal
  Management and Family Life merit badges via a personally meaningful
  savings quest.
  You have access to MCP tools and resources that track quest progress,
  chores, budgets, merit badge requirements, and your coaching plan.
  Read your resources at session start to load the scout's profile,
  character, plan, and last session context.
  Adopt the character persona from scout://character.
  Keep responses encouraging, age-appropriate, and matched to the
  scout's message length.
  Use gamification, intermediate milestones, and the quest overlay
  vocabulary to keep daily tracking engaging over the full 13-week journey.
```

---

## 9. Documentation Cleanup

### 9.1 Delete `docs/mcp-server-design.md`

The original single-scout, PC-build-specific design is superseded by the redesign spec. Git history preserves the original for reference.

### 9.2 Update `docs/scout-quest-requirements.md`

**Section 10.5 — State machine:** Align status names with code convention (lowercase: `submitted` not `SUBMITTED_TO_COUNSELOR`).

**Section 11 — MCP Server Data Model:** Replace the 200-line outdated YAML data model with a pointer:

```markdown
## 11. MCP Server Data Model

See `docs/plans/2026-02-21-mcp-server-redesign.md` Section 4 for the authoritative
data model, including all collections, schemas, and the requirement state machine.
```

### 9.3 Update `docs/plans/2026-02-21-mcp-server-redesign.md`

Merge in new components from this design:

- **Section 4:** Add `quest_plans`, `session_notes`, `cron_log`, `plan_changelog` collection schemas
- **Section 5:** Add new scout resources (`scout://quest-plan`, `scout://last-session`) and admin resources (`admin://scouts/{email}/plan`, `admin://scouts/{email}/plan-changelog`, `admin://cron-log`)
- **Section 6:** Add `update_quest_plan` and `log_session_notes` scout tools
- **Section 9:** Add cron sidecar file structure
- **Section 10:** Add cron sidecar deployment configuration (Docker Compose, config)
- **Section 11:** Update server instructions with expanded session protocol
- **Section 13:** Update "Changes from Original Design" table

Also update throughout:
- Remove references to LibreChat memory as a system component
- Ensure all quest goal examples are generic (use the PC build as one example among several)
- Add universal gamification principles (intermediate milestones, streak celebrations, quest-overlay vocabulary)

### 9.4 Update `docs/architecture.md`

- Add cron sidecar to the architecture diagram
- Remove any references to LibreChat memory as a component
- Add the four new collections to the database description

### 9.5 Remove Inaccessible Doc References

Remove from `SCOUT_INSTRUCTIONS` in `scout.ts`:
```
CHARACTER REFERENCES:
- See docs/scout-quest-character.md for full character descriptions.
- See docs/scout-quest-requirements.md for full BSA requirements text.
```

The AI model cannot read these files at runtime. Character config comes from `scout://character`. Requirement definitions are embedded in `constants.ts`.

---

## 10. What's Not Changing

To be explicit about scope boundaries:

- **Existing MCP tools** — All 9 scout tools and 11 admin tools stay as-is
- **Existing collections** — All 9 collections (`users`, `scouts`, `requirements`, `chore_logs`, `budget_entries`, `time_mgmt`, `loan_analysis`, `emails_sent`, `reminders`) stay as-is
- **Character system** — Two-layer model (base + overlay), `scout://character` resource, `adjust_tone` tool — all stay
- **Requirement state machine** — All transitions in `constants.ts` stay as implemented
- **Auth model** — Role-based access stays; new tools/resources follow the same authorization patterns
- **Core server instruction rules** — Socratic method, YPT enforcement, "no more no less," counselor-only sign-off — all stay
- **Docker deployment model** — Same VM, same Docker Compose stacks, same deploy pipeline

---

*Design approved February 21, 2026. Ready for implementation planning via writing-plans skill.*
