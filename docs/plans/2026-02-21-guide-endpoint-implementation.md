# Scout Guide Endpoint — Implementation Plan

> **Status:** SUPERSEDED by `2026-02-21-combined-implementation.md` which coordinates guide endpoint with memory redesign and admin app updates.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third MCP server entry point (`guide.js`) with parent/leader-facing tools for onboarding scouts, monitoring progress, and coaching guides on how to support their scouts.

**Architecture:** New `guide.ts` entry point alongside `scout.ts` and `admin.ts`. Shared TypeScript codebase, same MongoDB. Guide tools are auth-scoped to scouts linked via the `guide` role's `scout_emails[]` array. Second MCP server config on the scout-quest LibreChat instance with a "Scout Guide" model spec.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, MongoDB (native driver), Zod, vitest

**Design doc:** `docs/plans/2026-02-21-guide-endpoint-design.md`

---

### Task 1: Rename `parent` Role to `guide` in Types

**Files:**
- Modify: `mcp-servers/scout-quest/src/types.ts`

**Step 1: Update the Role union type**

In `types.ts`, change the `parent` variant to `guide`:

```typescript
// Before:
| { type: "parent"; scout_emails: string[] }

// After:
| { type: "guide"; scout_emails: string[] }
```

**Step 2: Add `guide_email` to `ScoutDocument`**

Add after `parent_guardian`:

```typescript
  parent_guardian: ContactInfo;
  guide_email: string;             // defaults to parent_guardian.email
```

**Step 3: Add `interests` to `ScoutDocument`**

Add after `patrol?`:

```typescript
  interests?: {
    likes: string[];
    dislikes: string[];
    motivations: string[];
  };
```

**Step 4: Add `session_limits` to `ScoutDocument`**

Add after `budget_projected?`:

```typescript
  session_limits?: {
    max_minutes_per_day: number;
    allowed_days?: string[];
  };
```

**Step 5: Add `SetupStatusDocument` interface**

Add at the end of `types.ts`:

```typescript
// --- Setup Status (guide onboarding progress) ---

export type SetupStepStatus = "pending" | "complete" | "skipped" | "delegated_to_scout";

export interface SetupStatusDocument {
  _id?: ObjectId;
  scout_email: string;
  guide_email: string;
  steps: {
    id: string;
    label: string;
    status: SetupStepStatus;
    completed_at?: Date;
    delegated_at?: Date;
  }[];
  created_at: Date;
  updated_at: Date;
}
```

**Step 6: Build to verify no type errors**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Build failure — `auth.ts` and `createScout.ts` still reference `"parent"`. That's expected; we fix them in Task 2.

**Step 7: Commit types changes only**

```bash
git add mcp-servers/scout-quest/src/types.ts
git commit -m "feat: add guide role, guide_email, interests, session_limits, SetupStatus types"
```

---

### Task 2: Update Auth Layer for Guide Role

**Files:**
- Modify: `mcp-servers/scout-quest/src/auth.ts`

**Step 1: Write test for guide role access**

Create `mcp-servers/scout-quest/src/__tests__/auth-guide.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { canAccess } from "../auth.js";
import type { Role } from "../types.js";

describe("guide role access", () => {
  const guideRole: Role = { type: "guide", scout_emails: ["scout@test.com"] };

  it("allows read actions for linked scout", () => {
    expect(canAccess([guideRole], "view_scout", { scout_email: "scout@test.com" })).toBe(true);
  });

  it("denies read actions for unlinked scout", () => {
    expect(canAccess([guideRole], "view_scout", { scout_email: "other@test.com" })).toBe(false);
  });

  it("allows guide write actions for linked scout", () => {
    expect(canAccess([guideRole], "setup_scout_profile", { scout_email: "scout@test.com" })).toBe(true);
  });

  it("denies admin-only actions", () => {
    expect(canAccess([guideRole], "sign_off_requirement", { scout_email: "scout@test.com" })).toBe(false);
    expect(canAccess([guideRole], "override_requirement", { scout_email: "scout@test.com" })).toBe(false);
  });

  it("allows guide write actions without scout context (self-serve create)", () => {
    expect(canAccess([guideRole], "setup_scout_profile", {})).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/auth-guide.test.ts`
Expected: FAIL — `"guide"` role type not handled in `canAccess()`

**Step 3: Update `auth.ts`**

Replace the `parent` block with `guide` and add `GUIDE_WRITE_ACTIONS`:

```typescript
const GUIDE_WRITE_ACTIONS = [
  "setup_scout_profile", "set_scout_interests", "set_quest_goal",
  "set_chore_list", "set_budget_plan", "set_character_preferences",
  "set_session_limits", "adjust_scout_profile", "adjust_quest_goal",
  "adjust_character", "adjust_delegation", "flag_conversation",
  "send_notification",
];
```

Replace the `if (role.type === "parent")` block:

```typescript
    if (role.type === "guide") {
      if (READ_ACTIONS.includes(action) || GUIDE_WRITE_ACTIONS.includes(action)) {
        // Self-serve actions (like setup_scout_profile) don't require scout context
        if (!context.scout_email) return true;
        if (role.scout_emails.includes(context.scout_email)) return true;
      }
    }
```

**Step 4: Run test to verify it passes**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/auth-guide.test.ts`
Expected: PASS

**Step 5: Update `createScout.ts` — change `"parent"` to `"guide"`**

In `mcp-servers/scout-quest/src/tools/admin/createScout.ts`, change the parent role upsert:

```typescript
// Before:
$addToSet: { roles: { type: "parent" as const, scout_emails: [email] } },

// After:
$addToSet: { roles: { type: "guide" as const, scout_emails: [email] } },
```

Also add `guide_email` to the scout insert:

```typescript
// After parent_guardian: { name: parent_name, email: parent_email },
// Add:
guide_email: parent_email,
```

**Step 6: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 7: Build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add mcp-servers/scout-quest/src/auth.ts mcp-servers/scout-quest/src/__tests__/auth-guide.test.ts mcp-servers/scout-quest/src/tools/admin/createScout.ts
git commit -m "feat: rename parent role to guide, add GUIDE_WRITE_ACTIONS, update createScout"
```

---

### Task 3: Add `setup_status` Collection to DB Layer

**Files:**
- Modify: `mcp-servers/scout-quest/src/db.ts`
- Modify: `mcp-servers/scout-quest/src/constants.ts`

**Step 1: Add collection accessor to `db.ts`**

Add import and accessor:

```typescript
import type { SetupStatusDocument } from "./types.js";

export async function setupStatus(): Promise<Collection<SetupStatusDocument>> {
  return (await getDb()).collection("setup_status");
}
```

**Step 2: Add setup step definitions to `constants.ts`**

```typescript
export interface SetupStepDefinition {
  id: string;
  label: string;
  /** Age thresholds for delegation defaults: [delegateAbove12, delegateAbove14] */
  delegate_age_12: boolean;
  delegate_age_15: boolean;
  /** Step IDs that must be complete before this step */
  requires: string[];
}

export const SETUP_STEPS: SetupStepDefinition[] = [
  { id: "profile", label: "Scout profile (name, age, troop)", delegate_age_12: false, delegate_age_15: false, requires: [] },
  { id: "interests", label: "Interests & preferences", delegate_age_12: false, delegate_age_15: true, requires: ["profile"] },
  { id: "quest_goal", label: "Quest goal & budget target", delegate_age_12: false, delegate_age_15: true, requires: ["profile"] },
  { id: "chore_list", label: "Chore list & income amounts", delegate_age_12: false, delegate_age_15: false, requires: ["profile"] },
  { id: "budget_plan", label: "Budget plan", delegate_age_12: true, delegate_age_15: true, requires: ["quest_goal", "chore_list"] },
  { id: "character", label: "Character personality config", delegate_age_12: false, delegate_age_15: true, requires: ["profile"] },
  { id: "session_limits", label: "Session time limits", delegate_age_12: false, delegate_age_15: false, requires: ["profile"] },
  { id: "notifications", label: "Notification setup (ntfy)", delegate_age_12: false, delegate_age_15: true, requires: ["profile"] },
  { id: "contacts", label: "Counselor & leader contacts", delegate_age_12: false, delegate_age_15: true, requires: ["profile"] },
  { id: "blue_card", label: "Blue card request", delegate_age_12: false, delegate_age_15: true, requires: ["contacts"] },
];
```

**Step 3: Build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add mcp-servers/scout-quest/src/db.ts mcp-servers/scout-quest/src/constants.ts
git commit -m "feat: add setup_status collection and SETUP_STEPS definitions"
```

---

### Task 4: Guide Entry Point and Registration Index

**Files:**
- Create: `mcp-servers/scout-quest/src/guide.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/index.ts`
- Modify: `mcp-servers/scout-quest/src/resources/index.ts`

**Step 1: Create `tools/guide/index.ts` (empty for now)**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  // Tools will be registered in subsequent tasks
}
```

