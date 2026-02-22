# Scout Quest MCP Server — Implementation Plan

> **Status:** IMPLEMENTED — MCP server is built and deployed. Further additions (memory redesign, guide endpoint) are in `2026-02-21-combined-implementation.md`.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Scout Quest MCP server from the approved redesign spec, delivering a working scout-facing and admin-facing MCP server connected to MongoDB.

**Architecture:** Single TypeScript codebase with two entry points (`dist/scout.js`, `dist/admin.js`). MCP Resources for reads, Tools for mutations. Role-based auth via `users` collection. Scout identity = Gmail email. Both servers share types, DB layer, and validation.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` v1.x (~1.26), MongoDB native driver (`mongodb` v6), Zod v3.25+, Node.js, vitest for testing.

**Design spec:** `docs/plans/2026-02-21-mcp-server-redesign.md`
**Character spec:** `docs/scout-quest-character.md`
**Requirements spec:** `docs/scout-quest-requirements.md`

---

## Dependency Graph

```
Task 1: Project scaffold + types + DB
    ↓
Task 2: Auth & validation
    ↓
Task 3: Admin tools (create/configure scouts)
    ↓
Task 4: Scout resources (read-only)
    ↓
Task 5: Scout tools — chores & budget
    ↓
Task 6: Scout tools — requirements, email, notifications
    ↓
Task 7: Scout tools — character, time mgmt, quest goal
    ↓
Task 8: Entry points + server instructions
    ↓
Task 9: Integration — LibreChat config, Docker, .env
```

Tasks 3-7 can partially parallelize once Task 2 is complete, but the plan is written sequentially for a single executor.

---

## Task 1: Project Scaffold, Types, and DB Connection

**Files:**
- Create: `mcp-servers/scout-quest/package.json`
- Create: `mcp-servers/scout-quest/tsconfig.json`
- Create: `mcp-servers/scout-quest/src/types.ts`
- Create: `mcp-servers/scout-quest/src/db.ts`
- Create: `mcp-servers/scout-quest/src/constants.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/db.test.ts`

### Step 1: Create package.json

```json
{
  "name": "scout-quest-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start:scout": "node dist/scout.js",
    "start:admin": "node dist/admin.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "mongodb": "^6.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "vitest": "^3.0.0"
  }
}
```

### Step 2: Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/__tests__/**/*"]
}
```

### Step 3: Create src/types.ts

Write all TypeScript interfaces from the design spec Section 4:
- `ContactInfo`
- `Role`, `UserDocument`
- `ScoutDocument` (with nested `quest_state`, `character`, `counselors`, `unit_leaders`, `blue_card`, `chore_list`, `budget_projected`)
- `RequirementDocument`, `RequirementStatus`, `InteractionMode`
- `ChoreLogEntry`
- `BudgetEntry`
- `TimeMgmtDocument`
- `LoanAnalysisDocument`
- `EmailRecord`
- `ReminderDocument`

Copy the exact interfaces from the design spec. Export all types.

**Reference:** `docs/plans/2026-02-21-mcp-server-redesign.md` Section 4.

### Step 4: Create src/db.ts

MongoDB connection singleton with collection accessors:

```typescript
import { MongoClient, Db, Collection } from "mongodb";
import type {
  UserDocument, ScoutDocument, RequirementDocument,
  ChoreLogEntry, BudgetEntry, TimeMgmtDocument,
  LoanAnalysisDocument, EmailRecord, ReminderDocument
} from "./types.js";

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/scoutquest";
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  return db;
}

export async function users(): Promise<Collection<UserDocument>> {
  return (await getDb()).collection("users");
}
export async function scouts(): Promise<Collection<ScoutDocument>> {
  return (await getDb()).collection("scouts");
}
export async function requirements(): Promise<Collection<RequirementDocument>> {
  return (await getDb()).collection("requirements");
}
export async function choreLogs(): Promise<Collection<ChoreLogEntry>> {
  return (await getDb()).collection("chore_logs");
}
export async function budgetEntries(): Promise<Collection<BudgetEntry>> {
  return (await getDb()).collection("budget_entries");
}
export async function timeMgmt(): Promise<Collection<TimeMgmtDocument>> {
  return (await getDb()).collection("time_mgmt");
}
export async function loanAnalysis(): Promise<Collection<LoanAnalysisDocument>> {
  return (await getDb()).collection("loan_analysis");
}
export async function emailsSent(): Promise<Collection<EmailRecord>> {
  return (await getDb()).collection("emails_sent");
}
export async function reminders(): Promise<Collection<ReminderDocument>> {
  return (await getDb()).collection("reminders");
}
```

### Step 5: Create src/constants.ts

Define the complete requirement registry — every PM and FL requirement with its ID, badge, default interaction mode, and whether it has tracking duration.

