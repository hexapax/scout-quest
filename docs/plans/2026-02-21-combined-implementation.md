# Scout Quest — Combined Implementation Plan

> **Status:** Implementation plan — source of truth
>
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement three designs in coordinated order: memory redesign (quest plans, session notes, cron sidecar), guide endpoint (parent/leader-facing MCP entry point), and admin app updates — plus config and doc cleanup.

**Architecture:** All three designs share the same TypeScript MCP codebase (`mcp-servers/scout-quest/`) and MongoDB (`scoutquest`). Type and auth changes land first since both memory and guide designs depend on them. New collections/tools/resources follow. Cron sidecar and guide endpoint are independent after the shared foundation. Admin app models come last since they depend on all collections existing.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` v1.x, MongoDB (native driver), Zod, vitest, node-cron, AdminJS v7, Mongoose

**Design docs:**
- `docs/plans/2026-02-21-memory-redesign.md` — Memory replacement, cron sidecar, config/doc cleanup
- `docs/plans/2026-02-21-guide-endpoint-design.md` — Guide endpoint design
- `docs/plans/2026-02-21-mcp-server-redesign.md` — Base MCP server spec (already implemented)

**Supersedes:** The standalone implementation plans (`2026-02-21-guide-endpoint-implementation.md`, `2026-02-21-mcp-server-implementation.md`) are superseded by this combined plan.

---

## Task Overview

| # | Task | Design Source | Depends On |
|---|------|--------------|------------|
| 1 | Rename `parent` → `guide` role + add ScoutDocument fields | Guide | — |
| 2 | Add memory redesign types + db accessors | Memory | — |
| 3 | Update auth for guide role + new actions | Guide + Memory | 1 |
| 4 | Scout tools: `update_quest_plan` and `log_session_notes` | Memory | 2 |
| 5 | Scout resources: `quest-plan` and `last-session` | Memory | 2 |
| 6 | Admin resources: plan, plan-changelog, cron-log | Memory | 2 |
| 7 | Update scout and admin server instructions | Memory | 4, 5, 6 |
| 8 | Guide entry point + guide resources | Guide | 1, 3 |
| 9 | Guide onboarding tools (7 tools) | Guide | 1, 3, 8 |
| 10 | Guide monitoring tools (3 tools) | Guide | 8 |
| 11 | Guide adjustment tools (5 tools) | Guide | 8 |
| 12 | Cron sidecar: mechanical checks + pipeline | Memory | 2 |
| 13 | Cron sidecar: session backfill + plan review | Memory | 12 |
| 14 | Cron sidecar: Docker + deployment config | Memory | 13 |
| 15 | Admin app: new collection models | Memory + Guide | 2, 8 |
| 16 | LibreChat config: disable memory, update presets, add guide MCP | Memory + Guide | 7, 8 |
| 17 | Doc cleanup: delete old design, fix requirements doc, update redesign spec | Memory | All |

---

### Task 1: Rename `parent` → `guide` Role + Add ScoutDocument Fields

**Files:**
- Modify: `mcp-servers/scout-quest/src/types.ts:13-19` (Role union)
- Modify: `mcp-servers/scout-quest/src/types.ts:31-112` (ScoutDocument)
- Modify: `mcp-servers/scout-quest/src/__tests__/auth.test.ts`
- Modify: `mcp-servers/scout-quest/src/auth.ts:45` (parent → guide)
- Modify: `mcp-servers/scout-quest/src/tools/admin/createScout.ts:46` (parent → guide)

**Step 1: Update the Role union type in types.ts**

Change line 17 from:
```typescript
  | { type: "parent"; scout_emails: string[] }
```
to:
```typescript
  | { type: "guide"; scout_emails: string[] }
```

**Step 2: Add new fields to ScoutDocument**

After `patrol?: string;` (line 37), add:
```typescript
  interests?: {
    likes: string[];
    dislikes: string[];
    motivations: string[];
  };
```

After `parent_guardian: ContactInfo;` (line 81), add:
```typescript
  guide_email: string;
```

After `budget_projected?` block (line 108), add:
```typescript
  session_limits?: {
    max_minutes_per_day: number;
    allowed_days?: string[];
  };
```

**Step 3: Add SetupStatusDocument type**

At the end of `types.ts`, after `ReminderDocument`, add:
```typescript
// --- Setup Status (guide onboarding) ---

export type SetupStepStatus = "pending" | "complete" | "skipped" | "delegated_to_scout";

export interface SetupStep {
  id: string;
  label: string;
  status: SetupStepStatus;
  completed_at?: Date;
  delegated_at?: Date;
}