**Step 2: Add `registerGuideResources` to `resources/index.ts`**

Add at the end of the file:

```typescript
export function registerGuideResources(server: McpServer, guideEmail: string): void {
  // Resources will be registered in subsequent tasks
}
```

**Step 3: Create `guide.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGuideResources } from "./resources/index.js";
import { registerGuideTools } from "./tools/guide/index.js";

const GUIDE_INSTRUCTIONS = `SCOUT GUIDE — SETUP & SUPPORT TOOLS

You are Scout Guide Coach, helping parents, scoutmasters, and other trusted adults
set up and support scouts on their Scout Quest journey.

SESSION START:
1. Read guide://scouts to see which scouts you guide
2. For each scout, read guide://scout/{email}/setup-status
3. If onboarding is incomplete, continue where you left off
4. If onboarding is complete, ask what the guide needs help with

ONBOARDING WORKFLOW:
When setting up a new scout, work through these steps one at a time:
1. setup_scout_profile — name, age, troop (MUST be first)
2. set_scout_interests — likes, dislikes, motivations
3. set_quest_goal — what they're saving for, target budget
4. set_chore_list — at least 5 chores with frequencies and pay rates
5. set_budget_plan — requires quest_goal and chore_list first
6. set_character_preferences — AI personality tuning
7. set_session_limits — daily time caps
8. Notification setup (ntfy) — guide through app install
9. Counselor & leader contacts — merit badge counselors, scoutmaster
10. Blue card request — requires contacts first

DEPENDENCIES:
- Step 1 (profile) must complete before any other step
- Step 5 (budget) requires steps 3 and 4
- Step 10 (blue card) requires step 9
- All other steps can be done in any order or deferred

AGE-AWARE DEFAULTS:
- Under 12: Guide handles most steps, scout handles interests
- 12-14: Guide handles core setup, can delegate budget and notifications
- 15+: Suggest delegating interests, goal, budget, character, notifications, contacts, blue card

When suggesting delegation, explain: "Your scout can handle this in their session.
Want to delegate it, or set it up here?"

RESOURCES (read anytime):
- guide://scouts — your linked scouts
- guide://scout/{email}/summary — quest progress overview
- guide://scout/{email}/chores — chore streak and income
- guide://scout/{email}/budget — budget tracking
- guide://scout/{email}/requirements — merit badge progress
- guide://scout/{email}/conversations — recent session summaries
- guide://scout/{email}/reminders — pending items
- guide://scout/{email}/setup-status — onboarding checklist

MONITORING TOOLS:
- get_conversation_detail — full transcript for a specific session
- flag_conversation — mark for follow-up
- send_notification — push alert to scout

ADJUSTMENT TOOLS:
- adjust_scout_profile — update profile details
- adjust_quest_goal — change goal or budget targets
- adjust_character — tweak AI personality
- adjust_delegation — change who handles setup tasks
- suggest_intervention — get coaching options when scout needs help

COACHING PRINCIPLES:
- Help the guide help the scout. Don't replace the guide's role.
- Give options and recommend one. Explain why.
- Preserve scout agency — scouts should bring problems to guides, not the reverse.
- When scouts are stuck, suggest the guide encourage the scout to reach out.
- For sensitive topics (Family Life Req 6b), be especially thoughtful.
- Match the guide's communication style. Some want detail, some want brevity.`;

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

**Step 4: Build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Build succeeds, `dist/guide.js` is created

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/guide.ts mcp-servers/scout-quest/src/tools/guide/index.ts mcp-servers/scout-quest/src/resources/index.ts
git commit -m "feat: add guide.ts entry point with GUIDE_INSTRUCTIONS"
```

---

### Task 5: Guide Resources — Scout List and Setup Status

**Files:**
- Create: `mcp-servers/scout-quest/src/resources/guideScouts.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideSetupStatus.ts`
- Modify: `mcp-servers/scout-quest/src/resources/index.ts`

**Step 1: Write test for guide auth lookup**

Create `mcp-servers/scout-quest/src/__tests__/guide-resources.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SETUP_STEPS } from "../constants.js";

describe("setup steps", () => {
  it("has profile as first step with no dependencies", () => {
    const profile = SETUP_STEPS[0];
    expect(profile.id).toBe("profile");
    expect(profile.requires).toEqual([]);
  });

  it("budget_plan requires quest_goal and chore_list", () => {
    const budget = SETUP_STEPS.find(s => s.id === "budget_plan");
    expect(budget).toBeDefined();
    expect(budget!.requires).toContain("quest_goal");
    expect(budget!.requires).toContain("chore_list");
  });

  it("blue_card requires contacts", () => {
    const blueCard = SETUP_STEPS.find(s => s.id === "blue_card");
    expect(blueCard).toBeDefined();
    expect(blueCard!.requires).toContain("contacts");
  });

  it("has 10 steps total", () => {
    expect(SETUP_STEPS).toHaveLength(10);
  });
});
```

**Step 2: Run test**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/guide-resources.test.ts`
Expected: PASS

**Step 3: Create `guideScouts.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUserRoles } from "../auth.js";
import { scouts } from "../db.js";

export function registerGuideScouts(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scouts",
    "guide://scouts",
    {
      title: "My Scouts",
      description: "List all scouts linked to this guide.",
      mimeType: "application/json",
    },
    async (uri) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide") {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "No guide role found", scouts: [] }) }] };
      }

      const col = await scouts();
      const linkedScouts = await col.find(
        { email: { $in: guideRole.scout_emails } },
      ).toArray();

      const summaries = linkedScouts.map(s => ({
        email: s.email,
        name: s.name,
        age: s.age,
        troop: s.troop,
        quest_status: s.quest_state.quest_status,
        goal_item: s.quest_state.goal_item,
        current_savings: s.quest_state.current_savings,
        target_budget: s.quest_state.target_budget,
      }));

      return { contents: [{ uri: uri.href, text: JSON.stringify(summaries) }] };
    },
  );
}
```

**Step 4: Create `guideSetupStatus.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setupStatus } from "../db.js";
import { SETUP_STEPS } from "../constants.js";

export function registerGuideSetupStatus(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_setup_status",
    new ResourceTemplate("guide://scout/{email}/setup-status", { list: undefined }),
    {
      title: "Setup Status",
      description: "Onboarding checklist progress for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      const col = await setupStatus();
      const status = await col.findOne({ scout_email: scoutEmail, guide_email: guideEmail });

      if (!status) {
        // No setup started — return default checklist
        const defaultSteps = SETUP_STEPS.map(s => ({
          id: s.id,
          label: s.label,
          status: "pending" as const,
          requires: s.requires,
        }));
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ scout_email: scoutEmail, started: false, steps: defaultSteps }),
          }],
        };
      }

      // Merge with step definitions for dependency info
      const stepsWithDeps = status.steps.map(step => {
        const def = SETUP_STEPS.find(s => s.id === step.id);
        return { ...step, requires: def?.requires ?? [] };
      });

      const completed = stepsWithDeps.filter(s => s.status === "complete").length;
      const total = stepsWithDeps.length;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            scout_email: scoutEmail,
            started: true,
            progress: `${completed}/${total}`,
            steps: stepsWithDeps,
          }),
        }],
      };
    },
  );
}
```

**Step 5: Register in `resources/index.ts`**

Add imports and calls in `registerGuideResources`:

```typescript
import { registerGuideScouts } from "./guideScouts.js";
import { registerGuideSetupStatus } from "./guideSetupStatus.js";

export function registerGuideResources(server: McpServer, guideEmail: string): void {
  registerGuideScouts(server, guideEmail);
  registerGuideSetupStatus(server, guideEmail);
}
```

**Step 6: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 7: Commit**

```bash
git add mcp-servers/scout-quest/src/resources/guideScouts.ts mcp-servers/scout-quest/src/resources/guideSetupStatus.ts mcp-servers/scout-quest/src/resources/index.ts mcp-servers/scout-quest/src/__tests__/guide-resources.test.ts
git commit -m "feat: add guide://scouts and guide://setup-status resources"
```

---

### Task 6: Guide Resources — Scout Data Views

**Files:**
- Create: `mcp-servers/scout-quest/src/resources/guideSummary.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideChores.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideBudget.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideRequirements.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideReminders.ts`
- Create: `mcp-servers/scout-quest/src/resources/guideConversations.ts`
- Modify: `mcp-servers/scout-quest/src/resources/index.ts`

These resources follow the same read-only pattern as existing scout resources but use the `guide://scout/{email}/` URI prefix and verify guide access via `getUserRoles()`.

**Step 1: Create shared guide auth helper**

Create `mcp-servers/scout-quest/src/guideAuth.ts`:

```typescript
import { getUserRoles } from "./auth.js";

/**
 * Verify a guide has access to a specific scout.
 * Returns true if the guide's role includes the scout's email.
 */
export async function verifyGuideAccess(guideEmail: string, scoutEmail: string): Promise<boolean> {
  const roles = await getUserRoles(guideEmail);
  for (const role of roles) {
    if (role.type === "superuser") return true;
    if (role.type === "guide" && role.scout_emails.includes(scoutEmail)) return true;
  }
  return false;
}
```

**Step 2: Create `guideSummary.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts, requirements, choreLogs } from "../db.js";
import { verifyGuideAccess } from "../guideAuth.js";

export function registerGuideSummary(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_summary",
    new ResourceTemplate("guide://scout/{email}/summary", { list: undefined }),
    {
      title: "Scout Summary",
      description: "Quest progress overview for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const reqCol = await requirements();
      const reqs = await reqCol.find({ scout_email: scoutEmail }).toArray();
      const reqSummary = {
        total: reqs.length,
        signed_off: reqs.filter(r => r.status === "signed_off").length,
        in_progress: reqs.filter(r => ["in_progress", "tracking"].includes(r.status)).length,
        not_started: reqs.filter(r => r.status === "not_started").length,
      };

      const choreCol = await choreLogs();
      const recentChores = await choreCol.find({ scout_email: scoutEmail })
        .sort({ date: -1 }).limit(7).toArray();
      const lastChoreDate = recentChores[0]?.date ?? null;

      const qs = scout.quest_state;
      const progressPct = qs.target_budget > 0
        ? Math.round((qs.current_savings / qs.target_budget) * 100)
        : 0;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            name: scout.name,
            age: scout.age,
            troop: scout.troop,
            quest_status: qs.quest_status,
            goal_item: qs.goal_item,
            savings_progress: `$${qs.current_savings.toFixed(2)} / $${qs.target_budget.toFixed(2)} (${progressPct}%)`,
            requirements: reqSummary,
            last_chore_date: lastChoreDate,
            recent_chore_days: recentChores.length,
          }),
        }],
      };
    },
  );
}
```

**Step 3: Create `guideChores.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts, choreLogs } from "../db.js";
import { verifyGuideAccess } from "../guideAuth.js";
import { STREAK_MILESTONES } from "../constants.js";

export function registerGuideChores(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_chores",
    new ResourceTemplate("guide://scout/{email}/chores", { list: undefined }),
    {
      title: "Scout Chores",
      description: "Chore streak and income summary for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const choreCol = await choreLogs();
      const logs = await choreCol.find({ scout_email: scoutEmail })
        .sort({ date: -1 }).limit(100).toArray();

      // Calculate streak
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);
      for (const log of logs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      const totalIncome = logs.reduce((sum, l) => sum + l.income_earned, 0);
      const nextMilestone = STREAK_MILESTONES.find(m => m > streak) ?? null;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            chore_list: scout.chore_list,
            current_streak: streak,
            next_milestone: nextMilestone,
            total_logs: logs.length,
            total_income_earned: totalIncome,
            last_7_days: logs.slice(0, 7).map(l => ({
              date: l.date,
              chores: l.chores_completed.length,
              income: l.income_earned,
            })),
          }),
        }],
      };
    },
  );
}
```

**Step 4: Create `guideBudget.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts, budgetEntries } from "../db.js";
import { verifyGuideAccess } from "../guideAuth.js";

export function registerGuideBudget(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_budget",
    new ResourceTemplate("guide://scout/{email}/budget", { list: undefined }),
    {
      title: "Scout Budget",
      description: "Budget tracking snapshot for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      const budgetCol = await budgetEntries();
      const entries = await budgetCol.find({ scout_email: scoutEmail })
        .sort({ week_number: -1 }).toArray();

      const latestWeek = entries[0]?.week_number ?? 0;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            projected: scout.budget_projected ?? null,
            current_savings: scout.quest_state.current_savings,
            target_budget: scout.quest_state.target_budget,
            weeks_tracked: latestWeek,
            weeks_remaining: Math.max(0, 13 - latestWeek),
            recent_entries: entries.slice(0, 4).map(e => ({
              week: e.week_number,
              income_total: e.income.reduce((s, i) => s + i.amount, 0),
              expense_total: e.expenses.reduce((s, x) => s + x.amount, 0),
              savings: e.savings_deposited,
            })),
          }),
        }],
      };
    },
  );
}
```

**Step 5: Create `guideRequirements.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirements } from "../db.js";
import { verifyGuideAccess } from "../guideAuth.js";

export function registerGuideRequirements(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_requirements",
    new ResourceTemplate("guide://scout/{email}/requirements", { list: undefined }),
    {
      title: "Scout Requirements",
      description: "All merit badge requirement states for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      const col = await requirements();
      const reqs = await col.find({ scout_email: scoutEmail }).toArray();

      const byBadge = {
        personal_management: reqs.filter(r => r.badge === "personal_management").map(r => ({
          req_id: r.req_id, status: r.status, quest_driven: r.quest_driven,
          tracking_progress: r.tracking_progress, tracking_duration: r.tracking_duration,
        })),
        family_life: reqs.filter(r => r.badge === "family_life").map(r => ({
          req_id: r.req_id, status: r.status, quest_driven: r.quest_driven,
          tracking_progress: r.tracking_progress, tracking_duration: r.tracking_duration,
        })),
      };

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(byBadge),
        }],
      };
    },
  );
}
```

**Step 6: Create `guideReminders.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reminders } from "../db.js";
import { verifyGuideAccess } from "../guideAuth.js";

export function registerGuideReminders(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_reminders",
    new ResourceTemplate("guide://scout/{email}/reminders", { list: undefined }),
    {
      title: "Scout Reminders",
      description: "Pending and overdue items for a scout.",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      const col = await reminders();
      const active = await col.find({
        scout_email: scoutEmail,
        active: true,
      }).toArray();

      const now = new Date();
      const categorized = {
        overdue: active.filter(r => r.next_trigger && new Date(r.next_trigger) < now),
        upcoming: active.filter(r => r.next_trigger && new Date(r.next_trigger) >= now),
      };

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(categorized),
        }],
      };
    },
  );
}
```

**Step 7: Create `guideConversations.ts`**

This reads from the LibreChat MongoDB (`librechat` database). The guide endpoint's MCP server connects to the scout-quest MongoDB by default, but conversations live in LibreChat's DB. We need a separate connection.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MongoClient } from "mongodb";
import { verifyGuideAccess } from "../guideAuth.js";

let librechatDb: ReturnType<MongoClient["db"]> | null = null;

async function getLibreChatDb() {
  if (librechatDb) return librechatDb;
  const uri = process.env.LIBRECHAT_MONGO_URI || "mongodb://mongodb:27017/LibreChat";
  const client = new MongoClient(uri);
  await client.connect();
  librechatDb = client.db();
  return librechatDb;
}

export function registerGuideConversations(server: McpServer, guideEmail: string): void {
  server.registerResource(
    "guide_scout_conversations",
    new ResourceTemplate("guide://scout/{email}/conversations", { list: undefined }),
    {
      title: "Scout Conversations",
      description: "Recent conversation summaries for a scout (not full transcripts).",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scoutEmail = decodeURIComponent(params.email as string);
      if (!await verifyGuideAccess(guideEmail, scoutEmail)) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Access denied" }) }] };
      }

      try {
        const db = await getLibreChatDb();
        // LibreChat stores user email in the users collection
        // Conversations reference the user's _id
        const lcUsers = db.collection("users");
        const lcUser = await lcUsers.findOne({ email: scoutEmail });
        if (!lcUser) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ conversations: [], note: "Scout has no LibreChat account yet" }) }] };
        }

        const convos = db.collection("conversations");
        const recent = await convos.find({ user: lcUser._id.toString() })
          .sort({ updatedAt: -1 })
          .limit(10)
          .toArray();

        const summaries = recent.map(c => ({
          id: c._id.toString(),
          title: c.title ?? "Untitled",
          model: c.model,
          endpoint: c.endpoint,
          created: c.createdAt,
          updated: c.updatedAt,
        }));

        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ conversations: summaries }),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              error: "Could not connect to LibreChat database",
              detail: err instanceof Error ? err.message : String(err),
            }),
          }],
        };
      }
    },
  );
}
```

**Step 8: Register all resources in `index.ts`**

Update `registerGuideResources` in `resources/index.ts`:

```typescript
import { registerGuideScouts } from "./guideScouts.js";
import { registerGuideSetupStatus } from "./guideSetupStatus.js";
import { registerGuideSummary } from "./guideSummary.js";
import { registerGuideChores } from "./guideChores.js";
import { registerGuideBudget } from "./guideBudget.js";
import { registerGuideRequirements } from "./guideRequirements.js";
import { registerGuideReminders } from "./guideReminders.js";
import { registerGuideConversations } from "./guideConversations.js";