```typescript
export interface RequirementDefinition {
  req_id: string;
  badge: "personal_management" | "family_life";
  name: string;
  description: string;
  default_interaction_mode: string;
  tracking_duration?: { days?: number; weeks?: number };
  has_sub_requirements?: boolean;
}

export const REQUIREMENT_DEFINITIONS: RequirementDefinition[] = [
  // Personal Management
  { req_id: "pm_1a", badge: "personal_management", name: "Choose major expense", description: "Choose an item that your family might want to purchase that is considered a major expense.", default_interaction_mode: "email" },
  { req_id: "pm_1b", badge: "personal_management", name: "Savings plan", description: "Write a plan for how your family would save money for the purchase.", default_interaction_mode: "email", has_sub_requirements: true },
  { req_id: "pm_1c", badge: "personal_management", name: "Shopping strategy", description: "Develop a written shopping strategy with quality research and price comparison.", default_interaction_mode: "email", has_sub_requirements: true },
  { req_id: "pm_2a", badge: "personal_management", name: "Prepare budget", description: "Prepare a budget reflecting expected income, expenses, and savings for 13 weeks.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_2b", badge: "personal_management", name: "Compare income vs expenses", description: "Compare expected income with expected expenses.", default_interaction_mode: "email" },
  { req_id: "pm_2c", badge: "personal_management", name: "Track budget 13 weeks", description: "Track and record actual income, expenses, and savings for 13 consecutive weeks.", default_interaction_mode: "digital_submission", tracking_duration: { weeks: 13 } },
  { req_id: "pm_2d", badge: "personal_management", name: "Budget review", description: "Compare budget with actual and discuss what to do differently.", default_interaction_mode: "in_person" },
  { req_id: "pm_3", badge: "personal_management", name: "Money concepts discussion", description: "Discuss 5 of 8 money-related concepts with counselor.", default_interaction_mode: "in_person" },
  { req_id: "pm_4", badge: "personal_management", name: "Saving vs investing", description: "Explain saving vs investing, ROI, risk, interest, diversification, retirement.", default_interaction_mode: "in_person" },
  { req_id: "pm_5", badge: "personal_management", name: "Investment types", description: "Explain stocks, mutual funds, life insurance, CDs, savings accounts, US savings bonds.", default_interaction_mode: "email" },
  { req_id: "pm_6", badge: "personal_management", name: "Insurance types", description: "Explain auto, health, homeowner/renter, whole/term life insurance.", default_interaction_mode: "email" },
  { req_id: "pm_7", badge: "personal_management", name: "Loans and credit", description: "Explain loans, APR, borrowing methods, card types, credit reports, reducing debt.", default_interaction_mode: "email" },
  { req_id: "pm_8a", badge: "personal_management", name: "To-do list", description: "Write a prioritized to-do list for the coming week.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_8b", badge: "personal_management", name: "7-day schedule", description: "Make a seven-day calendar with set activities and planned tasks.", default_interaction_mode: "digital_submission" },
  { req_id: "pm_8c", badge: "personal_management", name: "Follow schedule + diary", description: "Follow the one-week schedule and keep a daily diary.", default_interaction_mode: "digital_submission", tracking_duration: { weeks: 1 } },
  { req_id: "pm_8d", badge: "personal_management", name: "Schedule review", description: "Review to-do list, schedule, and diary with counselor.", default_interaction_mode: "in_person" },
  { req_id: "pm_9", badge: "personal_management", name: "Project plan", description: "Prepare a written project plan with goal, timeline, description, resources, budget.", default_interaction_mode: "email" },
  { req_id: "pm_10", badge: "personal_management", name: "Career exploration", description: "Choose and discuss a career, qualifications, education, costs.", default_interaction_mode: "in_person" },

  // Family Life
  { req_id: "fl_1", badge: "family_life", name: "What is a family", description: "Prepare an outline on what a family is and discuss with counselor.", default_interaction_mode: "in_person" },
  { req_id: "fl_2", badge: "family_life", name: "Importance to family", description: "List reasons you are important to your family, discuss with parent and counselor.", default_interaction_mode: "in_person" },
  { req_id: "fl_3", badge: "family_life", name: "90-day chores", description: "Prepare list of 5+ chores, do them for 90 days, keep a record.", default_interaction_mode: "digital_submission", tracking_duration: { days: 90 } },
  { req_id: "fl_4", badge: "family_life", name: "Individual home project", description: "Decide on and carry out an individual project around the home.", default_interaction_mode: "parent_verify" },
  { req_id: "fl_5", badge: "family_life", name: "Family project", description: "Plan and carry out a project involving family participation.", default_interaction_mode: "in_person" },
  { req_id: "fl_6a", badge: "family_life", name: "Plan family meetings", description: "Discuss with counselor how to plan and carry out a family meeting.", default_interaction_mode: "in_person" },
  { req_id: "fl_6b", badge: "family_life", name: "Family meeting topics", description: "Prepare agenda covering 7 topics, review with parent, carry out meetings.", default_interaction_mode: "parent_verify", has_sub_requirements: true },
  { req_id: "fl_7", badge: "family_life", name: "Effective parenting", description: "Discuss understanding of effective parenting and parent's role.", default_interaction_mode: "in_person" },
];

// Valid state transitions for the requirement state machine
export const VALID_TRANSITIONS: Record<string, string[]> = {
  not_started: ["in_progress", "offered", "excluded", "completed_prior"],
  offered: ["in_progress", "not_started"],
  in_progress: ["tracking", "blocked", "ready_for_review", "needs_approval"],
  tracking: ["ready_for_review", "in_progress"],
  blocked: ["in_progress"],
  needs_approval: ["in_progress", "blocked"],
  ready_for_review: ["submitted", "in_progress"],
  submitted: ["signed_off", "needs_revision"],  // signed_off is admin-only
  needs_revision: ["in_progress"],
  // Terminal states — no transitions out:
  signed_off: [],
  completed_prior: [],
  excluded: ["in_progress"],  // SM/ASM can un-exclude
};

// Chore streak milestones that trigger celebrations
export const STREAK_MILESTONES = [7, 14, 30, 45, 60, 75, 90];

// Budget tracking milestones
export const BUDGET_MILESTONES = [4, 8, 13];
```