export interface SetupStatusDocument {
  _id?: ObjectId;
  scout_email: string;
  guide_email: string;
  steps: SetupStep[];
  created_at: Date;
  updated_at: Date;
}
```

**Step 4: Update auth.ts — rename `parent` to `guide`**

In `auth.ts` line 45, change:
```typescript
    if (role.type === "parent") {
```
to:
```typescript
    if (role.type === "guide") {
```

**Step 5: Update createScout.ts — rename `parent` to `guide`**

In `createScout.ts` line 46, change:
```typescript
          $addToSet: { roles: { type: "parent" as const, scout_emails: [email] } },
```
to:
```typescript
          $addToSet: { roles: { type: "guide" as const, scout_emails: [email] } },
```

Also in `createScout.ts`, after the `parent_guardian` insertion (line 90), add:
```typescript
        guide_email: parent_email,
```

**Step 6: Update auth tests**

In `auth.test.ts`, change all `type: "parent"` to `type: "guide"` and rename the test from "parent can view own kids only" to "guide can view own kids only":

Line 37: `{ type: "parent", scout_emails: ...}` → `{ type: "guide", scout_emails: ...}`
Line 50: `{ type: "parent", scout_emails: ...}` → `{ type: "guide", scout_emails: ...}`
Line 36 test name: `"parent can view own kids only"` → `"guide can view linked scouts only"`

**Step 7: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 8: Commit**

```
git add mcp-servers/scout-quest/src/types.ts mcp-servers/scout-quest/src/auth.ts mcp-servers/scout-quest/src/tools/admin/createScout.ts mcp-servers/scout-quest/src/__tests__/auth.test.ts
git commit -m "refactor: rename parent role to guide, add guide_email and setup status types"
```

---

### Task 2: Add Memory Redesign Types + DB Accessors

**Files:**
- Modify: `mcp-servers/scout-quest/src/types.ts` (add 4 new interfaces)
- Modify: `mcp-servers/scout-quest/src/db.ts` (add 4 new collection accessors)
- Test: `mcp-servers/scout-quest/src/__tests__/db.test.ts` (verify accessors)

**Step 1: Add QuestPlanDocument to types.ts**

After `SetupStatusDocument` (added in Task 1), add:
```typescript
// --- Quest Plans (memory redesign) ---

export interface QuestPlanDocument {
  _id?: ObjectId;
  scout_email: string;
  current_priorities: string[];
  strategy_notes: string;
  milestones: {
    id: string;
    label: string;
    category: "savings" | "streak" | "requirement" | "counselor" | "custom";
    target_metric?: string;
    target_date?: Date;
    completed: boolean;
    completed_date?: Date;
    celebrated: boolean;
  }[];
  next_counselor_session?: {
    badge: "personal_management" | "family_life";
    requirements_to_present: string[];
    prep_notes: string;
  };
  scout_observations: {
    engagement_patterns: string;
    attention_notes: string;
    motivation_triggers: string;
    tone_notes: string;
  };
  last_reviewed: Date;
  updated_at: Date;
}

// --- Session Notes (memory redesign) ---

export interface SessionNoteDocument {
  _id?: ObjectId;
  scout_email: string;
  session_date: Date;
  source: "agent" | "cron";
  topics_discussed: string[];
  progress_made: string;
  pending_items: string[];
  next_session_focus?: string;
  created_at: Date;
}

// --- Cron Log (memory redesign) ---

export type CronAction =
  | "drift_detected"
  | "session_notes_backfill"
  | "notification_sent"
  | "plan_review"
  | "inactivity_alert"
  | "milestone_check";

export interface CronLogEntry {
  _id?: ObjectId;
  run_date: Date;
  scout_email: string;
  action: CronAction;
  details: string;
  model_used?: string;
  changes_made?: string;
  created_at: Date;
}

// --- Plan Changelog (memory redesign) ---

export interface PlanChangeLogEntry {
  _id?: ObjectId;
  scout_email: string;
  change_date: Date;
  source: "agent" | "cron" | "admin";
  field_changed: string;
  old_value?: string;
  new_value: string;
  reason: string;
  created_at: Date;
}
```

**Step 2: Add collection accessors to db.ts**

Add these imports to the import statement at the top of `db.ts`:
```typescript
import type {
  UserDocument, ScoutDocument, RequirementDocument,
  ChoreLogEntry, BudgetEntry, TimeMgmtDocument,
  LoanAnalysisDocument, EmailRecord, ReminderDocument,
  SetupStatusDocument, QuestPlanDocument, SessionNoteDocument,
  CronLogEntry, PlanChangeLogEntry
} from "./types.js";
```

Add these accessor functions at the end of `db.ts`:
```typescript
export async function setupStatus(): Promise<Collection<SetupStatusDocument>> {
  return (await getDb()).collection("setup_status");
}
export async function questPlans(): Promise<Collection<QuestPlanDocument>> {
  return (await getDb()).collection("quest_plans");
}
export async function sessionNotes(): Promise<Collection<SessionNoteDocument>> {
  return (await getDb()).collection("session_notes");
}
export async function cronLog(): Promise<Collection<CronLogEntry>> {
  return (await getDb()).collection("cron_log");
}
export async function planChangelog(): Promise<Collection<PlanChangeLogEntry>> {
  return (await getDb()).collection("plan_changelog");
}
```

**Step 3: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All existing tests pass

**Step 4: Commit**

```
git add mcp-servers/scout-quest/src/types.ts mcp-servers/scout-quest/src/db.ts
git commit -m "feat: add quest plan, session notes, cron log, plan changelog types and db accessors"
```

---

### Task 3: Update Auth for Guide Role + New Actions

**Files:**
- Modify: `mcp-servers/scout-quest/src/auth.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/auth.test.ts`

**Step 1: Write failing tests for guide write actions and new scout actions**

Add to `auth.test.ts`:
```typescript
  it("guide can use guide write actions on linked scouts", () => {
    const roles: Role[] = [{ type: "guide", scout_emails: ["will@test.com"] }];
    expect(canAccess(roles, "setup_scout_profile", { scout_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "set_scout_interests", { scout_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "adjust_character", { scout_email: "will@test.com" })).toBe(true);
  });

  it("guide cannot use guide write actions on unlinked scouts", () => {
    const roles: Role[] = [{ type: "guide", scout_emails: ["will@test.com"] }];
    expect(canAccess(roles, "setup_scout_profile", { scout_email: "other@test.com" })).toBe(false);
  });

  it("guide cannot use admin-only actions", () => {
    const roles: Role[] = [{ type: "guide", scout_emails: ["will@test.com"] }];
    expect(canAccess(roles, "sign_off_requirement", { scout_email: "will@test.com" })).toBe(false);
    expect(canAccess(roles, "override_requirement", { scout_email: "will@test.com" })).toBe(false);
  });

  it("scout can use quest plan actions on own data", () => {
    const roles: Role[] = [{ type: "scout" }];
    expect(canAccess(roles, "update_quest_plan", { scout_email: "will@test.com", user_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "log_session_notes", { scout_email: "will@test.com", user_email: "will@test.com" })).toBe(true);
  });
```

**Step 2: Run tests to verify they fail**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: New tests FAIL (guide write actions and new scout actions not recognized)

**Step 3: Update auth.ts**

Add `GUIDE_WRITE_ACTIONS` array after `ADMIN_WRITE_ACTIONS`:
```typescript
const GUIDE_WRITE_ACTIONS = [
  "setup_scout_profile", "set_scout_interests", "set_quest_goal",
  "set_chore_list_guide", "set_budget_plan", "set_character_preferences",
  "set_session_limits", "adjust_scout_profile", "adjust_quest_goal",
  "adjust_character", "adjust_delegation", "flag_conversation",
  "get_conversation_detail", "send_notification_guide",
];
```

Add `update_quest_plan` and `log_session_notes` to `SCOUT_ACTIONS`:
```typescript
const SCOUT_ACTIONS = [
  "log_chore", "log_budget_entry", "advance_requirement", "compose_email",
  "log_diary_entry", "send_notification", "adjust_tone", "setup_time_mgmt",
  "update_quest_goal", "update_quest_plan", "log_session_notes",
];
```

Update the `guide` role check (currently handles reads only) to also handle guide writes:
```typescript
    if (role.type === "guide") {
      if (READ_ACTIONS.includes(action)) {
        if (context.scout_email && role.scout_emails.includes(context.scout_email)) return true;
      }
      if (GUIDE_WRITE_ACTIONS.includes(action)) {
        if (context.scout_email && role.scout_emails.includes(context.scout_email)) return true;
      }
    }
```

**Step 4: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```
git add mcp-servers/scout-quest/src/auth.ts mcp-servers/scout-quest/src/__tests__/auth.test.ts
git commit -m "feat: add guide write actions and quest plan scout actions to auth"
```

---

### Task 4: Scout Tools — `update_quest_plan` and `log_session_notes`

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/scout/updateQuestPlan.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/logSessionNotes.ts`
- Modify: `mcp-servers/scout-quest/src/tools/scout/index.ts`

**Step 1: Create `updateQuestPlan.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { questPlans, planChangelog } from "../../db.js";

export function registerUpdateQuestPlan(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "update_quest_plan",
    {
      title: "Update Quest Plan",
      description: "Update your coaching strategy, milestones, or observations. Logs all changes to the plan changelog.",
      inputSchema: {
        current_priorities: z.array(z.string()).optional().describe("Replace current priority list"),
        strategy_notes: z.string().optional().describe("Replace strategy notes"),
        add_milestone: z.object({
          id: z.string(),
          label: z.string(),
          category: z.enum(["savings", "streak", "requirement", "counselor", "custom"]),
          target_metric: z.string().optional(),
          target_date: z.string().date().optional(),
        }).optional().describe("Add a new milestone"),
        complete_milestone: z.string().optional().describe("Mark milestone ID as completed"),
        scout_observations: z.object({
          engagement_patterns: z.string().optional(),
          attention_notes: z.string().optional(),
          motivation_triggers: z.string().optional(),
          tone_notes: z.string().optional(),
        }).optional().describe("Update behavioral observations"),
        next_counselor_session: z.object({
          badge: z.enum(["personal_management", "family_life"]),
          requirements_to_present: z.array(z.string()),
          prep_notes: z.string(),
        }).optional().describe("Set/update counselor session plan"),
        reason: z.string().describe("Why the plan is changing"),
      },
    },
    async (params) => {
      const plansCol = await questPlans();
      const changelogCol = await planChangelog();
      const now = new Date();

      // Get or create the plan
      let plan = await plansCol.findOne({ scout_email: scoutEmail });
      if (!plan) {
        await plansCol.insertOne({
          scout_email: scoutEmail,
          current_priorities: [],
          strategy_notes: "",
          milestones: [],
          scout_observations: {
            engagement_patterns: "",
            attention_notes: "",
            motivation_triggers: "",
            tone_notes: "",
          },
          last_reviewed: now,
          updated_at: now,
        });
        plan = await plansCol.findOne({ scout_email: scoutEmail });
      }

      const changes: string[] = [];

      if (params.current_priorities) {
        await changelogCol.insertOne({
          scout_email: scoutEmail,
          change_date: now,
          source: "agent",
          field_changed: "current_priorities",
          old_value: JSON.stringify(plan!.current_priorities),
          new_value: JSON.stringify(params.current_priorities),
          reason: params.reason,
          created_at: now,
        });
        await plansCol.updateOne(
          { scout_email: scoutEmail },
          { $set: { current_priorities: params.current_priorities, updated_at: now } },
        );
        changes.push("Updated priorities");
      }

      if (params.strategy_notes) {
        await changelogCol.insertOne({
          scout_email: scoutEmail,
          change_date: now,
          source: "agent",
          field_changed: "strategy_notes",
          old_value: plan!.strategy_notes,
          new_value: params.strategy_notes,
          reason: params.reason,
          created_at: now,
        });
        await plansCol.updateOne(
          { scout_email: scoutEmail },
          { $set: { strategy_notes: params.strategy_notes, updated_at: now } },
        );
        changes.push("Updated strategy notes");
      }

      if (params.add_milestone) {
        const milestone = {
          ...params.add_milestone,
          target_date: params.add_milestone.target_date
            ? new Date(params.add_milestone.target_date)
            : undefined,
          completed: false,
          completed_date: undefined,
          celebrated: false,
        };
        await plansCol.updateOne(
          { scout_email: scoutEmail },
          { $push: { milestones: milestone }, $set: { updated_at: now } },
        );
        await changelogCol.insertOne({
          scout_email: scoutEmail,
          change_date: now,
          source: "agent",
          field_changed: "milestones",
          new_value: JSON.stringify(milestone),
          reason: params.reason,
          created_at: now,
        });
        changes.push(`Added milestone: ${milestone.label}`);
      }

      if (params.complete_milestone) {
        const milestoneId = params.complete_milestone;
        await plansCol.updateOne(
          { scout_email: scoutEmail, "milestones.id": milestoneId },
          {
            $set: {
              "milestones.$.completed": true,
              "milestones.$.completed_date": now,
              updated_at: now,
            },
          },
        );
        await changelogCol.insertOne({
          scout_email: scoutEmail,
          change_date: now,
          source: "agent",
          field_changed: "milestones",
          new_value: JSON.stringify({ id: milestoneId, completed: true }),
          reason: params.reason,
          created_at: now,
        });
        changes.push(`Completed milestone: ${milestoneId}`);
      }

      if (params.scout_observations) {
        const updates: Record<string, string> = {};
        for (const [key, value] of Object.entries(params.scout_observations)) {
          if (value !== undefined) {
            updates[`scout_observations.${key}`] = value;
          }
        }
        if (Object.keys(updates).length > 0) {
          await plansCol.updateOne(
            { scout_email: scoutEmail },
            { $set: { ...updates, updated_at: now } },
          );
          await changelogCol.insertOne({
            scout_email: scoutEmail,
            change_date: now,
            source: "agent",
            field_changed: "scout_observations",
            old_value: JSON.stringify(plan!.scout_observations),
            new_value: JSON.stringify(params.scout_observations),
            reason: params.reason,
            created_at: now,
          });
          changes.push("Updated scout observations");
        }
      }

      if (params.next_counselor_session) {
        await plansCol.updateOne(
          { scout_email: scoutEmail },
          { $set: { next_counselor_session: params.next_counselor_session, updated_at: now } },
        );
        await changelogCol.insertOne({
          scout_email: scoutEmail,
          change_date: now,
          source: "agent",
          field_changed: "next_counselor_session",
          new_value: JSON.stringify(params.next_counselor_session),
          reason: params.reason,
          created_at: now,
        });
        changes.push("Updated counselor session plan");
      }

      return {
        content: [{
          type: "text",
          text: changes.length > 0
            ? `Quest plan updated: ${changes.join(", ")}. Reason: ${params.reason}`
            : "No changes specified.",
        }],
      };
    },
  );
}
```

**Step 2: Create `logSessionNotes.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionNotes } from "../../db.js";

export function registerLogSessionNotes(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "log_session_notes",
    {
      title: "Log Session Notes",
      description: "Capture what happened this session — topics, progress, pending items, next focus. Call this when wrapping up.",
      inputSchema: {
        topics_discussed: z.array(z.string()).min(1).describe("What was covered this session"),
        progress_made: z.string().describe("What got accomplished"),
        pending_items: z.array(z.string()).optional().describe("What the scout committed to doing"),
        next_session_focus: z.string().optional().describe("Suggested focus for next session"),
      },
    },
    async ({ topics_discussed, progress_made, pending_items, next_session_focus }) => {
      const col = await sessionNotes();
      const now = new Date();

      await col.insertOne({
        scout_email: scoutEmail,
        session_date: now,
        source: "agent",
        topics_discussed,
        progress_made,
        pending_items: pending_items ?? [],
        next_session_focus,
        created_at: now,
      });

      const parts = [
        `Session notes saved. Topics: ${topics_discussed.join(", ")}.`,
        `Progress: ${progress_made}.`,
      ];
      if (pending_items?.length) parts.push(`Pending: ${pending_items.join(", ")}.`);
      if (next_session_focus) parts.push(`Next session: ${next_session_focus}.`);

      return { content: [{ type: "text", text: parts.join(" ") }] };
    },
  );
}
```

**Step 3: Register both tools in scout/index.ts**

Add imports:
```typescript
import { registerUpdateQuestPlan } from "./updateQuestPlan.js";
import { registerLogSessionNotes } from "./logSessionNotes.js";
```

Add registrations at the end of `registerScoutTools`:
```typescript
  registerUpdateQuestPlan(server, scoutEmail);
  registerLogSessionNotes(server, scoutEmail);
```

**Step 4: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```
git add mcp-servers/scout-quest/src/tools/scout/updateQuestPlan.ts mcp-servers/scout-quest/src/tools/scout/logSessionNotes.ts mcp-servers/scout-quest/src/tools/scout/index.ts
git commit -m "feat: add update_quest_plan and log_session_notes scout tools"
```

---

### Task 5: Scout Resources — `quest-plan` and `last-session`

**Files:**
- Create: `mcp-servers/scout-quest/src/resources/questPlan.ts`
- Create: `mcp-servers/scout-quest/src/resources/lastSession.ts`
- Modify: `mcp-servers/scout-quest/src/resources/index.ts`

**Step 1: Create `questPlan.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { questPlans } from "../db.js";

export function registerQuestPlan(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "quest_plan",
    "scout://quest-plan",
    {
      title: "Quest Plan",
      description: "Your coaching strategy — priorities, milestones, observations, counselor prep.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await questPlans();
      const plan = await col.findOne({ scout_email: scoutEmail });

      if (!plan) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ status: "no_plan", message: "No quest plan yet. Use update_quest_plan to create one." }),
          }],
        };
      }

      const { _id, ...planData } = plan;
      return { contents: [{ uri: uri.href, text: JSON.stringify(planData) }] };
    },
  );
}
```

**Step 2: Create `lastSession.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessionNotes } from "../db.js";

export function registerLastSession(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "last_session",
    "scout://last-session",
    {
      title: "Last Session Notes",
      description: "What happened in the most recent session — topics, progress, pending items.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await sessionNotes();
      const latest = await col.findOne(
        { scout_email: scoutEmail },
        { sort: { session_date: -1 } },
      );

      if (!latest) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ status: "no_sessions", message: "No previous sessions recorded." }),
          }],
        };
      }

      const { _id, ...noteData } = latest;
      return { contents: [{ uri: uri.href, text: JSON.stringify(noteData) }] };
    },
  );
}
```

**Step 3: Register in resources/index.ts**

Add imports:
```typescript
import { registerQuestPlan } from "./questPlan.js";
import { registerLastSession } from "./lastSession.js";
```

Add to `registerScoutResources` function:
```typescript
  registerQuestPlan(server, scoutEmail);
  registerLastSession(server, scoutEmail);
```

**Step 4: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```
git add mcp-servers/scout-quest/src/resources/questPlan.ts mcp-servers/scout-quest/src/resources/lastSession.ts mcp-servers/scout-quest/src/resources/index.ts
git commit -m "feat: add quest-plan and last-session scout resources"
```

---

### Task 6: Admin Resources — Plan, Plan-Changelog, Cron-Log

**Files:**
- Modify: `mcp-servers/scout-quest/src/resources/adminScouts.ts`

**Step 1: Add admin resources for quest plan, changelog, and cron log**

Add imports at the top of `adminScouts.ts`:
```typescript
import { scouts, requirements, questPlans, planChangelog, cronLog } from "../db.js";
```

At the end of `registerAdminScouts`, add three new resources:

```typescript
  // Quest plan for a scout
  server.registerResource(
    "admin_scout_plan",
    new ResourceTemplate("admin://scouts/{email}/plan", { list: undefined }),
    {
      title: "Scout Quest Plan",
      description: "Quest plan and coaching strategy for a scout (admin view).",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const col = await questPlans();
      const plan = await col.findOne({ scout_email: email });
      if (!plan) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "No quest plan found" }) }] };
      }
      const { _id, ...planData } = plan;
      return { contents: [{ uri: uri.href, text: JSON.stringify(planData) }] };
    },
  );

  // Plan changelog for a scout
  server.registerResource(
    "admin_scout_plan_changelog",
    new ResourceTemplate("admin://scouts/{email}/plan-changelog", { list: undefined }),
    {
      title: "Plan Change History",
      description: "Full audit history of quest plan changes for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const col = await planChangelog();
      const entries = await col.find({ scout_email: email })
        .sort({ change_date: -1 })
        .limit(50)
        .toArray();
      const clean = entries.map(({ _id, ...e }) => e);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );

  // Cron log (all scouts)
  server.registerResource(
    "admin_cron_log",
    "admin://cron-log",
    {
      title: "Cron Job Log",
      description: "Recent cron job actions and audit trail across all scouts.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await cronLog();
      const entries = await col.find({})
        .sort({ run_date: -1 })
        .limit(100)
        .toArray();
      const clean = entries.map(({ _id, ...e }) => e);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );
```

**Step 2: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 3: Commit**

```
git add mcp-servers/scout-quest/src/resources/adminScouts.ts
git commit -m "feat: add admin resources for quest plan, plan changelog, and cron log"
```

---

### Task 7: Update Scout and Admin Server Instructions

**Files:**
- Modify: `mcp-servers/scout-quest/src/scout.ts` (SCOUT_INSTRUCTIONS)
- Modify: `mcp-servers/scout-quest/src/admin.ts` (ADMIN_INSTRUCTIONS)

**Step 1: Replace SCOUT_INSTRUCTIONS in scout.ts**

Replace the entire `SCOUT_INSTRUCTIONS` constant (lines 6-51) with the updated version from the memory redesign design doc Section 6.1. The full text is in `docs/plans/2026-02-21-memory-redesign.md` lines 264-331.

Key changes:
- SESSION START adds steps 3 (quest-plan) and 4 (last-session)
- RESOURCES adds `scout://quest-plan` and `scout://last-session`
- TOOLS adds `update_quest_plan` and `log_session_notes`
- New sections: DURING SESSION (milestone celebrations, gamification) and WRAPPING UP (log session notes)
- Remove the CHARACTER REFERENCES section that points to inaccessible docs

**Step 2: Update ADMIN_INSTRUCTIONS in admin.ts**

Add to the RESOURCES section (after line 23):
```
- admin://scouts/{email}/plan — quest plan and coaching strategy
- admin://scouts/{email}/plan-changelog — plan change history
- admin://cron-log — recent cron job actions and audit trail
```

**Step 3: Run tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```
git add mcp-servers/scout-quest/src/scout.ts mcp-servers/scout-quest/src/admin.ts
git commit -m "feat: update scout and admin server instructions with quest plan and session notes"
```

---

### Task 8: Guide Entry Point + Guide Resources

**Files:**
- Create: `mcp-servers/scout-quest/src/guide.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideScouts.ts`
- Modify: `mcp-servers/scout-quest/src/resources/index.ts`

**Step 1: Create `guide.ts` entry point**

Follow the same pattern as `scout.ts` and `admin.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGuideResources } from "./resources/index.js";
import { registerGuideTools } from "./tools/guide/index.js";

const GUIDE_INSTRUCTIONS = `SCOUT GUIDE — COACHING & MONITORING TOOLS

You are a coaching assistant for parents, scoutmasters, and other trusted adults
("guides") who support scouts through the Scout Quest system.

SESSION START:
1. Read guide://scouts to see all scouts linked to this guide
2. For each scout, check guide://scout/{email}/setup-status for onboarding progress
3. Check guide://scout/{email}/reminders for pending items
4. If onboarding is incomplete, guide through the next setup step
5. If onboarding is done, offer monitoring and coaching options

RESOURCES (read anytime):
- guide://scouts — list all linked scouts
- guide://scout/{email}/summary — gamified progress overview
- guide://scout/{email}/chores — chore streak and income
- guide://scout/{email}/budget — budget tracking
- guide://scout/{email}/requirements — all requirement states
- guide://scout/{email}/conversations — recent conversation summaries
- guide://scout/{email}/reminders — pending/overdue items
- guide://scout/{email}/setup-status — onboarding checklist
- guide://character — guide's character/persona config

ONBOARDING TOOLS:
- setup_scout_profile — create scout profile (parent-guides only)
- set_scout_interests — seed interests, likes/dislikes, motivations
- set_quest_goal — goal item, target budget, description
- set_chore_list_guide — define chores, frequencies, income
- set_budget_plan — income sources, expense categories, savings target
- set_character_preferences — base character, overlay, tone bounds
- set_session_limits — max time per day, allowed days

MONITORING TOOLS:
- get_conversation_detail — pull full transcript (opt-in)
- flag_conversation — mark a conversation for follow-up
- send_notification_guide — push alert to scout

ADJUSTMENT TOOLS:
- adjust_scout_profile — update age, troop, interests
- adjust_quest_goal — change goal or budget targets
- adjust_character — tweak tone bounds, avoid words, overlay
- adjust_delegation — set which tasks scout handles vs guide
- suggest_intervention — propose ways to help with tradeoffs

COACHING PRINCIPLES:
- Preserve scout agency — suggest options, let the guide decide
- For sensitive topics, recommend the guide talk to the scout directly
- Auto-flag when: inactive 3+ days, budget off-track, streak broken after 7+,
  requirement stuck 2+ weeks, scout asked for parent help
- When a problem is detected, use suggest_intervention to present
  structured options with tradeoffs, not directives`;

const server = new McpServer(
  { name: "scout-guide", version: "1.0.0" },
  {
    capabilities: { logging: {} },
    instructions: GUIDE_INSTRUCTIONS,
  },
);

const guideEmail = process.env.GUIDE_EMAIL || "";

if (!guideEmail) {
  console.error("GUIDE_EMAIL not set — cannot identify guide");
  process.exit(1);
}

registerGuideResources(server, guideEmail);
registerGuideTools(server, guideEmail);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Create `guideScouts.ts` with guide resources**

Create `mcp-servers/scout-quest/src/resources/guideScouts.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUserRoles } from "../auth.js";
import {
  scouts, requirements, choreLogs, budgetEntries,
  reminders, setupStatus, questPlans,
} from "../db.js";
import { STREAK_MILESTONES } from "../constants.js";

async function getLinkedScoutEmails(guideEmail: string): Promise<string[]> {
  const roles = await getUserRoles(guideEmail);
  const guideRole = roles.find(r => r.type === "guide");
  if (!guideRole || guideRole.type !== "guide") return [];
  return guideRole.scout_emails;
}

export function registerGuideScouts(server: McpServer, guideEmail: string): void {
  // List all scouts linked to this guide
  server.registerResource(
    "guide_scouts_list",
    "guide://scouts",
    {
      title: "My Scouts",
      description: "All scouts linked to this guide with summary info.",
      mimeType: "application/json",
    },
    async (uri) => {
      const linkedEmails = await getLinkedScoutEmails(guideEmail);
      if (linkedEmails.length === 0) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ scouts: [], message: "No scouts linked. Use setup_scout_profile to create one." }),
          }],
        };
      }

      const col = await scouts();
      const scoutDocs = await col.find({ email: { $in: linkedEmails } }).toArray();
      const summaries = scoutDocs.map(s => ({
        email: s.email,
        name: s.name,
        age: s.age,
        troop: s.troop,
        quest_status: s.quest_state.quest_status,
        goal_item: s.quest_state.goal_item,
        current_savings: s.quest_state.current_savings,
        target_budget: s.quest_state.target_budget,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify({ scouts: summaries }) }] };
    },
  );

  // Scout summary (gamified progress)
  server.registerResource(
    "guide_scout_summary",
    new ResourceTemplate("guide://scout/{email}/summary", { list: undefined }),
    {
      title: "Scout Summary",
      description: "Gamified quest progress overview for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized for this scout" }) }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: email }).toArray();
      const planCol = await questPlans();
      const plan = await planCol.findOne({ scout_email: email });

      const summary = {
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
          total: reqs.length,
          signed_off: reqs.filter(r => r.status === "signed_off").length,
          in_progress: reqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
          not_started: reqs.filter(r => r.status === "not_started").length,
        },
        milestones: plan?.milestones?.map(m => ({
          label: m.label,
          completed: m.completed,
          category: m.category,
        })) ?? [],
      };

      return { contents: [{ uri: uri.href, text: JSON.stringify(summary) }] };
    },
  );

  // Chore streak and income
  server.registerResource(
    "guide_scout_chores",
    new ResourceTemplate("guide://scout/{email}/chores", { list: undefined }),
    {
      title: "Scout Chores",
      description: "Chore streak and income summary for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const choreCol = await choreLogs();
      const recentLogs = await choreCol.find({ scout_email: email })
        .sort({ date: -1 }).limit(100).toArray();

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);
      for (const log of recentLogs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      const totalIncome = recentLogs.reduce((sum, l) => sum + l.income_earned, 0);

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            current_streak: streak,
            next_milestone: STREAK_MILESTONES.find(m => m > streak) ?? null,
            total_income_earned: totalIncome,
            recent_entries: recentLogs.slice(0, 7).map(l => ({
              date: l.date,
              chores: l.chores_completed,
              income: l.income_earned,
            })),
          }),
        }],
      };
    },
  );

  // Budget tracking
  server.registerResource(
    "guide_scout_budget",
    new ResourceTemplate("guide://scout/{email}/budget", { list: undefined }),
    {
      title: "Scout Budget",
      description: "Budget tracking snapshot for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const budgetCol = await budgetEntries();
      const entries = await budgetCol.find({ scout_email: email })
        .sort({ week_number: -1 }).limit(13).toArray();

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            weeks_tracked: entries.length,
            latest: entries[0] ? {
              week: entries[0].week_number,
              savings: entries[0].running_savings_total,
            } : null,
          }),
        }],
      };
    },
  );

  // Requirements
  server.registerResource(
    "guide_scout_requirements",
    new ResourceTemplate("guide://scout/{email}/requirements", { list: undefined }),
    {
      title: "Scout Requirements",
      description: "All requirement states with progress for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: email }).toArray();
      const clean = reqs.map(({ _id, ...r }) => r);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );

  // Reminders
  server.registerResource(
    "guide_scout_reminders",
    new ResourceTemplate("guide://scout/{email}/reminders", { list: undefined }),
    {
      title: "Scout Reminders",
      description: "Pending/overdue items for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const remCol = await reminders();
      const active = await remCol.find({ scout_email: email, active: true }).toArray();
      const clean = active.map(({ _id, ...r }) => r);
      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );

  // Setup status
  server.registerResource(
    "guide_scout_setup_status",
    new ResourceTemplate("guide://scout/{email}/setup-status", { list: undefined }),
    {
      title: "Setup Status",
      description: "Onboarding checklist progress for a linked scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      const col = await setupStatus();
      const status = await col.findOne({ scout_email: email });
      if (!status) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ status: "not_started", message: "Onboarding not started" }) }] };
      }

      const { _id, ...data } = status;
      return { contents: [{ uri: uri.href, text: JSON.stringify(data) }] };
    },
  );

  // Conversations (summaries from LibreChat — placeholder until cron backfill provides data)
  server.registerResource(
    "guide_scout_conversations",
    new ResourceTemplate("guide://scout/{email}/conversations", { list: undefined }),
    {
      title: "Scout Conversations",
      description: "Recent conversation summaries for a linked scout (from session notes).",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const email = decodeURIComponent(params.email as string);
      const linked = await getLinkedScoutEmails(guideEmail);
      if (!linked.includes(email)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Not authorized" }) }] };
      }

      // Use session_notes as conversation summaries
      const { sessionNotes: sessionNotesAccessor } = await import("../db.js");
      const col = await sessionNotesAccessor();
      const notes = await col.find({ scout_email: email })
        .sort({ session_date: -1 })
        .limit(10)
        .toArray();

      const clean = notes.map(({ _id, ...n }) => ({
        date: n.session_date,
        source: n.source,
        topics: n.topics_discussed,
        progress: n.progress_made,
        pending: n.pending_items,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify(clean) }] };
    },
  );
}
```

**Step 3: Add `registerGuideResources` to resources/index.ts**

Add import:
```typescript
import { registerGuideScouts } from "./guideScouts.js";
```

Add function:
```typescript
export function registerGuideResources(server: McpServer, guideEmail: string): void {
  registerGuideScouts(server, guideEmail);
}
```

**Step 4: Update `package.json` to add guide start script**

Add to `scripts`:
```json
"start:guide": "node dist/guide.js"
```

**Step 5: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`
Expected: Tests pass, TypeScript compiles