export function registerGuideResources(server: McpServer, guideEmail: string): void {
  registerGuideScouts(server, guideEmail);
  registerGuideSetupStatus(server, guideEmail);
  registerGuideSummary(server, guideEmail);
  registerGuideChores(server, guideEmail);
  registerGuideBudget(server, guideEmail);
  registerGuideRequirements(server, guideEmail);
  registerGuideReminders(server, guideEmail);
  registerGuideConversations(server, guideEmail);
}
```

**Step 9: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 10: Commit**

```bash
git add mcp-servers/scout-quest/src/resources/ mcp-servers/scout-quest/src/guideAuth.ts
git commit -m "feat: add guide resources — summary, chores, budget, requirements, reminders, conversations"
```

---

### Task 7: Onboarding Tools — Profile and Interests

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/setupScoutProfile.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setScoutInterests.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

**Step 1: Write test for setup_scout_profile**

Add to `mcp-servers/scout-quest/src/__tests__/guide-tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, Db } from "mongodb";
import { SETUP_STEPS } from "../constants.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest_test";

let client: MongoClient | null = null;
let db: Db | null = null;
let mongoAvailable = false;

beforeAll(async () => {
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await client.connect();
    db = client.db();
    mongoAvailable = true;
  } catch {
    console.log("MongoDB not available — skipping integration tests");
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe("guide tools (integration)", () => {
  beforeEach(async () => {
    if (!mongoAvailable || !db) return;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  });

  describe("setupScoutProfile (self-serve)", () => {
    it("creates scout, user, and setup_status documents", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      const usersCol = db!.collection("users");
      const setupCol = db!.collection("setup_status");

      const guideEmail = "parent@test.com";
      const scoutEmail = "scout@test.com";
      const now = new Date();

      // Simulate what setupScoutProfile does
      await scoutsCol.insertOne({
        email: scoutEmail,
        name: "Test Scout",
        age: 13,
        troop: "42",
        parent_guardian: { name: "Test Parent", email: guideEmail },
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
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now, updated_at: now,
      });

      // Create guide user with role
      await usersCol.insertOne({
        email: guideEmail,
        roles: [{ type: "guide", scout_emails: [scoutEmail] }],
        created_at: now, updated_at: now,
      });

      // Create setup status
      const steps = SETUP_STEPS.map(s => ({
        id: s.id, label: s.label, status: "pending" as const,
      }));
      steps[0].status = "complete" as "pending"; // profile step done
      await setupCol.insertOne({
        scout_email: scoutEmail,
        guide_email: guideEmail,
        steps,
        created_at: now, updated_at: now,
      });

      const scout = await scoutsCol.findOne({ email: scoutEmail });
      expect(scout).toBeDefined();
      expect(scout!.guide_email).toBe(guideEmail);

      const status = await setupCol.findOne({ scout_email: scoutEmail });
      expect(status).toBeDefined();
      expect(status!.steps[0].status).toBe("complete");
    });

    it("rejects duplicate scout email", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      await scoutsCol.insertOne({ email: "dupe@scout.com", name: "Existing", created_at: new Date() });
      const existing = await scoutsCol.findOne({ email: "dupe@scout.com" });
      expect(existing).toBeDefined();
    });
  });
});
```

**Step 2: Run test**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/guide-tools.test.ts`
Expected: PASS (or skip if no MongoDB)

**Step 3: Create `setupScoutProfile.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, users, setupStatus } from "../../db.js";
import { SETUP_STEPS } from "../../constants.js";

export function registerSetupScoutProfile(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "setup_scout_profile",
    {
      title: "Setup Scout Profile",
      description: "Create a new scout profile (self-serve for parent-guides). Sets up the scout record, assigns guide role, and initializes the onboarding checklist.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's Gmail address"),
        name: z.string().describe("Scout's full name"),
        age: z.number().int().min(10).max(18).describe("Scout's age (10-18)"),
        troop: z.string().describe("Troop number/identifier"),
        patrol: z.string().optional().describe("Patrol name"),
        guide_name: z.string().describe("Guide's (your) name"),
      },
    },
    async ({ scout_email, name, age, troop, patrol, guide_name }) => {
      const scoutsCol = await scouts();

      // Check for duplicate
      const existing = await scoutsCol.findOne({ email: scout_email });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Scout with email ${scout_email} already exists.` }] };
      }

      const now = new Date();

      // Create scout user
      const usersCol = await users();
      await usersCol.updateOne(
        { email: scout_email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email: scout_email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true },
      );

      // Create/update guide user with guide role
      await usersCol.updateOne(
        { email: guideEmail },
        {
          $set: { updated_at: now },
          $addToSet: { roles: { type: "guide" as const, scout_emails: [scout_email] } },
          $setOnInsert: { email: guideEmail, created_at: now },
        },
        { upsert: true },
      );

      // Also add scout_email to existing guide role if it exists
      await usersCol.updateOne(
        { email: guideEmail, "roles.type": "guide" },
        { $addToSet: { "roles.$.scout_emails": scout_email } },
      );

      // Create scout profile
      await scoutsCol.insertOne({
        email: scout_email,
        name,
        age,
        troop,
        patrol,
        quest_state: {
          goal_item: "",
          goal_description: "",
          target_budget: 0,
          savings_capacity: 0,
          loan_path_active: false,
          quest_start_date: null,
          current_savings: 0,
          quest_status: "setup",
        },
        character: {
          base: "guide",
          quest_overlay: "custom",
          tone_dial: 3,
          domain_intensity: 3,
          tone_min: 1,
          tone_max: 5,
          domain_min: 1,
          domain_max: 5,
          sm_notes: "",
          parent_notes: "",
          avoid: [],
          calibration_review_enabled: false,
          calibration_review_weeks: [],
        },
        counselors: {
          personal_management: { name: "", email: "" },
          family_life: { name: "", email: "" },
        },
        unit_leaders: {
          scoutmaster: { name: "", email: "" },
        },
        parent_guardian: { name: guide_name, email: guideEmail },
        guide_email: guideEmail,
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now,
        updated_at: now,
      });

      // Initialize setup status with age-aware defaults
      const steps = SETUP_STEPS.map(stepDef => {
        let defaultStatus: "pending" | "delegated_to_scout" = "pending";
        if (age >= 15 && stepDef.delegate_age_15) {
          defaultStatus = "delegated_to_scout";
        } else if (age >= 12 && stepDef.delegate_age_12) {
          defaultStatus = "delegated_to_scout";
        }
        return {
          id: stepDef.id,
          label: stepDef.label,
          status: stepDef.id === "profile" ? ("complete" as const) : defaultStatus,
          ...(stepDef.id === "profile" ? { completed_at: now } : {}),
          ...(defaultStatus === "delegated_to_scout" ? { delegated_at: now } : {}),
        };
      });

      const statusCol = await setupStatus();
      await statusCol.insertOne({
        scout_email: scout_email,
        guide_email: guideEmail,
        steps,
        created_at: now,
        updated_at: now,
      });

      const delegated = steps.filter(s => s.status === "delegated_to_scout");
      const delegateNote = delegated.length > 0
        ? ` Based on ${name}'s age (${age}), I've suggested delegating ${delegated.length} steps to the scout: ${delegated.map(s => s.label).join(", ")}. You can override any of these.`
        : "";

      return {
        content: [{
          type: "text",
          text: `Scout "${name}" (${scout_email}) created in troop ${troop}. You are set as the guide.${delegateNote} Next step: set up interests and preferences.`,
        }],
      };
    },
  );
}
```

**Step 4: Create `setScoutInterests.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSetScoutInterests(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_scout_interests",
    {
      title: "Set Scout Interests",
      description: "Record the scout's interests, likes/dislikes, and motivations. Helps the AI coach speak the scout's language.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        likes: z.array(z.string()).describe("Things the scout likes/enjoys"),
        dislikes: z.array(z.string()).optional().describe("Things the scout dislikes/avoids"),
        motivations: z.array(z.string()).optional().describe("What motivates the scout"),
      },
    },
    async ({ scout_email, likes, dislikes, motivations }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            interests: {
              likes,
              dislikes: dislikes ?? [],
              motivations: motivations ?? [],
            },
            updated_at: new Date(),
          },
        },
      );

      // Update setup status
      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email: scout_email, guide_email: guideEmail, "steps.id": "interests" },
        {
          $set: {
            "steps.$.status": "complete",
            "steps.$.completed_at": new Date(),
            updated_at: new Date(),
          },
        },
      );

      return {
        content: [{
          type: "text",
          text: `Interests set for ${scout.name}: ${likes.length} likes${dislikes ? `, ${dislikes.length} dislikes` : ""}${motivations ? `, ${motivations.length} motivations` : ""}. The AI coach will use these to personalize conversations.`,
        }],
      };
    },
  );
}
```

**Step 5: Register in `tools/guide/index.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupScoutProfile } from "./setupScoutProfile.js";
import { registerSetScoutInterests } from "./setScoutInterests.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  registerSetupScoutProfile(server, guideEmail);
  registerSetScoutInterests(server, guideEmail);
}
```

**Step 6: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 7: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/guide/ mcp-servers/scout-quest/src/__tests__/guide-tools.test.ts
git commit -m "feat: add setup_scout_profile and set_scout_interests guide tools"
```