### Step 6: Write DB connection test

```typescript
// src/__tests__/db.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoClient } from "mongodb";
import { getDb } from "../db.js";

// These tests require a running MongoDB instance.
// Set MONGO_URI=mongodb://localhost:27017/scoutquest_test before running.
// Skip in CI if no MongoDB available.

describe("db connection", () => {
  it("connects to MongoDB and returns a Db instance", async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    expect(db.databaseName).toBe("scoutquest_test");
  });
});
```

### Step 7: Install dependencies and verify build

Run:
```bash
cd mcp-servers/scout-quest && npm install
```
Expected: Clean install, `node_modules` created.

Run:
```bash
cd mcp-servers/scout-quest && npx tsc --noEmit
```
Expected: No type errors.

### Step 8: Commit

```bash
git add mcp-servers/scout-quest/package.json mcp-servers/scout-quest/tsconfig.json \
  mcp-servers/scout-quest/src/types.ts mcp-servers/scout-quest/src/db.ts \
  mcp-servers/scout-quest/src/constants.ts mcp-servers/scout-quest/src/__tests__/db.test.ts
git commit -m "feat: scaffold MCP server with types, DB connection, and constants"
```

**Note:** Add `mcp-servers/scout-quest/node_modules/` and `mcp-servers/scout-quest/dist/` to `.gitignore`.

---

## Task 2: Auth & Validation

**Files:**
- Create: `mcp-servers/scout-quest/src/auth.ts`
- Create: `mcp-servers/scout-quest/src/validation.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/auth.test.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/validation.test.ts`

### Step 1: Write auth tests

```typescript
// src/__tests__/auth.test.ts
import { describe, it, expect } from "vitest";
import { canAccess, getEffectiveRole } from "../auth.js";
import type { Role } from "../types.js";

describe("canAccess", () => {
  it("superuser can access anything", () => {
    const roles: Role[] = [{ type: "superuser" }];
    expect(canAccess(roles, "create_scout", {})).toBe(true);
    expect(canAccess(roles, "sign_off_requirement", {})).toBe(true);
    expect(canAccess(roles, "log_chore", { scout_email: "anyone@test.com" })).toBe(true);
  });

  it("admin can access own troop", () => {
    const roles: Role[] = [{ type: "admin", troop: "2024" }];
    expect(canAccess(roles, "create_scout", { troop: "2024" })).toBe(true);
    expect(canAccess(roles, "create_scout", { troop: "9999" })).toBe(false);
  });

  it("scout can only access own data", () => {
    const roles: Role[] = [{ type: "scout" }];
    expect(canAccess(roles, "log_chore", { scout_email: "will@test.com", user_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "log_chore", { scout_email: "other@test.com", user_email: "will@test.com" })).toBe(false);
  });

  it("adult_readonly cannot write", () => {
    const roles: Role[] = [{ type: "adult_readonly", troop: "2024" }];
    expect(canAccess(roles, "view_scout", { troop: "2024" })).toBe(true);
    expect(canAccess(roles, "create_scout", { troop: "2024" })).toBe(false);
  });

  it("parent can view own kids only", () => {
    const roles: Role[] = [{ type: "parent", scout_emails: ["will@test.com"] }];
    expect(canAccess(roles, "view_scout", { scout_email: "will@test.com" })).toBe(true);
    expect(canAccess(roles, "view_scout", { scout_email: "other@test.com" })).toBe(false);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/auth.test.ts`
Expected: FAIL — `auth.js` does not exist.

### Step 3: Implement auth.ts

```typescript
// src/auth.ts
import { users } from "./db.js";
import type { Role, UserDocument } from "./types.js";

// Actions that require specific roles
const ADMIN_WRITE_ACTIONS = [
  "create_scout", "configure_quest", "set_character", "set_counselors",
  "set_unit_leaders", "initialize_requirements", "override_requirement",
  "sign_off_requirement", "set_chore_list", "set_projected_budget",
  "approve_blue_card"
];

const SCOUT_ACTIONS = [
  "log_chore", "log_budget_entry", "advance_requirement", "compose_email",
  "log_diary_entry", "send_notification", "adjust_tone", "setup_time_mgmt",
  "update_quest_goal"
];

const READ_ACTIONS = ["view_scout", "view_requirements", "view_streak", "view_budget"];

export async function getUserRoles(email: string): Promise<Role[]> {
  const col = await users();
  const user = await col.findOne({ email });
  return user?.roles ?? [];
}

export function canAccess(
  roles: Role[],
  action: string,
  context: { troop?: string; scout_email?: string; user_email?: string }
): boolean {
  for (const role of roles) {
    if (role.type === "superuser") return true;

    if (role.type === "admin") {
      if (ADMIN_WRITE_ACTIONS.includes(action) || READ_ACTIONS.includes(action)) {
        if (!context.troop || context.troop === role.troop) return true;
      }
    }

    if (role.type === "adult_readonly") {
      if (READ_ACTIONS.includes(action)) {
        if (!context.troop || context.troop === role.troop) return true;
      }
    }

    if (role.type === "parent") {
      if (READ_ACTIONS.includes(action)) {
        if (context.scout_email && role.scout_emails.includes(context.scout_email)) return true;
      }
    }

    if (role.type === "scout" || role.type === "test_scout") {
      if (SCOUT_ACTIONS.includes(action) || READ_ACTIONS.includes(action)) {
        if (context.scout_email === context.user_email) return true;
      }
    }
  }
  return false;
}
```