**Step 6: Commit**

```
git add mcp-servers/scout-quest/src/guide.ts mcp-servers/scout-quest/src/resources/guideScouts.ts mcp-servers/scout-quest/src/resources/index.ts mcp-servers/scout-quest/package.json
git commit -m "feat: add guide entry point with 9 guide resources"
```

---

### Task 9: Guide Onboarding Tools (7 tools)

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/index.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setupScoutProfile.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setScoutInterests.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setQuestGoal.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setChoreListGuide.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setBudgetPlan.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setCharacterPreferences.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setSessionLimits.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/constants.ts`

This task is large. Implement each tool following the same pattern as the existing tools (e.g., `logChore.ts`, `createScout.ts`). Each tool:
1. Takes Zod-validated input
2. Checks guide authorization via `getUserRoles` + `canAccess`
3. Performs the mutation on MongoDB
4. Updates the setup status step to "complete"
5. Returns a descriptive text response

**Step 1: Create guide tool constants**

Create `mcp-servers/scout-quest/src/tools/guide/constants.ts`:
```typescript
export const SETUP_STEPS = [
  { id: "profile", label: "Scout profile" },
  { id: "interests", label: "Interests & preferences" },
  { id: "quest_goal", label: "Quest goal & budget target" },
  { id: "chore_list", label: "Chore list & income" },
  { id: "budget_plan", label: "Budget plan" },
  { id: "character", label: "Character personality" },
  { id: "session_limits", label: "Session limits" },
  { id: "notifications", label: "Notification setup" },
  { id: "contacts", label: "Counselor & leader contacts" },
  { id: "blue_card", label: "Blue card request" },
];