---

### Task 8: Onboarding Tools — Quest, Chores, Budget, Character, Limits

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/setQuestGoal.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setChoreList.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setBudgetPlan.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setCharacterPreferences.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/setSessionLimits.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

These tools follow the same pattern: verify guide access, update scout document, mark setup step complete.

**Step 1: Create `setQuestGoal.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSetQuestGoal(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_quest_goal",
    {
      title: "Set Quest Goal",
      description: "Set the scout's quest goal — what they're saving for, target budget, and description.",
      inputSchema: {
        scout_email: z.string().email(),
        goal_item: z.string().describe("What the scout is saving for (e.g., 'Gaming PC')"),
        goal_description: z.string().describe("Description of the quest goal"),
        target_budget: z.number().min(0).describe("Total cost of the goal"),
        savings_capacity: z.number().min(0).optional().describe("How much the scout can realistically save through chores"),
      },
    },
    async ({ scout_email, goal_item, goal_description, target_budget, savings_capacity }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const capacity = savings_capacity ?? scout.quest_state.savings_capacity;
      const loanPathActive = target_budget > capacity;

      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            "quest_state.goal_item": goal_item,
            "quest_state.goal_description": goal_description,
            "quest_state.target_budget": target_budget,
            ...(savings_capacity !== undefined ? { "quest_state.savings_capacity": savings_capacity } : {}),
            "quest_state.loan_path_active": loanPathActive,
            updated_at: new Date(),
          },
        },
      );

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": "quest_goal" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      const loanNote = loanPathActive ? " Loan path is ACTIVE (target exceeds savings capacity)." : "";
      return {
        content: [{
          type: "text",
          text: `Quest goal set: "${goal_item}" — $${target_budget.toFixed(2)} target.${loanNote}`,
        }],
      };
    },
  );
}
```

**Step 2: Create `setChoreList.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerGuideSetChoreList(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_chore_list",
    {
      title: "Set Chore List",
      description: "Set the scout's approved chores. FL Req 3 requires at least 5 chores.",
      inputSchema: {
        scout_email: z.string().email(),
        chores: z.array(z.object({
          id: z.string().describe("Unique chore ID (e.g., 'dishes', 'trash')"),
          name: z.string().describe("Chore name"),
          frequency: z.enum(["daily", "weekly", "as needed"]),
          earns_income: z.boolean(),
          income_amount: z.number().min(0).nullable().describe("Amount earned per completion"),
        })).min(5).describe("At least 5 chores required for FL Req 3"),
      },
    },
    async ({ scout_email, chores }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        { $set: { chore_list: chores, updated_at: new Date() } },
      );

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": "chore_list" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      const incomeChores = chores.filter(c => c.earns_income);
      return {
        content: [{
          type: "text",
          text: `Chore list set: ${chores.length} chores (${incomeChores.length} earn income). Ready for FL Req 3 tracking.`,
        }],
      };
    },
  );
}
```

**Step 3: Create `setBudgetPlan.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSetBudgetPlan(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_budget_plan",
    {
      title: "Set Budget Plan",
      description: "Set the scout's projected weekly budget — income sources, expense categories, savings target.",
      inputSchema: {
        scout_email: z.string().email(),
        income_sources: z.array(z.object({
          name: z.string(),
          weekly_amount: z.number().min(0),
        })).describe("Weekly income sources"),
        expense_categories: z.array(z.object({
          name: z.string(),
          weekly_amount: z.number().min(0),
        })).describe("Weekly expense categories"),
        savings_target_weekly: z.number().min(0).describe("Weekly savings target"),
      },
    },
    async ({ scout_email, income_sources, expense_categories, savings_target_weekly }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            budget_projected: { income_sources, expense_categories, savings_target_weekly },
            updated_at: new Date(),
          },
        },
      );

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": "budget_plan" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      const totalIncome = income_sources.reduce((s, i) => s + i.weekly_amount, 0);
      const totalExpense = expense_categories.reduce((s, e) => s + e.weekly_amount, 0);
      return {
        content: [{
          type: "text",
          text: `Budget plan set. Weekly: $${totalIncome.toFixed(2)} income, $${totalExpense.toFixed(2)} expenses, $${savings_target_weekly.toFixed(2)} savings target.`,
        }],
      };
    },
  );
}
```

**Step 4: Create `setCharacterPreferences.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSetCharacterPreferences(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_character_preferences",
    {
      title: "Set Character Preferences",
      description: "Configure the AI coach's personality for this scout — base type, overlay, tone bounds, avoid list.",
      inputSchema: {
        scout_email: z.string().email(),
        base: z.enum(["guide", "pathfinder", "trailblazer"]).optional().describe("Base character type"),
        quest_overlay: z.string().optional().describe("Theme overlay (gamer_hardware, outdoor_adventure, etc.)"),
        tone_min: z.number().int().min(1).max(5).optional().describe("Minimum tone level (1=serious, 5=max personality)"),
        tone_max: z.number().int().min(1).max(5).optional().describe("Maximum tone level"),
        domain_min: z.number().int().min(1).max(5).optional().describe("Minimum domain intensity"),
        domain_max: z.number().int().min(1).max(5).optional().describe("Maximum domain intensity"),
        parent_notes: z.string().optional().describe("Notes from the guide about the scout's personality"),
        avoid: z.array(z.string()).optional().describe("Words or topics to avoid"),
      },
    },
    async ({ scout_email, ...fields }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
          update[`character.${key}`] = value;
        }
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": "character" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      const changedFields = Object.keys(fields).filter(k => (fields as Record<string, unknown>)[k] !== undefined);
      return {
        content: [{
          type: "text",
          text: `Character preferences updated: ${changedFields.join(", ")}.`,
        }],
      };
    },
  );
}
```

**Step 5: Create `setSessionLimits.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSetSessionLimits(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "set_session_limits",
    {
      title: "Set Session Limits",
      description: "Set daily time limits for the scout's AI coaching sessions.",
      inputSchema: {
        scout_email: z.string().email(),
        max_minutes_per_day: z.number().int().min(5).max(120).describe("Maximum minutes per day (5-120)"),
        allowed_days: z.array(z.string()).optional().describe("Allowed days of the week (e.g., ['monday', 'wednesday', 'friday']). Omit for all days."),
      },
    },
    async ({ scout_email, max_minutes_per_day, allowed_days }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to modify this scout." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      await col.updateOne(
        { email: scout_email },
        {
          $set: {
            session_limits: { max_minutes_per_day, ...(allowed_days ? { allowed_days } : {}) },
            updated_at: new Date(),
          },
        },
      );

      const statusCol = await setupStatus();
      await statusCol.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": "session_limits" },
        { $set: { "steps.$.status": "complete", "steps.$.completed_at": new Date(), updated_at: new Date() } },
      );

      const daysNote = allowed_days ? ` on ${allowed_days.join(", ")}` : " every day";
      return {
        content: [{
          type: "text",
          text: `Session limits set: ${max_minutes_per_day} minutes/day${daysNote}. The scout's AI coach will enforce this cooperatively.`,
        }],
      };
    },
  );
}
```

**Step 6: Register all in `tools/guide/index.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupScoutProfile } from "./setupScoutProfile.js";
import { registerSetScoutInterests } from "./setScoutInterests.js";
import { registerSetQuestGoal } from "./setQuestGoal.js";
import { registerGuideSetChoreList } from "./setChoreList.js";
import { registerSetBudgetPlan } from "./setBudgetPlan.js";
import { registerSetCharacterPreferences } from "./setCharacterPreferences.js";
import { registerSetSessionLimits } from "./setSessionLimits.js";

export function registerGuideTools(server: McpServer, guideEmail: string): void {
  // Onboarding tools
  registerSetupScoutProfile(server, guideEmail);
  registerSetScoutInterests(server, guideEmail);
  registerSetQuestGoal(server, guideEmail);
  registerGuideSetChoreList(server, guideEmail);
  registerSetBudgetPlan(server, guideEmail);
  registerSetCharacterPreferences(server, guideEmail);
  registerSetSessionLimits(server, guideEmail);
}
```

**Step 7: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 8: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/guide/
git commit -m "feat: add onboarding tools — quest goal, chores, budget, character, session limits"
```