### Step 4: Run auth tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/auth.test.ts`
Expected: PASS

### Step 5: Write validation tests

```typescript
// src/__tests__/validation.test.ts
import { describe, it, expect } from "vitest";
import { isValidTransition, validateCurrency, validateChoreBackdate } from "../validation.js";

describe("isValidTransition", () => {
  it("allows not_started → in_progress", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
  });
  it("blocks in_progress → signed_off (must go through submitted)", () => {
    expect(isValidTransition("in_progress", "signed_off")).toBe(false);
  });
  it("blocks signed_off → anything (terminal)", () => {
    expect(isValidTransition("signed_off", "in_progress")).toBe(false);
  });
  it("allows submitted → needs_revision", () => {
    expect(isValidTransition("submitted", "needs_revision")).toBe(true);
  });
});

describe("validateCurrency", () => {
  it("rejects negative values", () => {
    expect(validateCurrency(-5)).toBe(false);
  });
  it("accepts zero", () => {
    expect(validateCurrency(0)).toBe(true);
  });
  it("accepts positive", () => {
    expect(validateCurrency(15.50)).toBe(true);
  });
});

describe("validateChoreBackdate", () => {
  it("allows today", () => {
    expect(validateChoreBackdate(new Date())).toBe(true);
  });
  it("allows 2 days ago", () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    expect(validateChoreBackdate(twoDaysAgo)).toBe(true);
  });
  it("rejects 4 days ago", () => {
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    expect(validateChoreBackdate(fourDaysAgo)).toBe(false);
  });
});
```

### Step 6: Run validation tests to verify they fail

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/validation.test.ts`
Expected: FAIL

### Step 7: Implement validation.ts

```typescript
// src/validation.ts
import { VALID_TRANSITIONS } from "./constants.js";
import type { RequirementStatus } from "./types.js";

export function isValidTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function validateCurrency(amount: number): boolean {
  return amount >= 0;
}