export function getAgeDefaults(age: number): Record<string, "guide" | "delegated"> {
  if (age < 12) {
    return {
      profile: "guide", interests: "guide", quest_goal: "guide",
      chore_list: "guide", budget_plan: "guide", character: "guide",
      session_limits: "guide", notifications: "guide", contacts: "guide",
      blue_card: "guide",
    };
  }
  if (age <= 14) {
    return {
      profile: "guide", interests: "guide", quest_goal: "guide",
      chore_list: "guide", budget_plan: "delegated", character: "guide",
      session_limits: "guide", notifications: "delegated", contacts: "guide",
      blue_card: "guide",
    };
  }
  return {
    profile: "guide", interests: "delegated", quest_goal: "delegated",
    chore_list: "guide", budget_plan: "delegated", character: "delegated",
    session_limits: "guide", notifications: "delegated", contacts: "delegated",
    blue_card: "delegated",
  };
}
```

**Step 2: Create `setupScoutProfile.ts`**

This is the most complex tool — for parent-guides, it creates the scout record (like `createScout` but also sets up the guide role and setup status):

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { users, scouts, setupStatus } from "../../db.js";
import { SETUP_STEPS, getAgeDefaults } from "./constants.js";

export function registerSetupScoutProfile(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "setup_scout_profile",
    {
      title: "Setup Scout Profile",
      description: "Create a scout profile and link them to this guide. Sets up onboarding checklist with age-appropriate defaults.",
      inputSchema: {
        email: z.string().email().describe("Scout's email address"),
        name: z.string().describe("Scout's full name"),
        age: z.number().int().min(10).max(18).describe("Scout's age (10-18)"),
        troop: z.string().describe("Troop number"),
        patrol: z.string().optional().describe("Patrol name"),
      },
    },
    async ({ email, name, age, troop, patrol }) => {
      const scoutsCol = await scouts();
      const usersCol = await users();

      const existing = await scoutsCol.findOne({ email });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Scout ${email} already exists.` }] };
      }

      const now = new Date();

      // Create scout user
      await usersCol.updateOne(
        { email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true },
      );

      // Create/update guide user with guide role
      await usersCol.updateOne(
        { email: guideEmail },
        {
          $set: { updated_at: now },
          $addToSet: { roles: { type: "guide" as const, scout_emails: [email] } },
          $setOnInsert: { email: guideEmail, created_at: now },
        },
        { upsert: true },
      );

      // Create scout document
      await scoutsCol.insertOne({
        email,
        name,
        age,
        troop,
        patrol,
        guide_email: guideEmail,
        quest_state: {
          goal_item: "", goal_description: "", target_budget: 0,
          savings_capacity: 0, loan_path_active: false,
          quest_start_date: null, current_savings: 0, quest_status: "setup",
        },
        character: {
          base: "guide", quest_overlay: "custom", tone_dial: 3,
          domain_intensity: 3, tone_min: 1, tone_max: 5,
          domain_min: 1, domain_max: 5, sm_notes: "", parent_notes: "",
          avoid: [], calibration_review_enabled: false, calibration_review_weeks: [],
        },
        counselors: {
          personal_management: { name: "", email: "" },
          family_life: { name: "", email: "" },
        },
        unit_leaders: { scoutmaster: { name: "", email: "" } },
        parent_guardian: { name: "", email: guideEmail },
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now,
        updated_at: now,
      });

      // Create setup status with age defaults
      const defaults = getAgeDefaults(age);
      const statusCol = await setupStatus();
      await statusCol.insertOne({
        scout_email: email,
        guide_email: guideEmail,
        steps: SETUP_STEPS.map(s => ({
          ...s,
          status: s.id === "profile" ? "complete" as const : "pending" as const,
          completed_at: s.id === "profile" ? now : undefined,
        })),
        created_at: now,
        updated_at: now,
      });

      return {
        content: [{
          type: "text",
          text: `Scout "${name}" (${email}) created in troop ${troop}. Linked to guide ${guideEmail}. Onboarding started — profile step complete. Age ${age} defaults applied.`,
        }],
      };
    },
  );
}
```

**Step 3: Create remaining 6 onboarding tools**

Each follows a similar pattern — receives validated input, updates the scout document, marks the corresponding setup step as complete. These are simpler than `setupScoutProfile` since the scout already exists.

Create each file in `mcp-servers/scout-quest/src/tools/guide/`:
- `setScoutInterests.ts` — updates `interests` on ScoutDocument, marks step "interests" complete
- `setQuestGoal.ts` — updates `quest_state.goal_item/goal_description/target_budget`, marks step "quest_goal" complete
- `setChoreListGuide.ts` — updates `chore_list`, marks step "chore_list" complete
- `setBudgetPlan.ts` — updates `budget_projected`, marks step "budget_plan" complete. Requires quest_goal and chore_list steps complete (hard dependency).
- `setCharacterPreferences.ts` — updates `character` fields, marks step "character" complete
- `setSessionLimits.ts` — updates `session_limits`, marks step "session_limits" complete

Each tool should:
1. Validate the guide has access to this scout via `getUserRoles`/`canAccess`
2. Verify the scout exists
3. For `setBudgetPlan`: verify quest_goal and chore_list steps are complete
4. Perform the `$set` update on the scouts collection
5. Update the setup_status step to "complete"
6. Return descriptive text

**Step 4: Create `tools/guide/index.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupScoutProfile } from "./setupScoutProfile.js";
import { registerSetScoutInterests } from "./setScoutInterests.js";
import { registerSetQuestGoal } from "./setQuestGoal.js";
import { registerSetChoreListGuide } from "./setChoreListGuide.js";
import { registerSetBudgetPlan } from "./setBudgetPlan.js";
import { registerSetCharacterPreferences } from "./setCharacterPreferences.js";
import { registerSetSessionLimits } from "./setSessionLimits.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  registerSetupScoutProfile(server, guideEmail);
  registerSetScoutInterests(server, guideEmail);
  registerSetQuestGoal(server, guideEmail);
  registerSetChoreListGuide(server, guideEmail);
  registerSetBudgetPlan(server, guideEmail);
  registerSetCharacterPreferences(server, guideEmail);
  registerSetSessionLimits(server, guideEmail);
}
```

Note: monitoring and adjustment tools are added in Tasks 10 and 11.

**Step 5: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`
Expected: Tests pass, TypeScript compiles