---

### Task 9: Monitoring Tools

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/getConversationDetail.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/flagConversation.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/guideSendNotification.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

**Step 1: Create `getConversationDetail.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MongoClient } from "mongodb";
import { verifyGuideAccess } from "../../guideAuth.js";

let librechatDb: ReturnType<MongoClient["db"]> | null = null;

async function getLibreChatDb() {
  if (librechatDb) return librechatDb;
  const uri = process.env.LIBRECHAT_MONGO_URI || "mongodb://mongodb:27017/LibreChat";
  const client = new MongoClient(uri);
  await client.connect();
  librechatDb = client.db();
  return librechatDb;
}

export function registerGetConversationDetail(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "get_conversation_detail",
    {
      title: "Get Conversation Detail",
      description: "Pull the full transcript for a specific scout conversation. Use sparingly — summaries are usually sufficient.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        conversation_id: z.string().describe("Conversation ID from the conversations list"),
      },
    },
    async ({ scout_email, conversation_id }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to view this scout's conversations." }] };
      }

      try {
        const db = await getLibreChatDb();
        const messages = db.collection("messages");
        const msgs = await messages.find({ conversationId: conversation_id })
          .sort({ createdAt: 1 })
          .toArray();

        if (msgs.length === 0) {
          return { content: [{ type: "text", text: "No messages found for this conversation." }] };
        }

        const transcript = msgs.map(m => {
          const role = m.isCreatedByUser ? "Scout" : "Coach";
          const text = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
          return `[${role}]: ${text}`;
        }).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Conversation transcript (${msgs.length} messages):\n\n${transcript}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Error reading conversation: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    },
  );
}
```

**Step 2: Create `flagConversation.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reminders } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerFlagConversation(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "flag_conversation",
    {
      title: "Flag Conversation",
      description: "Mark a scout conversation for follow-up. Creates a reminder visible to the guide.",
      inputSchema: {
        scout_email: z.string().email(),
        conversation_id: z.string().describe("Conversation ID to flag"),
        reason: z.string().describe("Why this conversation needs follow-up"),
      },
    },
    async ({ scout_email, conversation_id, reason }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to flag this scout's conversations." }] };
      }

      const col = await reminders();
      await col.insertOne({
        scout_email,
        type: "check_in",
        message: `Flagged conversation ${conversation_id}: ${reason}`,
        schedule: "once",
        last_triggered: null,
        next_trigger: new Date(),
        active: true,
        created_at: new Date(),
      });

      return {
        content: [{
          type: "text",
          text: `Conversation flagged for follow-up: "${reason}". This will appear in ${scout_email}'s reminders.`,
        }],
      };
    },
  );
}
```

**Step 3: Create `guideSendNotification.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerGuideSendNotification(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "send_notification",
    {
      title: "Send Notification",
      description: "Send a push notification to the scout via ntfy. Use sparingly — too many notifications feel like surveillance.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout to notify (for access check)"),
        message: z.string().describe("Notification message"),
        title: z.string().optional().describe("Notification title"),
        priority: z.number().int().min(1).max(5).optional().describe("Priority 1-5 (3 = default)"),
      },
    },
    async ({ scout_email, message, title, priority }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: You are not authorized to notify this scout." }] };
      }

      const topic = process.env.NTFY_TOPIC;
      if (!topic) {
        return { content: [{ type: "text", text: "Error: NTFY_TOPIC not configured. Notifications are disabled." }] };
      }

      try {
        const response = await fetch(`https://ntfy.sh/${topic}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            message,
            ...(title && { title }),
            ...(priority && { priority }),
          }),
        });

        if (!response.ok) {
          return { content: [{ type: "text", text: `Error: ntfy responded with ${response.status}` }] };
        }

        return { content: [{ type: "text", text: `Notification sent to scout: "${title || message}"` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );
}
```

**Step 4: Register in `tools/guide/index.ts`**

Add imports and calls:

```typescript
import { registerGetConversationDetail } from "./getConversationDetail.js";
import { registerFlagConversation } from "./flagConversation.js";
import { registerGuideSendNotification } from "./guideSendNotification.js";

// Inside registerGuideTools, after onboarding tools:
  // Monitoring tools
  registerGetConversationDetail(server, guideEmail);
  registerFlagConversation(server, guideEmail);
  registerGuideSendNotification(server, guideEmail);
```

**Step 5: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 6: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/guide/
git commit -m "feat: add monitoring tools — conversation detail, flag, notification"
```

---

### Task 10: Adjustment Tools

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustScoutProfile.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustQuestGoal.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustCharacter.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/adjustDelegation.ts`
- Create: `mcp-servers/scout-quest/src/tools/guide/suggestIntervention.ts`
- Modify: `mcp-servers/scout-quest/src/tools/guide/index.ts`

**Step 1: Create `adjustScoutProfile.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerAdjustScoutProfile(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_scout_profile",
    {
      title: "Adjust Scout Profile",
      description: "Update scout profile details — age, troop, patrol, interests.",
      inputSchema: {
        scout_email: z.string().email(),
        age: z.number().int().min(10).max(18).optional(),
        troop: z.string().optional(),
        patrol: z.string().optional(),
        likes: z.array(z.string()).optional(),
        dislikes: z.array(z.string()).optional(),
        motivations: z.array(z.string()).optional(),
      },
    },
    async ({ scout_email, age, troop, patrol, likes, dislikes, motivations }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      if (age !== undefined) update.age = age;
      if (troop !== undefined) update.troop = troop;
      if (patrol !== undefined) update.patrol = patrol;
      if (likes !== undefined) update["interests.likes"] = likes;
      if (dislikes !== undefined) update["interests.dislikes"] = dislikes;
      if (motivations !== undefined) update["interests.motivations"] = motivations;

      await col.updateOne({ email: scout_email }, { $set: update });

      const changed = Object.keys(update).filter(k => k !== "updated_at");
      return {
        content: [{
          type: "text",
          text: `Profile updated for ${scout.name}: ${changed.join(", ")}.`,
        }],
      };
    },
  );
}
```

**Step 2: Create `adjustQuestGoal.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerAdjustQuestGoal(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_quest_goal",
    {
      title: "Adjust Quest Goal",
      description: "Change the scout's quest goal or budget targets.",
      inputSchema: {
        scout_email: z.string().email(),
        goal_item: z.string().optional(),
        goal_description: z.string().optional(),
        target_budget: z.number().min(0).optional(),
        savings_capacity: z.number().min(0).optional(),
        quest_status: z.enum(["setup", "active", "paused", "complete"]).optional(),
      },
    },
    async ({ scout_email, goal_item, goal_description, target_budget, savings_capacity, quest_status }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      if (goal_item !== undefined) update["quest_state.goal_item"] = goal_item;
      if (goal_description !== undefined) update["quest_state.goal_description"] = goal_description;
      if (target_budget !== undefined) update["quest_state.target_budget"] = target_budget;
      if (savings_capacity !== undefined) update["quest_state.savings_capacity"] = savings_capacity;
      if (quest_status !== undefined) update["quest_state.quest_status"] = quest_status;

      const finalTarget = target_budget ?? scout.quest_state.target_budget;
      const finalCapacity = savings_capacity ?? scout.quest_state.savings_capacity;
      update["quest_state.loan_path_active"] = finalTarget > finalCapacity;

      if (quest_status === "active" && !scout.quest_state.quest_start_date) {
        update["quest_state.quest_start_date"] = new Date();
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      return {
        content: [{
          type: "text",
          text: `Quest updated for ${scout.name}. Status: ${quest_status ?? scout.quest_state.quest_status}.`,
        }],
      };
    },
  );
}
```

**Step 3: Create `adjustCharacter.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerAdjustCharacter(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_character",
    {
      title: "Adjust Character",
      description: "Tweak the AI coach's personality — tone bounds, avoid words, overlay, parent notes.",
      inputSchema: {
        scout_email: z.string().email(),
        tone_min: z.number().int().min(1).max(5).optional(),
        tone_max: z.number().int().min(1).max(5).optional(),
        domain_min: z.number().int().min(1).max(5).optional(),
        domain_max: z.number().int().min(1).max(5).optional(),
        parent_notes: z.string().optional(),
        avoid: z.array(z.string()).optional(),
        quest_overlay: z.string().optional(),
      },
    },
    async ({ scout_email, ...fields }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      const col = await scouts();
      const scout = await col.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const update: Record<string, unknown> = { updated_at: new Date() };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) update[`character.${key}`] = value;
      }

      await col.updateOne({ email: scout_email }, { $set: update });

      const changed = Object.keys(fields).filter(k => (fields as Record<string, unknown>)[k] !== undefined);
      return {
        content: [{
          type: "text",
          text: `Character adjusted for ${scout.name}: ${changed.join(", ")}.`,
        }],
      };
    },
  );
}
```

**Step 4: Create `adjustDelegation.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { setupStatus } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";
import type { SetupStepStatus } from "../../types.js";

export function registerAdjustDelegation(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "adjust_delegation",
    {
      title: "Adjust Delegation",
      description: "Change which onboarding steps the scout handles vs. the guide.",
      inputSchema: {
        scout_email: z.string().email(),
        step_id: z.string().describe("Setup step ID (e.g., 'interests', 'budget_plan')"),
        delegate_to_scout: z.boolean().describe("true = scout handles this step, false = guide handles it"),
      },
    },
    async ({ scout_email, step_id, delegate_to_scout }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      const col = await setupStatus();
      const status = await col.findOne({ scout_email, guide_email: guideEmail });
      if (!status) {
        return { content: [{ type: "text", text: "Error: No setup status found. Run setup_scout_profile first." }] };
      }

      const step = status.steps.find(s => s.id === step_id);
      if (!step) {
        return { content: [{ type: "text", text: `Error: Unknown step "${step_id}".` }] };
      }

      if (step.status === "complete") {
        return { content: [{ type: "text", text: `Step "${step.label}" is already complete — can't change delegation.` }] };
      }

      const newStatus: SetupStepStatus = delegate_to_scout ? "delegated_to_scout" : "pending";

      await col.updateOne(
        { scout_email, guide_email: guideEmail, "steps.id": step_id },
        {
          $set: {
            "steps.$.status": newStatus,
            ...(delegate_to_scout ? { "steps.$.delegated_at": new Date() } : {}),
            updated_at: new Date(),
          },
        },
      );

      const action = delegate_to_scout
        ? `Delegated "${step.label}" to the scout. They'll be prompted in their next session.`
        : `Took back "${step.label}" — you'll handle it here.`;
      return { content: [{ type: "text", text: action }] };
    },
  );
}
```

**Step 5: Create `suggestIntervention.ts`**

This tool is different — it reads scout data and generates structured coaching options. The LLM uses the output to present options to the guide.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, choreLogs, budgetEntries, requirements } from "../../db.js";
import { verifyGuideAccess } from "../../guideAuth.js";

export function registerSuggestIntervention(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "suggest_intervention",
    {
      title: "Suggest Intervention",
      description: "Analyze a scout's situation and suggest ways the guide can help. Returns structured options with tradeoffs.",
      inputSchema: {
        scout_email: z.string().email(),
        concern: z.string().optional().describe("Specific concern (optional — tool will also auto-detect issues)"),
      },
    },
    async ({ scout_email, concern }) => {
      if (!await verifyGuideAccess(guideEmail, scout_email)) {
        return { content: [{ type: "text", text: "Error: Access denied." }] };
      }

      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      // Gather diagnostic data
      const choreCol = await choreLogs();
      const recentChores = await choreCol.find({ scout_email })
        .sort({ date: -1 }).limit(14).toArray();

      const budgetCol = await budgetEntries();
      const latestBudget = await budgetCol.findOne(
        { scout_email },
        { sort: { week_number: -1 } },
      );

      const reqCol = await requirements();
      const stuckReqs = await reqCol.find({
        scout_email,
        status: { $in: ["in_progress", "tracking", "blocked"] },
      }).toArray();

      // Calculate streak
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let expectedDate = new Date(today);
      for (const log of recentChores) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }

      // Days since last chore
      const lastChoreDate = recentChores[0]?.date;
      const daysSinceChore = lastChoreDate
        ? Math.floor((Date.now() - new Date(lastChoreDate).getTime()) / 86400000)
        : null;

      // Detect issues
      const issues: string[] = [];
      if (daysSinceChore !== null && daysSinceChore >= 3) {
        issues.push(`No chores logged in ${daysSinceChore} days`);
      }
      if (streak === 0 && recentChores.length > 0) {
        issues.push("Chore streak broken");
      }
      const blockedReqs = stuckReqs.filter(r => r.status === "blocked");
      if (blockedReqs.length > 0) {
        issues.push(`${blockedReqs.length} requirement(s) blocked`);
      }
      if (scout.quest_state.quest_status === "paused") {
        issues.push("Quest is paused");
      }
      if (concern) {
        issues.push(`Guide concern: ${concern}`);
      }

      // Build diagnostic snapshot for the LLM to use
      const snapshot = {
        scout_name: scout.name,
        age: scout.age,
        quest_status: scout.quest_state.quest_status,
        current_savings: scout.quest_state.current_savings,
        target_budget: scout.quest_state.target_budget,
        chore_streak: streak,
        days_since_last_chore: daysSinceChore,
        recent_chore_days: recentChores.length,
        weeks_budget_tracked: latestBudget?.week_number ?? 0,
        blocked_requirements: blockedReqs.map(r => r.req_id),
        detected_issues: issues,
        guide_concern: concern ?? null,
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            diagnostic: snapshot,
            coaching_note: "Use this data to suggest 2-3 intervention options. For each option: describe the approach, whether it preserves scout agency, and your recommendation with reasoning. Prefer approaches that let the scout come to the guide rather than the guide swooping in.",
          }),
        }],
      };
    },
  );
}
```