export function validateChoreBackdate(date: Date): boolean {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

export function enforceYptCc(cc: string[], parentEmail: string): string[] {
  if (!cc.includes(parentEmail)) {
    return [...cc, parentEmail];
  }
  return cc;
}

export function validateToneDial(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
```

### Step 8: Run validation tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/validation.test.ts`
Expected: PASS

### Step 9: Verify full build

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No type errors.

### Step 10: Commit

```bash
git add mcp-servers/scout-quest/src/auth.ts mcp-servers/scout-quest/src/validation.ts \
  mcp-servers/scout-quest/src/__tests__/auth.test.ts mcp-servers/scout-quest/src/__tests__/validation.test.ts
git commit -m "feat: add auth (role-based access) and validation (state machine, YPT, currency)"
```

---

## Task 3: Admin Tools

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/admin/createScout.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/configureQuest.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/setCharacter.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/setCounselors.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/setUnitLeaders.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/initializeRequirements.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/overrideRequirement.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/signOffRequirement.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/setChoreList.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/setProjectedBudget.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/approveBlueCard.ts`
- Create: `mcp-servers/scout-quest/src/tools/admin/index.ts` (barrel export + registration)
- Test: `mcp-servers/scout-quest/src/__tests__/admin-tools.test.ts`

**Approach:** Each admin tool is a function that takes a `McpServer` instance and registers itself. The barrel `index.ts` calls all registrations. Tests use a real MongoDB test database.

### Step 1: Write tests for createScout and configureQuest

Write integration tests that:
1. Call the tool handler directly (not via MCP transport)
2. Verify the MongoDB document was created correctly
3. Verify duplicate email is rejected
4. Verify configureQuest updates the right fields

Use a `beforeEach` that drops the test database collections.

### Step 2: Run tests to verify they fail

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/admin-tools.test.ts`
Expected: FAIL

### Step 3: Implement createScout.ts

The tool:
1. Accepts: `email`, `name`, `age`, `troop`, `patrol?`, `parent_guardian` (name + email)
2. Checks if email already exists → error if so
3. Creates user document with `scout` role
4. Creates scout document with empty defaults for quest_state, character, counselors, etc.
5. Returns confirmation message

Use Zod for input schema:
```typescript
inputSchema: {
  email: z.string().email(),
  name: z.string(),
  age: z.number().int().min(10).max(18),
  troop: z.string(),
  patrol: z.string().optional(),
  parent_name: z.string(),
  parent_email: z.string().email(),
}
```

### Step 4: Implement remaining admin tools

Each tool follows the same pattern:
1. Zod input schema
2. Look up scout by `scout_email`
3. Validate inputs
4. Update MongoDB
5. Return confirmation

Key implementation notes per tool:

- **configureQuest**: Sets `quest_state` fields. Auto-calculates `loan_path_active` from `target_budget > savings_capacity`.
- **setCharacter**: Sets all `character` fields. Validates dial values are within 1-5 range.
- **setCounselors**: Updates `counselors.personal_management` or `counselors.family_life` based on `badge` param.
- **setUnitLeaders**: Updates `unit_leaders.scoutmaster` and optional `asm`.
- **initializeRequirements**: Bulk-inserts requirement documents for all PM and FL requirements. Uses `REQUIREMENT_DEFINITIONS` from constants. Each req gets status, quest_driven, and interaction_mode from the input array.
- **overrideRequirement**: Updates a requirement's status with a `reason` field. Does NOT enforce normal state transitions (SM/ASM can set any status).
- **signOffRequirement**: Sets status to `signed_off`, records `signed_off_by` and `signed_off_date`. Validates requirement was in `submitted` status.
- **setChoreList**: Updates `chore_list` array on the scout document. Validates at least 5 chores.
- **setProjectedBudget**: Sets `budget_projected` with income sources, expense categories, savings target.
- **approveBlueCard**: Sets `blue_card.{badge}.approved_date` and `approved_by`.

### Step 5: Create barrel index.ts

```typescript
// src/tools/admin/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateScout } from "./createScout.js";
import { registerConfigureQuest } from "./configureQuest.js";
// ... import all others

export function registerAdminTools(server: McpServer): void {
  registerCreateScout(server);
  registerConfigureQuest(server);
  // ... register all others
}
```

### Step 6: Run tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/admin-tools.test.ts`
Expected: PASS

### Step 7: Verify build

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No type errors.

### Step 8: Commit

```bash
git add mcp-servers/scout-quest/src/tools/admin/
git add mcp-servers/scout-quest/src/__tests__/admin-tools.test.ts
git commit -m "feat: add admin tools (create/configure/manage scouts and requirements)"
```

---

## Task 4: Scout Resources

**Files:**
- Create: `mcp-servers/scout-quest/src/resources/questState.ts`
- Create: `mcp-servers/scout-quest/src/resources/requirements.ts`
- Create: `mcp-servers/scout-quest/src/resources/choreStreak.ts`
- Create: `mcp-servers/scout-quest/src/resources/budgetSummary.ts`
- Create: `mcp-servers/scout-quest/src/resources/character.ts`
- Create: `mcp-servers/scout-quest/src/resources/reminders.ts`
- Create: `mcp-servers/scout-quest/src/resources/questSummary.ts`
- Create: `mcp-servers/scout-quest/src/resources/adminScouts.ts`
- Create: `mcp-servers/scout-quest/src/resources/index.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/resources.test.ts`

### Step 1: Write tests for questState and choreStreak resources

Tests should:
1. Insert a test scout + chore log entries into test DB
2. Call the resource handler
3. Verify the returned JSON structure matches expected shape
4. Verify computed fields (days_since_start, budget_remaining, streak calculation)

### Step 2: Run tests to verify they fail

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/resources.test.ts`
Expected: FAIL

### Step 3: Implement resources

Each resource is a function that takes a `McpServer` and calls `server.registerResource()`.

**questState.ts** — `scout://quest-state`:
- Query `scouts` by email
- Return full scout document (minus `_id`)
- Add computed: `days_since_start`, `budget_remaining`, `next_unlock` (if hardware goal)

**requirements.ts** — `scout://requirements` and `scout://requirements/{req_id}`:
- Static URI for all requirements
- ResourceTemplate URI for single requirement
- Query `requirements` collection filtered by `scout_email`

**choreStreak.ts** — `scout://chore-streak`:
- Query `chore_logs` sorted by date desc
- Calculate current streak (consecutive days with entries)
- Calculate longest streak
- Sum total earned
- Check if today's entry exists
- Calculate days remaining for FL Req 3 (90 - tracking_progress)

**budgetSummary.ts** — `scout://budget-summary`:
- Query `budget_entries` for the scout
- Query scout's `budget_projected`
- Calculate projected vs actual totals
- Calculate savings progress toward goal

**character.ts** — `scout://character`:
- Return the `character` sub-document from the scout record

**reminders.ts** — `scout://reminders`:
- Check: did scout log chores today? If not → reminder
- Check: is PM Req 8 diary active and no entry today? → reminder
- Check: is budget week behind? → reminder
- Check: chore streak at risk? → reminder
- Check: loot drop available? → celebration
- Return array of `{ type, message, urgency }` objects

**questSummary.ts** — `scout://quest-summary`:
- Build gamified status string combining data from quest state, requirements, chore streak, budget
- Format matching the example in the original design spec

**adminScouts.ts** — `admin://scouts` and `admin://scouts/{email}`:
- List all scouts (filtered by admin's troop via auth)
- Single scout detail with requirements and latest tracking

### Step 4: Create barrel index.ts

```typescript
export function registerScoutResources(server: McpServer, scoutEmail: string): void { ... }
export function registerAdminResources(server: McpServer): void { ... }
```

### Step 5: Run tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/resources.test.ts`
Expected: PASS

### Step 6: Commit

```bash
git add mcp-servers/scout-quest/src/resources/
git add mcp-servers/scout-quest/src/__tests__/resources.test.ts
git commit -m "feat: add MCP resources (quest state, requirements, streaks, budget, character)"
```

---

## Task 5: Scout Tools — Chores & Budget

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/scout/logChore.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/logBudgetEntry.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/scout-tools-tracking.test.ts`

### Step 1: Write tests for logChore

Test cases:
1. Log chores for today → creates entry, returns streak info
2. Log chores with income → updates `current_savings` on scout doc
3. Log consecutive days → streak increments
4. Gap in days → streak resets to 1
5. Hit streak milestone (7 days) → response includes celebration
6. Back-date more than 3 days → rejected
7. Updates FL Req 3 tracking_progress

### Step 2: Run tests to verify they fail

### Step 3: Implement logChore.ts

```typescript
inputSchema: {
  chores_completed: z.array(z.string()).min(1),
  notes: z.string().optional(),
  date: z.string().date().optional(),  // ISO date, defaults to today
}
```

Handler:
1. Resolve scout email from context
2. Validate date (if provided) is not > 3 days ago
3. Insert into `chore_logs`
4. Calculate income from completed chores (look up `chore_list` on scout doc)
5. Update `scout.quest_state.current_savings` += income
6. Calculate streak: query last N chore log entries, find consecutive days
7. Update FL Req 3 `tracking_progress` if requirement is in `tracking` status
8. Check for streak milestones
9. Return: streak info, income earned, total savings, milestone celebration if applicable

### Step 4: Write tests for logBudgetEntry

Test cases:
1. Log week 1 entry → creates entry with correct totals
2. Duplicate week number → rejected
3. Running savings total calculated correctly
4. Updates PM Req 2c tracking_progress

### Step 5: Implement logBudgetEntry.ts

```typescript
inputSchema: {
  week_number: z.number().int().min(1).max(13),
  income: z.array(z.object({ source: z.string(), amount: z.number().min(0) })),
  expenses: z.array(z.object({ category: z.string(), amount: z.number().min(0), description: z.string() })),
  savings_deposited: z.number().min(0),
  notes: z.string().optional(),
}
```

### Step 6: Run all tracking tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scout-tools-tracking.test.ts`
Expected: PASS

### Step 7: Commit

```bash
git add mcp-servers/scout-quest/src/tools/scout/logChore.ts \
  mcp-servers/scout-quest/src/tools/scout/logBudgetEntry.ts \
  mcp-servers/scout-quest/src/__tests__/scout-tools-tracking.test.ts
git commit -m "feat: add log_chore and log_budget_entry tools with streak tracking"
```

---

## Task 6: Scout Tools — Requirements, Email, Notifications

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/scout/advanceRequirement.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/composeEmail.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/sendNotification.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/scout-tools-core.test.ts`

### Step 1: Write tests for advanceRequirement

Test cases:
1. Valid transition (not_started → in_progress) → succeeds
2. Invalid transition (in_progress → signed_off) → rejected with error
3. Scout cannot set `signed_off` status → rejected
4. Attach a document deliverable → stored correctly
5. Notes are recorded

### Step 2: Implement advanceRequirement.ts

```typescript
inputSchema: {
  req_id: z.string(),
  new_status: z.string(),
  notes: z.string().optional(),
  document: z.object({
    name: z.string(),
    content: z.string(),
  }).optional(),
}
```

Handler:
1. Look up requirement by `scout_email` + `req_id`
2. Validate transition using `isValidTransition()`
3. Block `signed_off` status (scout tools can't set this)
4. Update status, set `updated_at`
5. If document provided, append to `documents` array
6. If transitioning to `tracking`, set `tracking_start_date`
7. Return confirmation with new status

### Step 3: Write tests for composeEmail

Test cases:
1. Basic email → generates mailto: link with correct encoding
2. YPT enforcement → parent email ALWAYS in CC even if not provided
3. Logs email in `emails_sent` collection
4. URL-encodes special characters in subject/body

### Step 4: Implement composeEmail.ts

```typescript
inputSchema: {
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  context: z.string(),
}
```

Handler:
1. Resolve scout, get `parent_guardian.email`
2. Build CC list, enforce YPT: always include parent email
3. URL-encode all fields
4. Build `mailto:${to}?cc=${cc}&subject=${subject}&body=${body}`
5. Insert record into `emails_sent`
6. Return: mailto link, human-readable preview, YPT reminder

### Step 5: Implement sendNotification.ts

```typescript
inputSchema: {
  message: z.string(),
  title: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
}
```

Handler:
1. Read `NTFY_TOPIC` from env
2. If not set, return error
3. POST to `https://ntfy.sh/${topic}` with JSON body
4. Return confirmation or error

### Step 6: Run tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scout-tools-core.test.ts`
Expected: PASS

### Step 7: Commit

```bash
git add mcp-servers/scout-quest/src/tools/scout/advanceRequirement.ts \
  mcp-servers/scout-quest/src/tools/scout/composeEmail.ts \
  mcp-servers/scout-quest/src/tools/scout/sendNotification.ts \
  mcp-servers/scout-quest/src/__tests__/scout-tools-core.test.ts
git commit -m "feat: add advance_requirement, compose_email, send_notification tools"
```

---

## Task 7: Scout Tools — Character, Time Mgmt, Quest Goal

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/scout/adjustTone.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/setupTimeMgmt.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/updateQuestGoal.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/logDiaryEntry.ts`
- Create: `mcp-servers/scout-quest/src/tools/scout/index.ts`
- Test: `mcp-servers/scout-quest/src/__tests__/scout-tools-misc.test.ts`

### Step 1: Write tests for adjustTone

Test cases:
1. Adjust tone_dial within bounds → succeeds, returns new value
2. Attempt to exceed tone_max → clamped to max
3. Attempt below tone_min → clamped to min
4. Reason is logged

### Step 2: Implement adjustTone.ts

```typescript
inputSchema: {
  tone_dial: z.number().int().min(1).max(5).optional(),
  domain_intensity: z.number().int().min(1).max(5).optional(),
  reason: z.string(),
}
```

Handler:
1. Load scout's character config
2. Clamp values using `validateToneDial(value, min, max)`
3. Update character fields on scout document
4. Return new dial values and confirmation

### Step 3: Implement setupTimeMgmt.ts

```typescript
inputSchema: {
  todo_list: z.array(z.object({
    item: z.string(),
    priority: z.number().int(),
    category: z.string(),
  })),
  weekly_schedule: z.array(z.object({
    day: z.string(),
    fixed_activities: z.array(z.object({ time: z.string(), activity: z.string() })),
    planned_tasks: z.array(z.object({ time: z.string(), todo_item: z.string() })),
  })),
}
```

Handler:
1. Create `time_mgmt` document
2. Set `exercise_week_start` to today
3. Advance PM Req 8a and 8b to appropriate states
4. Return confirmation

### Step 4: Implement logDiaryEntry.ts

```typescript
inputSchema: {
  day: z.string(),
  entries: z.array(z.object({
    scheduled_time: z.string(),
    actual_time: z.string(),
    task: z.string(),
    completed: z.boolean(),
    notes: z.string().optional(),
  })),
}
```

Handler:
1. Find `time_mgmt` document for scout
2. Append to `daily_diary` array
3. Update PM Req 8c tracking_progress
4. Return confirmation

### Step 5: Implement updateQuestGoal.ts

```typescript
inputSchema: {
  goal_item: z.string().optional(),
  goal_description: z.string().optional(),
  target_budget: z.number().min(0).optional(),
}
```

Handler:
1. Update `quest_state` fields on scout document
2. Recalculate `loan_path_active` if target_budget changed
3. Return confirmation with note about requirement re-mapping

### Step 6: Create barrel index.ts for scout tools

```typescript
export function registerScoutTools(server: McpServer, scoutEmail: string): void { ... }
```

### Step 7: Run tests

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scout-tools-misc.test.ts`
Expected: PASS

### Step 8: Commit

```bash
git add mcp-servers/scout-quest/src/tools/scout/
git add mcp-servers/scout-quest/src/__tests__/scout-tools-misc.test.ts
git commit -m "feat: add adjust_tone, setup_time_mgmt, log_diary_entry, update_quest_goal tools"
```

---

## Task 8: Entry Points + Server Instructions

**Files:**
- Create: `mcp-servers/scout-quest/src/scout.ts`
- Create: `mcp-servers/scout-quest/src/admin.ts`
- Create: `mcp-servers/scout-quest/build.sh`

### Step 1: Implement scout.ts (scout-facing entry point)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getUserRoles } from "./auth.js";
import { registerScoutResources } from "./resources/index.js";
import { registerScoutTools } from "./tools/scout/index.js";

const server = new McpServer(
  { name: "scout-quest", version: "1.0.0" },
  { capabilities: { logging: {} } }
);

// Resolve scout identity
const scoutEmail = process.env.SCOUT_EMAIL || "";

// Check roles — only register tools/resources appropriate for the user
const roles = await getUserRoles(scoutEmail);
// Register resources and tools based on role
// Scout gets full tools + resources
// Parent gets read-only resources
registerScoutResources(server, scoutEmail);

const isScout = roles.some(r => r.type === "scout" || r.type === "test_scout" || r.type === "superuser");
if (isScout) {
  registerScoutTools(server, scoutEmail);
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Step 2: Implement admin.ts (admin-facing entry point)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getUserRoles } from "./auth.js";
import { registerAdminResources } from "./resources/index.js";
import { registerAdminTools } from "./tools/admin/index.js";

const server = new McpServer(
  { name: "scout-admin", version: "1.0.0" },
  { capabilities: { logging: {} } }
);

const adminEmail = process.env.ADMIN_EMAIL || "";
const roles = await getUserRoles(adminEmail);

registerAdminResources(server);

const canWrite = roles.some(r => r.type === "superuser" || r.type === "admin");
if (canWrite) {
  registerAdminTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Step 3: Add server instructions

The server instructions (from design spec Section 11) should be returned to the AI via the MCP server's capabilities. Check if `McpServer` supports `serverInstructions` in v1.x.

If `serverInstructions` is not a built-in SDK feature, provide them as a static resource:
- `scout://instructions` — returns the scout-facing instructions text
- `admin://instructions` — returns the admin-facing instructions text

The LibreChat `serverInstructions: true` config tells LibreChat to read and inject these.

### Step 4: Create build.sh

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install
npx tsc
echo "Build complete. Outputs in dist/"
```

### Step 5: Build and verify

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: Clean build, `dist/scout.js` and `dist/admin.js` exist.

Run: `ls mcp-servers/scout-quest/dist/scout.js mcp-servers/scout-quest/dist/admin.js`
Expected: Both files exist.

### Step 6: Commit

```bash
git add mcp-servers/scout-quest/src/scout.ts mcp-servers/scout-quest/src/admin.ts \
  mcp-servers/scout-quest/build.sh
git commit -m "feat: add scout and admin entry points with role-based tool registration"
```

---

## Task 9: Integration — LibreChat Config, Docker, .env

**Files:**
- Modify: `config/scout-quest/librechat.yaml` (uncomment and update MCP section)
- Modify: `config/scout-quest/.env.example` (fix DB name)
- Modify: `config/scout-quest/docker-compose.override.yml` (shared network)
- Modify: `config/ai-chat/docker-compose.override.yml` (add MCP mount + shared network)
- Modify: `config/ai-chat/librechat.yaml` (add scout-admin MCP section)
- Modify: `.gitignore` (add node_modules, dist)

### Step 1: Update .gitignore

Add:
```
mcp-servers/scout-quest/node_modules/
mcp-servers/scout-quest/dist/
```

### Step 2: Fix .env.example DB name

In `config/scout-quest/.env.example`, change line 67:
```
MONGO_URI=mongodb://mongodb:27017/scoutquest
```

### Step 3: Uncomment MCP config in scout-quest librechat.yaml

Replace the commented-out `mcpServers` block (lines 63-77) with the active config from the design spec.

### Step 4: Add MCP config to ai-chat librechat.yaml

Add the `mcpServers.scout-admin` section. The MONGO_URI should point to the scout-quest MongoDB via the shared Docker network:
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
```

### Step 5: Update docker-compose.override.yml files

**Scout-quest** — add shared network:
```yaml
networks:
  scout-shared:
    external: true
    name: scout-shared
```

Add `networks: [default, scout-shared]` to the `mongodb` service.

**Ai-chat** — add MCP mount and shared network:
```yaml
services:
  api:
    volumes:
      - type: bind
        source: ./mcp-servers
        target: /app/mcp-servers
    networks:
      - default
      - scout-shared
networks:
  scout-shared:
    external: true
    name: scout-shared
```

### Step 6: Update deploy-config.sh (if needed)

Verify that `deploy-config.sh` copies the `mcp-servers/` directory to the VM during deployment. If not, add it to the deploy flow.

### Step 7: Run full test suite

Run: `cd mcp-servers/scout-quest && npm test`
Expected: All tests pass.

### Step 8: Build final

Run: `cd mcp-servers/scout-quest && npm run build`
Expected: Clean build.

### Step 9: Commit

```bash
git add config/ .gitignore mcp-servers/scout-quest/
git commit -m "feat: integrate MCP server with LibreChat config, Docker networking, and deployment"
```

---

## Post-Implementation Verification

After all tasks are complete, use **superpowers:verification-before-completion** to:

1. Run the full test suite: `cd mcp-servers/scout-quest && npm test`
2. Build both entry points: `npm run build`
3. Verify `dist/scout.js` and `dist/admin.js` exist and are syntactically valid
4. Check TypeScript: `npx tsc --noEmit`
5. Verify `.gitignore` excludes `node_modules/` and `dist/`
6. Verify `librechat.yaml` MCP config is syntactically valid YAML
7. Verify `.env.example` uses `scoutquest` (lowercase)
8. Review all tool input schemas have proper Zod validation
9. Review all tools that compose emails enforce YPT CC
10. Review `advance_requirement` blocks `signed_off` for scout role

---

## Deployment Checklist (on VM)

After code is deployed:

1. SSH to VM: `gcloud compute ssh scoutcoach@scout-coach-vm --zone=us-east4-b`
2. Create shared Docker network: `docker network create scout-shared`
3. Build MCP server: `cd /opt/scoutcoach/scout-quest/mcp-servers/scout-quest && bash build.sh`
4. Restart scout-quest: `cd /opt/scoutcoach/scout-quest && docker compose up -d`
5. Restart ai-chat: `cd /opt/scoutcoach/ai-chat && docker compose up -d`
6. Check logs: `docker compose logs api -f` (both instances)
7. In scout-quest LibreChat UI: verify MCP tools appear in agent configuration
8. In ai-chat LibreChat UI: verify admin MCP tools appear
9. Create Jeremy's user document in MongoDB with `superuser` role
10. Create a test scout via admin tools
11. Log in as test scout, verify quest state loads
12. Test: log a chore, verify streak
13. Test: compose an email, verify YPT CC
14. Test: advance a requirement, verify state machine