**Step 6: Commit**

```
git add mcp-servers/scout-quest/src/tools/guide/
git commit -m "feat: add 7 guide onboarding tools with setup status tracking"
```

---

### Task 10: Guide Monitoring Tools (3 tools)

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/getConversationDetail.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/flagConversation.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/sendNotificationGuide.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

**Step 1: Create `getConversationDetail.ts`**

Reads from LibreChat's MongoDB (read-only) to get full conversation transcript. Uses a separate MongoDB connection to the `librechat` database.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MongoClient } from "mongodb";
import { getUserRoles } from "../../auth.js";

export function registerGetConversationDetail(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "get_conversation_detail",
    {
      title: "Get Conversation Detail",
      description: "Pull full transcript for a specific scout conversation (opt-in). Requires guide authorization.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        conversation_id: z.string().describe("LibreChat conversation ID"),
      },
    },
    async ({ scout_email, conversation_id }) => {
      // Auth check
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const lcUri = process.env.LIBRECHAT_MONGO_URI || process.env.MONGO_URI?.replace("/scoutquest", "/librechat") || "";
      if (!lcUri) {
        return { content: [{ type: "text", text: "Error: LibreChat MongoDB URI not configured." }] };
      }

      const client = new MongoClient(lcUri);
      try {
        await client.connect();
        const lcDb = client.db();

        const messages = await lcDb.collection("messages")
          .find({ conversationId: conversation_id })
          .sort({ createdAt: 1 })
          .toArray();

        if (messages.length === 0) {
          return { content: [{ type: "text", text: "No messages found for this conversation." }] };
        }

        const transcript = messages.map(m => ({
          role: m.sender,
          text: typeof m.text === "string" ? m.text.slice(0, 500) : "",
          timestamp: m.createdAt,
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ conversation_id, message_count: messages.length, transcript }),
          }],
        };
      } finally {
        await client.close();
      }
    },
  );
}
```

**Step 2: Create `flagConversation.ts`**

Creates a reminder on the scout's profile flagging a conversation for follow-up:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { reminders } from "../../db.js";

export function registerFlagConversation(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "flag_conversation",
    {
      title: "Flag Conversation",
      description: "Mark a conversation for follow-up. Creates a reminder visible to both guide and scout.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        reason: z.string().describe("Why this conversation needs follow-up"),
        conversation_date: z.string().date().optional().describe("Date of the conversation (YYYY-MM-DD)"),
      },
    },
    async ({ scout_email, reason, conversation_date }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const col = await reminders();
      const now = new Date();
      await col.insertOne({
        scout_email,
        type: "check_in",
        message: `Flagged by guide: ${reason}${conversation_date ? ` (conversation ${conversation_date})` : ""}`,
        schedule: "once",
        last_triggered: null,
        next_trigger: now,
        active: true,
        created_at: now,
      });

      return {
        content: [{
          type: "text",
          text: `Conversation flagged for ${scout_email}: ${reason}`,
        }],
      };
    },
  );
}
```

**Step 3: Create `sendNotificationGuide.ts`**

Same as scout's `sendNotification` but scoped to guide's linked scouts:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";