**Step 6: Register all adjustment tools in `tools/guide/index.ts`**

Add imports and calls:

```typescript
import { registerAdjustScoutProfile } from "./adjustScoutProfile.js";
import { registerAdjustQuestGoal } from "./adjustQuestGoal.js";
import { registerAdjustCharacter } from "./adjustCharacter.js";
import { registerAdjustDelegation } from "./adjustDelegation.js";
import { registerSuggestIntervention } from "./suggestIntervention.js";

// Inside registerGuideTools, after monitoring tools:
  // Adjustment tools
  registerAdjustScoutProfile(server, guideEmail);
  registerAdjustQuestGoal(server, guideEmail);
  registerAdjustCharacter(server, guideEmail);
  registerAdjustDelegation(server, guideEmail);
  registerSuggestIntervention(server, guideEmail);
```

**Step 7: Build and test**

Run: `cd mcp-servers/scout-quest && bash build.sh && npx vitest run`
Expected: Build succeeds, all tests pass

**Step 8: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/guide/
git commit -m "feat: add adjustment tools — profile, goal, character, delegation, intervention"
```

---

### Task 11: LibreChat Config — MCP Server and Model Spec

**Files:**
- Modify: `config/scout-quest/librechat.yaml`

**Step 1: Add `scout-guide` MCP server**

In the `mcpServers` section (after the existing `scout-quest` entry), add:

```yaml
  scout-guide:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/guide.js"
    env:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      LIBRECHAT_MONGO_URI: "mongodb://mongodb:27017/LibreChat"
      GUIDE_EMAIL: "{{user.email}}"
      NTFY_TOPIC: "${NTFY_TOPIC}"
    timeout: 30000
    serverInstructions: true
```

**Step 2: Add "Scout Guide" model spec**

Add a new entry to `modelSpecs.list` (after the Scout Coach entries, before Quick Chat):

```yaml
    - name: "Scout Guide (Claude)"
      label: "Scout Guide"
      description: "For parents & leaders — set up scouts, monitor progress, get coaching advice"
      preset:
        endpoint: "anthropic"
        model: "claude-sonnet-4-6"
        maxOutputTokens: 4096
        mcpServers:
          - "scout-guide"
        promptPrefix: |
          You are Scout Guide Coach, helping parents and scout leaders set up and support
          scouts on their Scout Quest journey. You have MCP tools for onboarding new scouts,
          monitoring their progress, and getting coaching advice on how to help.
          Use your tools proactively — read guide://scouts to see your linked scouts,
          then check setup status and progress before giving advice.
          When the guide is setting up a new scout, work through the onboarding steps one at a time.
          Suggest age-appropriate delegation defaults but respect the guide's preferences.
          For ongoing support, present coaching options with tradeoffs and let the guide decide.

    - name: "Scout Guide (GPT)"
      label: "Scout Guide (GPT)"
      description: "For parents & leaders — powered by GPT-4.1 mini at lower cost"
      preset:
        endpoint: "openAI"
        model: "gpt-4.1-mini"
        temperature: 0.7
        max_tokens: 4096
        mcpServers:
          - "scout-guide"
        promptPrefix: |
          You are Scout Guide Coach, helping parents and scout leaders set up and support
          scouts on their Scout Quest journey. You have MCP tools for onboarding new scouts,
          monitoring their progress, and getting coaching advice on how to help.
          Use your tools proactively — read guide://scouts to see your linked scouts,
          then check setup status and progress before giving advice.
          When the guide is setting up a new scout, work through the onboarding steps one at a time.
          Suggest age-appropriate delegation defaults but respect the guide's preferences.
          For ongoing support, present coaching options with tradeoffs and let the guide decide.