export function registerSendNotificationGuide(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "send_notification_guide",
    {
      title: "Send Notification to Scout",
      description: "Push a notification to a linked scout's device via ntfy.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        title: z.string().describe("Notification title"),
        message: z.string().describe("Notification body"),
        priority: z.enum(["low", "default", "high"]).optional().describe("Notification priority"),
      },
    },
    async ({ scout_email, title, message, priority }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const topic = process.env.NTFY_TOPIC;
      if (!topic) {
        return { content: [{ type: "text", text: "Error: NTFY_TOPIC not configured." }] };
      }

      const response = await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          "Title": title,
          ...(priority ? { "Priority": priority } : {}),
        },
        body: message,
      });

      if (!response.ok) {
        return { content: [{ type: "text", text: `Error: ntfy returned ${response.status}` }] };
      }

      return { content: [{ type: "text", text: `Notification sent to ${scout_email}: "${title}"` }] };
    },
  );
}
```

**Step 4: Register in guide/index.ts**

Add imports and registrations for all three tools.

**Step 5: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`

**Step 6: Commit**

```
git add mcp-servers/scout-quest/src/tools/guide/getConversationDetail.ts mcp-servers/scout-quest/src/tools/guide/flagConversation.ts mcp-servers/scout-quest/src/tools/guide/sendNotificationGuide.ts mcp-servers/scout-quest/src/tools/guide/index.ts
git commit -m "feat: add guide monitoring tools — conversation detail, flagging, notifications"
```

---

### Task 11: Guide Adjustment Tools (5 tools)

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustScoutProfile.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustQuestGoal.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustCharacter.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustDelegation.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/suggestIntervention.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

Each tool follows the same pattern: validate guide authorization, perform the adjustment, return descriptive text.

**Step 1: Create the 5 adjustment tools**

- `adjustScoutProfile.ts` — updates age, troop, patrol, interests on ScoutDocument
- `adjustQuestGoal.ts` — updates quest_state.goal_item, goal_description, target_budget
- `adjustCharacter.ts` — updates character tone bounds, avoid list, overlay
- `adjustDelegation.ts` — updates setup_status step statuses (guide/delegated_to_scout)
- `suggestIntervention.ts` — reads scout state, returns structured intervention options (see design doc Section "Intervention Coaching"). This is a read+compute tool, not a mutation.

`suggestIntervention` is unique — it reads the scout's current state (chore streak, budget, requirements, reminders) and returns a structured response with intervention options. It does NOT modify data.

**Step 2: Register all 5 tools in guide/index.ts**

**Step 3: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`

**Step 4: Commit**

```
git add mcp-servers/scout-quest/src/tools/guide/adjustScoutProfile.ts mcp-servers/scout-quest/src/tools/guide/adjustQuestGoal.ts mcp-servers/scout-quest/src/tools/guide/adjustCharacter.ts mcp-servers/scout-quest/src/tools/guide/adjustDelegation.ts mcp-servers/scout-quest/src/tools/guide/suggestIntervention.ts mcp-servers/scout-quest/src/tools/guide/index.ts
git commit -m "feat: add 5 guide adjustment tools — profile, goal, character, delegation, intervention"
```

---

### Task 12: Cron Sidecar — Mechanical Checks + Pipeline

**Files:**
- Create: `mcp-servers/scout-quest/src/cron.ts`
- Create: `mcp-servers/scout-quest/src/cron/pipeline.ts`
- Create: `mcp-servers/scout-quest/src/cron/mechanicalChecks.ts`
- Create: `mcp-servers/scout-quest/src/cron/notifications.ts`

**Step 1: Add `node-cron` dependency**

Run: `cd mcp-servers/scout-quest && npm install node-cron && npm install -D @types/node-cron`

**Step 2: Create `cron/mechanicalChecks.ts`**

Implements Step 1 of the daily pipeline — no LLM calls, pure data checks:

```typescript
import { scouts, choreLogs, budgetEntries, requirements, sessionNotes, questPlans } from "../db.js";

export interface QueuedNotification {
  scout_email: string;
  type: "chore_reminder" | "diary_reminder" | "inactivity_check_in" | "inactivity_parent_alert" | "budget_behind";
  message: string;
  priority: "low" | "default" | "high";
  target: "scout" | "parent";
}

export interface MechanicalResult {
  scout_email: string;
  notifications: QueuedNotification[];
  drift_detected: boolean;
  drift_details: string[];
}

export async function runMechanicalChecks(
  thresholds: { inactivity_reminder_days: number; inactivity_parent_alert_days: number },
): Promise<MechanicalResult[]> {
  const scoutsCol = await scouts();
  const activeScouts = await scoutsCol.find({ "quest_state.quest_status": "active" }).toArray();
  const results: MechanicalResult[] = [];

  for (const scout of activeScouts) {
    const notifications: QueuedNotification[] = [];
    const driftDetails: string[] = [];

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Chore streak risk — no log today after 6pm
    if (now.getHours() >= 18) {
      const choreCol = await choreLogs();
      const todaysLog = await choreCol.findOne({
        scout_email: scout.email,
        date: { $gte: today },
      });
      if (!todaysLog) {
        notifications.push({
          scout_email: scout.email,
          type: "chore_reminder",
          message: "Don't forget your chores today — keep that streak going!",
          priority: "default",
          target: "scout",
        });
      }
    }

    // Session inactivity
    const notesCol = await sessionNotes();
    const lastNote = await notesCol.findOne(
      { scout_email: scout.email },
      { sort: { session_date: -1 } },
    );
    if (lastNote) {
      const daysSinceSession = Math.floor(
        (now.getTime() - new Date(lastNote.session_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceSession >= thresholds.inactivity_parent_alert_days) {
        notifications.push({
          scout_email: scout.email,
          type: "inactivity_parent_alert",
          message: `${scout.name} hasn't had a Scout Quest session in ${daysSinceSession} days.`,
          priority: "high",
          target: "parent",
        });
      } else if (daysSinceSession >= thresholds.inactivity_reminder_days) {
        notifications.push({
          scout_email: scout.email,
          type: "inactivity_check_in",
          message: `Hey! It's been ${daysSinceSession} days since your last Scout Quest session. Ready to jump back in?`,
          priority: "default",
          target: "scout",
        });
      }
    }

    // Budget tracking pace
    if (scout.quest_state.quest_start_date) {
      const budgetCol = await budgetEntries();
      const latestBudget = await budgetCol.findOne(
        { scout_email: scout.email },
        { sort: { week_number: -1 } },
      );
      const weeksTracked = latestBudget?.week_number ?? 0;
      const weeksSinceStart = Math.floor(
        (now.getTime() - new Date(scout.quest_state.quest_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000),
      );
      if (weeksSinceStart > weeksTracked + 1) {
        notifications.push({
          scout_email: scout.email,
          type: "budget_behind",
          message: `You're ${weeksSinceStart - weeksTracked} week(s) behind on budget tracking.`,
          priority: "default",
          target: "scout",
        });
      }
    }

    // Milestone drift check
    const planCol = await questPlans();
    const plan = await planCol.findOne({ scout_email: scout.email });
    if (plan?.milestones) {
      for (const milestone of plan.milestones) {
        if (!milestone.completed && milestone.target_date) {
          const targetDate = new Date(milestone.target_date);
          if (now > targetDate) {
            driftDetails.push(`Milestone "${milestone.label}" past target date ${targetDate.toISOString().split("T")[0]}`);
          }
        }
      }
    }

    results.push({
      scout_email: scout.email,
      notifications,
      drift_detected: driftDetails.length > 0,
      drift_details: driftDetails,
    });
  }

  return results;
}
```

**Step 3: Create `cron/notifications.ts`**

```typescript
import { cronLog } from "../db.js";
import type { QueuedNotification } from "./mechanicalChecks.js";

export async function sendNotifications(
  notifications: QueuedNotification[],
  ntfyTopic: string,
  parentTopic?: string,
): Promise<void> {
  const logCol = await cronLog();
  const now = new Date();

  for (const notif of notifications) {
    const topic = notif.target === "parent" && parentTopic ? parentTopic : ntfyTopic;

    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: { "Title": `Scout Quest: ${notif.type.replace(/_/g, " ")}`, "Priority": notif.priority },
        body: notif.message,
      });

      await logCol.insertOne({
        run_date: now,
        scout_email: notif.scout_email,
        action: "notification_sent",
        details: `${notif.type} → ${notif.target}: ${notif.message}`,
        created_at: now,
      });
    } catch (err) {
      console.error(`Failed to send notification for ${notif.scout_email}:`, err);
    }
  }
}
```

**Step 4: Create `cron/pipeline.ts`**

```typescript
import { runMechanicalChecks } from "./mechanicalChecks.js";
import { sendNotifications } from "./notifications.js";
import { cronLog } from "../db.js";

interface PipelineConfig {
  thresholds: {
    inactivity_reminder_days: number;
    inactivity_parent_alert_days: number;
    plan_review_staleness_days: number;
  };
  ntfy_topic: string;
  parent_topic?: string;
}

export async function runDailyPipeline(config: PipelineConfig): Promise<void> {
  const logCol = await cronLog();
  const now = new Date();

  console.log(`[cron] Starting daily pipeline at ${now.toISOString()}`);

  // Step 1: Mechanical checks
  const results = await runMechanicalChecks(config.thresholds);

  // Log drift detections
  for (const result of results) {
    if (result.drift_detected) {
      await logCol.insertOne({
        run_date: now,
        scout_email: result.scout_email,
        action: "drift_detected",
        details: result.drift_details.join("; "),
        created_at: now,
      });
    }
  }

  // Step 2: Session notes backfill (Task 13)
  // Step 3: Plan review (Task 13)

  // Step 4: Send accumulated notifications
  const allNotifications = results.flatMap(r => r.notifications);
  if (allNotifications.length > 0) {
    await sendNotifications(allNotifications, config.ntfy_topic, config.parent_topic);
  }

  console.log(`[cron] Pipeline complete. ${results.length} scouts checked, ${allNotifications.length} notifications sent.`);
}
```

**Step 5: Create `cron.ts` entry point**

```typescript
import cron from "node-cron";
import { runDailyPipeline } from "./cron/pipeline.js";

const schedule = process.env.CRON_SCHEDULE || "0 20 * * *";
const ntfyTopic = process.env.NTFY_TOPIC || "";
const parentTopic = process.env.NTFY_PARENT_TOPIC;

if (!ntfyTopic) {
  console.error("NTFY_TOPIC not set");
  process.exit(1);
}

// Ensure MongoDB connection is initialized
await import("./db.js");

console.log(`[cron] Scheduled daily review at: ${schedule}`);

cron.schedule(schedule, async () => {
  try {
    await runDailyPipeline({
      thresholds: {
        inactivity_reminder_days: parseInt(process.env.INACTIVITY_REMINDER_DAYS || "3", 10),
        inactivity_parent_alert_days: parseInt(process.env.INACTIVITY_PARENT_ALERT_DAYS || "7", 10),
        plan_review_staleness_days: parseInt(process.env.PLAN_REVIEW_STALENESS_DAYS || "7", 10),
      },
      ntfy_topic: ntfyTopic,
      parent_topic: parentTopic,
    });
  } catch (err) {
    console.error("[cron] Pipeline failed:", err);
  }
});
```

**Step 6: Update package.json**

Add to `scripts`:
```json
"start:cron": "node dist/cron.js"
```

Add to `dependencies`:
```json
"node-cron": "^3.0.0"
```

**Step 7: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`

**Step 8: Commit**

```
git add mcp-servers/scout-quest/src/cron.ts mcp-servers/scout-quest/src/cron/ mcp-servers/scout-quest/package.json mcp-servers/scout-quest/package-lock.json
git commit -m "feat: add cron sidecar with mechanical checks and notification pipeline"
```

---

### Task 13: Cron Sidecar — Session Backfill + Plan Review

**Files:**
- Create: `mcp-servers/scout-quest/src/cron/sessionBackfill.ts`
- Create: `mcp-servers/scout-quest/src/cron/planReview.ts`
- Modify: `mcp-servers/scout-quest/src/cron/pipeline.ts`

**Step 1: Create `sessionBackfill.ts`**

Reads LibreChat conversations for scouts that had sessions today but no agent-logged session notes. Uses Anthropic API (Haiku) to extract summaries:

```typescript
import { MongoClient } from "mongodb";
import { sessionNotes, cronLog, scouts } from "../db.js";

export async function backfillSessionNotes(
  backfillModel: string,
): Promise<void> {
  const lcUri = process.env.LIBRECHAT_MONGO_URI || "";
  if (!lcUri) {
    console.log("[cron] LIBRECHAT_MONGO_URI not set — skipping session backfill");
    return;
  }

  const scoutsCol = await scouts();
  const activeScouts = await scoutsCol.find({ "quest_state.quest_status": "active" }).toArray();
  const notesCol = await sessionNotes();
  const logCol = await cronLog();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const client = new MongoClient(lcUri);
  try {
    await client.connect();
    const lcDb = client.db();

    for (const scout of activeScouts) {
      // Check if agent already logged notes today
      const existingNote = await notesCol.findOne({
        scout_email: scout.email,
        session_date: { $gte: todayStart },
        source: "agent",
      });
      if (existingNote) continue;

      // Check for conversations today in LibreChat
      // LibreChat stores user email in the conversation document
      const conversations = await lcDb.collection("conversations")
        .find({ user: scout.email, updatedAt: { $gte: todayStart } })
        .toArray();

      if (conversations.length === 0) continue;

      // Get messages for the most recent conversation
      const latestConvo = conversations[conversations.length - 1];
      const messages = await lcDb.collection("messages")
        .find({ conversationId: latestConvo.conversationId })
        .sort({ createdAt: 1 })
        .limit(50)
        .toArray();

      if (messages.length < 2) continue;

      // Use Anthropic API to extract session summary
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.log("[cron] ANTHROPIC_API_KEY not set — skipping LLM backfill");
        return;
      }

      const transcript = messages.map(m =>
        `${m.sender === "User" ? "Scout" : "Coach"}: ${typeof m.text === "string" ? m.text.slice(0, 300) : ""}`
      ).join("\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: backfillModel,
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `Extract a brief session summary from this Scout Quest conversation. Return JSON with: topics_discussed (string[]), progress_made (string), pending_items (string[]), next_session_focus (string or null). Be concise.\n\n${transcript}`,
          }],
        }),
      });

      if (!response.ok) {
        console.error(`[cron] Anthropic API error: ${response.status}`);
        continue;
      }

      const result = await response.json() as { content: { text: string }[] };
      const text = result.content?.[0]?.text || "";

      try {
        const parsed = JSON.parse(text);
        await notesCol.insertOne({
          scout_email: scout.email,
          session_date: now,
          source: "cron",
          topics_discussed: parsed.topics_discussed || ["Session content"],
          progress_made: parsed.progress_made || "See conversation",
          pending_items: parsed.pending_items || [],
          next_session_focus: parsed.next_session_focus || undefined,
          created_at: now,
        });

        await logCol.insertOne({
          run_date: now,
          scout_email: scout.email,
          action: "session_notes_backfill",
          details: `Backfilled session notes from ${messages.length} messages`,
          model_used: backfillModel,
          created_at: now,
        });
      } catch {
        console.error(`[cron] Failed to parse LLM response for ${scout.email}`);
      }
    }
  } finally {
    await client.close();
  }
}
```

**Step 2: Create `planReview.ts`**

Triggered review when drift is detected or plan is stale:

```typescript
import { questPlans, planChangelog, cronLog, requirements, choreLogs, budgetEntries } from "../db.js";

export async function reviewPlan(
  scoutEmail: string,
  driftDetails: string[],
  reviewModel: string,
): Promise<void> {
  const planCol = await questPlans();
  const plan = await planCol.findOne({ scout_email: scoutEmail });
  if (!plan) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[cron] ANTHROPIC_API_KEY not set — skipping plan review");
    return;
  }

  // Gather context
  const reqCol = await requirements();
  const reqs = await reqCol.find({ scout_email: scoutEmail }).toArray();
  const choreCol = await choreLogs();
  const recentChores = await choreCol.find({ scout_email: scoutEmail })
    .sort({ date: -1 }).limit(14).toArray();
  const budgetCol = await budgetEntries();
  const latestBudget = await budgetCol.findOne(
    { scout_email: scoutEmail },
    { sort: { week_number: -1 } },
  );

  const context = JSON.stringify({
    current_plan: {
      priorities: plan.current_priorities,
      strategy: plan.strategy_notes,
      milestones: plan.milestones,
    },
    drift: driftDetails,
    requirements_summary: {
      total: reqs.length,
      signed_off: reqs.filter(r => r.status === "signed_off").length,
      in_progress: reqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
      blocked: reqs.filter(r => r.status === "blocked").length,
    },
    chore_streak: recentChores.length,
    budget_week: latestBudget?.week_number ?? 0,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: reviewModel,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Review this scout's quest plan and suggest updates. Drift detected: ${driftDetails.join("; ")}. Return JSON with: updated_priorities (string[]), updated_strategy (string), reasoning (string). Only suggest changes if drift warrants them.\n\n${context}`,
      }],
    }),
  });

  if (!response.ok) {
    console.error(`[cron] Plan review API error: ${response.status}`);
    return;
  }

  const result = await response.json() as { content: { text: string }[] };
  const text = result.content?.[0]?.text || "";

  const logCol = await cronLog();
  const changelogCol = await planChangelog();
  const now = new Date();

  try {
    const parsed = JSON.parse(text);

    if (parsed.updated_priorities) {
      await changelogCol.insertOne({
        scout_email: scoutEmail,
        change_date: now,
        source: "cron",
        field_changed: "current_priorities",
        old_value: JSON.stringify(plan.current_priorities),
        new_value: JSON.stringify(parsed.updated_priorities),
        reason: parsed.reasoning || "Cron drift review",
        created_at: now,
      });
      await planCol.updateOne(
        { scout_email: scoutEmail },
        { $set: { current_priorities: parsed.updated_priorities, last_reviewed: now, updated_at: now } },
      );
    }

    if (parsed.updated_strategy) {
      await changelogCol.insertOne({
        scout_email: scoutEmail,
        change_date: now,
        source: "cron",
        field_changed: "strategy_notes",
        old_value: plan.strategy_notes,
        new_value: parsed.updated_strategy,
        reason: parsed.reasoning || "Cron drift review",
        created_at: now,
      });
      await planCol.updateOne(
        { scout_email: scoutEmail },
        { $set: { strategy_notes: parsed.updated_strategy, last_reviewed: now, updated_at: now } },
      );
    }

    await logCol.insertOne({
      run_date: now,
      scout_email: scoutEmail,
      action: "plan_review",
      details: parsed.reasoning || "Plan reviewed",
      model_used: reviewModel,
      changes_made: JSON.stringify({ priorities: !!parsed.updated_priorities, strategy: !!parsed.updated_strategy }),
      created_at: now,
    });
  } catch {
    console.error(`[cron] Failed to parse plan review response for ${scoutEmail}`);
  }
}
```

**Step 3: Integrate into pipeline.ts**

Add calls to `backfillSessionNotes` and `reviewPlan` in the pipeline between Steps 1 and 4.

**Step 4: Run tests + build**

Run: `cd mcp-servers/scout-quest && npx vitest run && npx tsc`

**Step 5: Commit**

```
git add mcp-servers/scout-quest/src/cron/sessionBackfill.ts mcp-servers/scout-quest/src/cron/planReview.ts mcp-servers/scout-quest/src/cron/pipeline.ts
git commit -m "feat: add cron session backfill (Haiku) and plan review (Sonnet) steps"
```

---

### Task 14: Cron Sidecar — Docker + Deployment Config

**Files:**
- Modify: `config/scout-quest/docker-compose.override.yml`

**Step 1: Add cron service to docker-compose.override.yml**

Add to the `services` section:
```yaml
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
      INACTIVITY_REMINDER_DAYS: "3"
      INACTIVITY_PARENT_ALERT_DAYS: "7"
      PLAN_REVIEW_STALENESS_DAYS: "7"
    working_dir: /app
    command: ["node", "/app/dist/cron.js"]
    restart: unless-stopped
    depends_on:
      - mongodb