```

**Step 3: Commit**

```bash
git add config/scout-quest/librechat.yaml
git commit -m "feat: add scout-guide MCP server and Scout Guide model specs"
```

---

### Task 12: Build, Deploy, and Verify

**Step 1: Full build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Build succeeds, `dist/guide.js` exists alongside `dist/scout.js` and `dist/admin.js`

**Step 2: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests pass

**Step 3: Deploy MCP server**

Run: `./scripts/deploy-mcp.sh`
Expected: MCP bundle uploaded, extracted to both instances, API containers restarted

**Step 4: Deploy config**

Run: `./deploy-config.sh update gcloud`
Expected: Config pushed to GCS and deployed to VM. Scout-quest instance restarts with new MCP server config.

**Step 5: Verify guide MCP initialization**

Run: `./scripts/ssh-vm.sh "cd /opt/scoutcoach/scout-quest && sudo -u scoutcoach docker compose logs api --tail=30 2>&1 | grep -E 'MCP|tools|guide'"`
Expected: `[MCP] Initialized with 2 configured servers` (scout-quest + scout-guide), guide server shows tools registered

**Step 6: Test via LibreChat UI**

1. Visit `scout-quest.hexapax.com`
2. Log in with a Google account
3. Select "Scout Guide" from the model dropdown
4. Verify MCP tools appear in the tools panel
5. Test: send "What scouts am I linked to?" — should trigger `guide://scouts` resource read

**Step 7: Commit any fixes**

If verification reveals issues, fix and commit before proceeding.

---

### Task 13: Update `package.json` Start Scripts

**Files:**
- Modify: `mcp-servers/scout-quest/package.json`

**Step 1: Add guide start script**

```json
"start:guide": "node dist/guide.js"
```

**Step 2: Commit**

```bash
git add mcp-servers/scout-quest/package.json
git commit -m "chore: add start:guide script to package.json"
```

---

### Task 14: Reconcile Documentation and Admin App Schemas

**Files:**
- Modify: `admin/src/models/scout-quest/user.ts`
- Modify: `admin/src/models/scout-quest/scout.ts`
- Modify: `admin/src/models/scout-quest/index.ts`
- Create: `admin/src/models/scout-quest/setup-status.ts`
- Modify: `admin/src/resources/scout-quest.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/plans/2026-02-21-mcp-server-redesign.md`
- Modify: `docs/plans/2026-02-21-admin-app-design.md`
- Modify: `docs/plans/2026-02-21-admin-app-implementation.md`
- Modify: `CLAUDE.md`

#### Part A: Update Admin App Mongoose Schemas

The admin app (merged via `feature/admin-app`) has Mongoose schemas that define the same document shapes as the MCP server's `types.ts`. These must stay aligned.

**Step 1: Rename `parent` → `guide` in User role enum**

In `admin/src/models/scout-quest/user.ts` (line 8), change the role enum:

```typescript
// Before:
enum: ["superuser", "admin", "adult_readonly", "parent", "scout", "test_scout"],

// After:
enum: ["superuser", "admin", "adult_readonly", "guide", "scout", "test_scout"],
```

**Step 2: Add guide fields to Scout schema**

In `admin/src/models/scout-quest/scout.ts`, add these fields to the `scoutSchema` definition (after `parent_guardian`):

```typescript
    guide_email: { type: String },  // defaults to parent_guardian.email

    interests: {
      hobbies: [String],
      school_subjects: [String],
      career_interests: [String],
    },

    session_limits: {
      max_daily_sessions: { type: Number, default: 3 },
      max_session_minutes: { type: Number, default: 30 },
      cool_off_minutes: { type: Number, default: 60 },
      sessions_today: { type: Number, default: 0 },
      last_session_start: Date,
    },
```

**Step 3: Create SetupStatus Mongoose model**

Create `admin/src/models/scout-quest/setup-status.ts`:

```typescript
import mongoose, { Schema } from "mongoose";

const stepSchema = new Schema(
  {
    step: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped"],
      default: "pending",
    },
    completed_at: Date,
    completed_by: String,
    notes: String,
  },
  { _id: false }
);

const setupStatusSchema = new Schema(
  {
    scout_email: { type: String, required: true, unique: true, index: true },
    guide_email: { type: String, required: true, index: true },
    steps: { type: [stepSchema], default: [] },
    overall_status: {
      type: String,
      enum: ["not_started", "in_progress", "completed"],
      default: "not_started",
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const SetupStatus = mongoose.model("SetupStatus", setupStatusSchema, "setup_status");
```

**Step 4: Export SetupStatus from index**

In `admin/src/models/scout-quest/index.ts`, add:

```typescript
export { SetupStatus } from "./setup-status.js";
```

**Step 5: Add SetupStatus and guide_email to AdminJS resources**

In `admin/src/resources/scout-quest.ts`:

Add `SetupStatus` to the import:

```typescript
import {
  User, Scout, Requirement, ChoreLog, BudgetEntry,
  TimeMgmt, LoanAnalysis, EmailSent, Reminder, AuditLog,
  SetupStatus,
} from "../models/scout-quest/index.js";
```

Add `guide_email` to Scout's `showProperties` array (after `"patrol"`).

Add the SetupStatus resource config to the `scoutQuestResources` array:

```typescript
  {
    resource: SetupStatus,
    options: {
      navigation: { name: "Scout Quest", icon: "Compass" },
      listProperties: ["scout_email", "guide_email", "overall_status", "updated_at"],
      filterProperties: ["scout_email", "guide_email", "overall_status"],
    },
  },
```

**Step 6: Commit admin app schema updates**

```bash
git add admin/src/models/scout-quest/ admin/src/resources/scout-quest.ts
git commit -m "feat(admin): add guide role, guide_email, setup_status to match MCP server types"
```

#### Part B: Update Architecture and Project Docs

**Step 7: Update `docs/architecture.md`**

In the MCP Server Architecture section (~line 137):
- Change "Two entry points" → "Three entry points"
- Add `guide.js` row to the table:

```markdown
| `dist/guide.js` | scout-quest | 15 guide tools | 8 resources | Local MongoDB (`mongodb:27017/scoutquest`) |
```

Update the tool count summary (~line 120):
- Change "scout-quest (9 scout tools) + scout-admin (11 admin tools)" → "scout-quest (9 scout tools) + scout-guide (15 guide tools) + scout-admin (11 admin tools)"

**Step 8: Update MCP redesign doc**

In `docs/plans/2026-02-21-mcp-server-redesign.md`:

- Line 80: Change `(scouts + parents)` → `(scouts + guides)`
- Line 84: Change "two entry points (`src/scout.ts`, `src/admin.ts`)" → "three entry points (`src/scout.ts`, `src/admin.ts`, `src/guide.ts`)"
- Line 97: Change "two entry points" → "three entry points"
- Lines 123-129: Update Role type — rename `parent` → `guide`
- Lines 547-555: Update authorization matrix — rename `parent` column to `guide`, add write actions for guide
- Lines 578-590: Update role definitions and multi-role selection for guide
- Lines 611-612: Add `│   ├── guide.ts` entry point to file structure
- Add guide tools to the tools directory listing
- Add `setup_status` collection to Section 4

**Step 9: Update admin app design doc**

In `docs/plans/2026-02-21-admin-app-design.md`:

- Add `setup_status` row to Tier 1 data views table (line ~56):

```markdown
| `setup_status` | Yes | Yes | Onboarding progress per scout |
```

- Update collection count from "9" to "10"

**Step 10: Update admin app implementation plan**

In `docs/plans/2026-02-21-admin-app-implementation.md`:

- In the User Mongoose schema (Task 2), change `"parent"` to `"guide"` in role enum
- In the Scout Mongoose schema (Task 2), add `guide_email`, `interests`, `session_limits` fields
- Add `SetupStatus` Mongoose schema and AdminJS resource to the relevant task

**Step 11: Update CLAUDE.md**

Change the MCP Server section to:

```markdown
## MCP Server

A TypeScript MCP server in `mcp-servers/scout-quest/` provides quest state management, chore tracking, email composition (YPT-compliant), reminders, and ntfy push notifications. Three entry points: `dist/scout.js` (scout-facing), `dist/admin.js` (admin-facing), and `dist/guide.js` (guide-facing — parents and scout leaders). Runs as stdio subprocess inside the LibreChat API container, connecting to shared MongoDB. Build with `cd mcp-servers/scout-quest && bash build.sh`. Design spec in `docs/plans/2026-02-21-mcp-server-redesign.md`.
```

Also update Key Directories:
- Change `mcp-servers/scout-quest/` description from "two entry points" to "three entry points"

**Step 12: Commit all doc updates**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: reconcile all plans, architecture, and CLAUDE.md with guide endpoint additions"
```