```

**Step 2: Commit**

```
git add config/scout-quest/docker-compose.override.yml
git commit -m "feat: add cron sidecar to scout-quest Docker Compose stack"
```

---

### Task 15: Admin App — New Collection Models

**Files:**
- Create: `admin/src/models/scout-quest/quest-plan.ts`
- Create: `admin/src/models/scout-quest/session-note.ts`
- Create: `admin/src/models/scout-quest/cron-log.ts`
- Create: `admin/src/models/scout-quest/plan-changelog.ts`
- Create: `admin/src/models/scout-quest/setup-status.ts`
- Modify: `admin/src/models/scout-quest/index.ts`
- Modify: `admin/src/resources/scout-quest.ts`
- Modify: `admin/src/index.ts` (locale labels)

**Step 1: Create Mongoose models for 5 new collections**

Follow the pattern from existing models (e.g., `audit-log.ts`).

`quest-plan.ts`:
```typescript
import mongoose, { Schema } from "mongoose";

const questPlanSchema = new Schema({
  scout_email: { type: String, required: true, unique: true, index: true },
  current_priorities: [String],
  strategy_notes: String,
  milestones: [{
    id: String,
    label: String,
    category: { type: String, enum: ["savings", "streak", "requirement", "counselor", "custom"] },
    target_metric: String,
    target_date: Date,
    completed: Boolean,
    completed_date: Date,
    celebrated: Boolean,
  }],
  next_counselor_session: {
    badge: { type: String, enum: ["personal_management", "family_life"] },
    requirements_to_present: [String],
    prep_notes: String,
  },
  scout_observations: {
    engagement_patterns: String,
    attention_notes: String,
    motivation_triggers: String,
    tone_notes: String,
  },
  last_reviewed: Date,
}, { timestamps: { createdAt: false, updatedAt: "updated_at" } });

export const QuestPlan = mongoose.model("QuestPlan", questPlanSchema, "quest_plans");
```

`session-note.ts`:
```typescript
import mongoose, { Schema } from "mongoose";

const sessionNoteSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  session_date: { type: Date, required: true, index: true },
  source: { type: String, enum: ["agent", "cron"], required: true },
  topics_discussed: [String],
  progress_made: String,
  pending_items: [String],
  next_session_focus: String,
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const SessionNote = mongoose.model("SessionNote", sessionNoteSchema, "session_notes");
```

`cron-log.ts`:
```typescript
import mongoose, { Schema } from "mongoose";

const cronLogSchema = new Schema({
  run_date: { type: Date, required: true, index: true },
  scout_email: { type: String, required: true, index: true },
  action: {
    type: String, required: true,
    enum: ["drift_detected", "session_notes_backfill", "notification_sent", "plan_review", "inactivity_alert", "milestone_check"],
  },
  details: String,
  model_used: String,
  changes_made: String,
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const CronLog = mongoose.model("CronLog", cronLogSchema, "cron_log");
```

`plan-changelog.ts`:
```typescript
import mongoose, { Schema } from "mongoose";

const planChangelogSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  change_date: { type: Date, required: true, index: true },
  source: { type: String, enum: ["agent", "cron", "admin"], required: true },
  field_changed: { type: String, required: true },
  old_value: String,
  new_value: { type: String, required: true },
  reason: { type: String, required: true },
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const PlanChangelog = mongoose.model("PlanChangelog", planChangelogSchema, "plan_changelog");
```

`setup-status.ts`:
```typescript
import mongoose, { Schema } from "mongoose";

const setupStatusSchema = new Schema({
  scout_email: { type: String, required: true, unique: true, index: true },
  guide_email: { type: String, required: true, index: true },
  steps: [{
    id: String,
    label: String,
    status: { type: String, enum: ["pending", "complete", "skipped", "delegated_to_scout"] },
    completed_at: Date,
    delegated_at: Date,
  }],
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

export const SetupStatus = mongoose.model("SetupStatus", setupStatusSchema, "setup_status");
```

**Step 2: Export from index.ts**

Add to `admin/src/models/scout-quest/index.ts`:
```typescript
export { QuestPlan } from "./quest-plan.js";
export { SessionNote } from "./session-note.js";
export { CronLog } from "./cron-log.js";
export { PlanChangelog } from "./plan-changelog.js";
export { SetupStatus } from "./setup-status.js";
```

**Step 3: Add AdminJS resource configs to scout-quest.ts**

Add imports and resource entries following the existing patterns in `admin/src/resources/scout-quest.ts`.

**Step 4: Update locale labels in admin/src/index.ts**

Add labels for the 5 new collections.

**Step 5: Build**

Run: `cd admin && npx tsc`

**Step 6: Commit**

```
git add admin/src/models/scout-quest/ admin/src/resources/scout-quest.ts admin/src/index.ts
git commit -m "feat: add admin app models for quest plans, session notes, cron log, plan changelog, setup status"
```

---

### Task 16: LibreChat Config — Disable Memory, Update Presets, Add Guide MCP

**Files:**
- Modify: `config/scout-quest/librechat.yaml`

**Step 1: Disable memory**

Replace lines 14-41 (the memory block) with:
```yaml
memory:
  disabled: true
```

**Step 2: Update promptPrefix in all three Scout Coach presets**

Replace the promptPrefix in "Scout Coach (Claude)", "Scout Coach (Gemini)", and "Scout Coach (GPT)" presets with the goal-agnostic version from the memory redesign design doc Section 8.2.

**Step 3: Add scout-guide MCP server**

After the existing `scout-quest` MCP server block, add:
```yaml
  scout-guide:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/guide.js"
    env:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      NTFY_TOPIC: "${NTFY_TOPIC}"
      GUIDE_EMAIL: "{{user.email}}"
    timeout: 30000
    serverInstructions: true
```

**Step 4: Add "Scout Guide" model spec**

Add a new model spec entry after the existing Scout Coach presets:
```yaml
    - name: "Scout Guide"
      label: "Scout Guide"
      description: "For parents and leaders — set up scouts, monitor progress, get coaching suggestions"
      preset:
        endpoint: "anthropic"
        model: "claude-sonnet-4-6"
        maxOutputTokens: 4096
        mcpServers:
          - "scout-guide"
        promptPrefix: |
          You are Scout Guide, a coaching assistant for parents and leaders
          supporting scouts through the Scout Quest system.
          Read your resources at session start to see linked scouts and their progress.
          Guide through onboarding for new scouts, or offer monitoring and coaching
          for scouts already set up.
          Preserve scout agency — suggest options, let the guide decide.
```

**Step 5: Commit**

```
git add config/scout-quest/librechat.yaml
git commit -m "feat: disable memory, update presets to goal-agnostic, add guide MCP server and model spec"
```

---

### Task 17: Doc Cleanup

**Files:**
- Delete: `docs/mcp-server-design.md`
- Modify: `docs/scout-quest-requirements.md` (Section 10.5 + Section 11)
- Modify: `docs/plans/2026-02-21-mcp-server-redesign.md` (merge memory redesign additions)
- Modify: `docs/architecture.md` (add cron sidecar, guide endpoint)
- Delete: `docs/plans/2026-02-21-guide-endpoint-implementation.md` (superseded)
- Delete: `docs/plans/2026-02-21-mcp-server-implementation.md` (superseded)

**Step 1: Delete superseded docs**

```
git rm docs/mcp-server-design.md
git rm docs/plans/2026-02-21-guide-endpoint-implementation.md
git rm docs/plans/2026-02-21-mcp-server-implementation.md
```

**Step 2: Fix requirements doc Section 10.5 casing**

In `docs/scout-quest-requirements.md`, change uppercase status names to lowercase to match code: `SUBMITTED_TO_COUNSELOR` → `submitted`, etc.

**Step 3: Replace requirements doc Section 11**

Replace the outdated YAML data model (lines 979-1177) with a pointer:
```markdown
## 11. MCP Server Data Model

See `docs/plans/2026-02-21-mcp-server-redesign.md` Section 4 for the authoritative
data model, including all collections, schemas, and the requirement state machine.
```

**Step 4: Update redesign spec**

In `docs/plans/2026-02-21-mcp-server-redesign.md`:
- Add 5 new collections to Section 4 (quest_plans, session_notes, cron_log, plan_changelog, setup_status)
- Add new scout resources to Section 5
- Add new scout and guide tools to Section 6
- Add guide.ts to file structure in Section 9
- Add cron sidecar to Section 10
- Update server instructions in Section 11
- Update "Changes from Original Design" in Section 13

**Step 5: Update architecture doc**

Add guide endpoint and cron sidecar to the architecture diagram. Remove references to LibreChat memory.

**Step 6: Update status headers on all design docs**

Each design doc should have a clear status in its header:
- `memory-redesign.md`: `Status: Implemented (see combined-implementation.md)`
- `guide-endpoint-design.md`: `Status: Implemented (see combined-implementation.md)`
- `mcp-server-redesign.md`: `Status: Implemented — authoritative spec`
- `admin-app-design.md`: `Status: Implemented`
- `combined-implementation.md`: `Status: Implementation plan — source of truth`

**Step 7: Commit**

```
git add docs/
git commit -m "docs: clean up superseded designs, update specs, add status headers"
```
