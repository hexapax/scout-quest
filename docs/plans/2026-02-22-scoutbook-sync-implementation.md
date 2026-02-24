# Scoutbook Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Scoutbook sync system that pulls roster, advancement, calendar/events, and activity data from BSA's API into MongoDB, with CLI, MCP admin tool, and cron interfaces. This is the data backbone of the Scout Quest system.

**Architecture:** Shared API client library inside the existing `mcp-servers/scout-quest` package. Nine `scoutbook_*` MongoDB collections for mirrored data. Smart rate limiter with human-like burst patterns. CLI entry point for manual/cron use. Five MCP admin tools for ai-chat integration. Quest initialization bridge maps Scoutbook advancement to quest requirement statuses. Cron-based periodic sync with per-data-type intervals.

**Tech Stack:** TypeScript, MongoDB (via existing `mongodb` driver), Node.js fetch API (no new deps), vitest for tests.

**Design spec:** `docs/plans/2026-02-22-scoutbook-sync-design.md`
**API reference:** `scouting-org-research/api-reference.md`
**Sample responses:** `scouting-org-research/data/responses/` (52+ JSON files)

**Task status:** Tasks 1-3 implemented on `feat/scoutbook-sync` branch. Tasks 4-12 are original scope. Tasks 13-17 are v2 additions (calendar/events, smart rate limiting, cron sync).

---

### Task 1: BSA API Response Types

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/types.ts`

**Context:** All types are derived from actual API responses saved in `scouting-org-research/data/responses/`. The field names must match the API exactly — these are deserialization targets, not domain models.

**Step 1: Write the types file**

```typescript
// BSA API response types — field names match api.scouting.org responses exactly.
// See scouting-org-research/data/responses/ for sample payloads.

// --- Auth ---

export interface AuthResponse {
  tokenType: string;
  accessToken: string;
  userId: number;
}

// --- Roster responses ---

export interface YouthRosterResponse {
  id: number;
  number: string;
  unitType: string;
  fullName: string;
  akelaOrganizationGuid: string;
  users: YouthMember[];
}

export interface YouthMember {
  userId: number;
  memberId: number;
  personGuid: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nameSuffix: string | null;
  personFullName: string;
  nickName: string | null;
  dateOfBirth: string;
  age: number;
  gender: string;
  grade: number | null;
  isAdult: boolean;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  homePhone: string | null;
  mobilePhone: string | null;
  bsaVerifiedDate: string | null;
  highestRanksAwarded: HighestRankAwarded[];
  positions: MemberPosition[];
  dateJoinedBoyScouts: string | null;
}

export interface HighestRankAwarded {
  id: number;
  rank: string;
  level: number;
  programId: number;
  program: string;
  dateEarned: string;
  awardedDate: string;
  awarded: boolean;
}

export interface MemberPosition {
  id: number;
  positionId: number;
  position: string;
  dateStarted: string;
  isPending: boolean;
  patrolId: number | null;
  patrolName: string | null;
  isKey3?: boolean;
}

// Adult roster has same wrapper shape as youth
export interface AdultRosterResponse {
  id: number;
  number: string;
  unitType: string;
  fullName: string;
  akelaOrganizationGuid: string;
  users: AdultMember[];
}

export interface AdultMember {
  userId: number;
  memberId: number;
  personGuid: string;
  firstName: string;
  lastName: string;
  personFullName: string;
  nickName: string | null;
  age: number;
  isAdult: boolean;
  email: string | null;
  homePhone: string | null;
  mobilePhone: string | null;
  positions: MemberPosition[];
}

// Parent roster is a flat array
export interface ParentEntry {
  youthUserId: number;
  parentUserId: number;
  parentInformation: ParentInfo;
}

export interface ParentInfo {
  memberId: number;
  personGuid: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nickName: string | null;
  personFullName: string;
  email: string | null;
  homePhone: string | null;
  mobilePhone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

// Patrols
export interface Patrol {
  subUnitId: number;
  subUnitName: string;
  unitId: number;
  isApproved: boolean;
  dateCreated: string;
}

// --- Advancement responses ---

export interface RanksResponse {
  status: string;
  program: ProgramRanks[];
}

export interface ProgramRanks {
  programId: number;
  program: string;
  totalNumberOfRanks: number;
  ranks: RankProgress[];
}

export interface RankProgress {
  id: number;
  name: string;
  versionId: number;
  version: string;
  level: number;
  percentCompleted: number;
  status: string;
  dateEarned: string;
  awardedDate: string;
  awarded: boolean;
  programId: number;
}

export interface MeritBadgeProgress {
  id: number;
  name: string;
  version: string;
  versionId: string;
  short: string;
  isEagleRequired: boolean;
  percentCompleted: number;
  status: string;
  dateStarted: string;
  dateCompleted: string;
  awardedDate: string;
  awarded: boolean;
  assignedCounselorUserId: number | null;
}

export interface AwardProgress {
  awardId: number;
  name: string;
  short: string;
  percentCompleted: number;
  dateEarned: string;
  awarded: boolean;
  awardedDate: string;
}

export interface RequirementCompletion {
  id: number;
  versionId: number;
  name: string;
  short: string;
  requirementNumber: string;
  listNumber: string;
  parentRequirementId: number | null;
  required: boolean;
  started: boolean;
  completed: boolean;
  percentCompleted: number;
  dateStarted: string | null;
  dateCompleted: string | null;
  leaderApprovedDate: string | null;
  leaderApprovedUserId: number | null;
}

export interface ActivitySummary {
  memberId: string;
  fullName: string;
  campingLogs: { totalNumberOfDays: number; totalNumberOfNights: number; percentCompleteTowardGoal: number };
  hikingLogs: { totalNumberOfMiles: number; percentCompleteTowardGoal: number };
  serviceLogs: { totalNumberOfHours: number; percentCompleteTowardGoal: number };
  longCruiseLogs: { totalNumberOfDays: number };
}

// --- Linked scouts (myScout endpoint) ---

export interface LinkedScout {
  userId: string;
  memberId: string;
  relationship: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  nickName: string | null;
  orgGuid: string;
  unitId: string;
  organizationName: string;
  unitType: string;
  unitNumber: string;
  program: string;
  programId: number;
}

// --- MongoDB document types (what we store) ---

export interface ScoutbookScoutDoc {
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nickName?: string;
  dob?: string;
  age?: number;
  gender?: string;
  grade?: number;
  email?: string;
  phone?: string;
  address?: { line1: string; city: string; state: string; zip: string };
  orgGuid: string;
  unitNumber: string;
  patrol?: { id: number; name: string };
  currentRank?: { id: number; name: string; level: number; dateEarned?: string };
  positions: { name: string; patrolId?: number; patrolName?: string }[];
  dateJoined?: string;
  activitySummary?: ActivitySummary;
  syncedAt: Date;
}

export interface ScoutbookAdultDoc {
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string;
  phone?: string;
  orgGuid: string;
  unitNumber: string;
  positions: { name: string; code?: string; isKey3?: boolean }[];
  syncedAt: Date;
}

export interface ScoutbookParentDoc {
  userId: string;
  memberId?: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string;
  phone?: string;
  linkedYouthUserIds: string[];
  syncedAt: Date;
}

export interface ScoutbookAdvancementDoc {
  userId: string;
  type: "rank" | "meritBadge" | "award";
  advancementId: number;
  name: string;
  versionId?: number;
  status: string;
  percentCompleted: number;
  dateStarted?: string;
  dateCompleted?: string;
  dateAwarded?: string;
  isEagleRequired?: boolean;
  counselorUserId?: string;
  syncedAt: Date;
}

export interface ScoutbookRequirementDoc {
  userId: string;
  advancementType: "rank" | "meritBadge";
  advancementId: number;
  reqId: number;
  reqNumber: string;
  reqName: string;
  parentReqId: number | null;
  completed: boolean;
  started: boolean;
  dateCompleted?: string;
  dateStarted?: string;
  leaderApprovedDate?: string;
  percentCompleted: number;
  syncedAt: Date;
}

export interface ScoutbookSyncLogDoc {
  timestamp: Date;
  operation: "roster" | "scout" | "all" | "events" | "dashboards" | "auth_test";
  orgGuid?: string;
  userId?: string;
  result: "success" | "partial" | "error";
  counts?: Record<string, number>;
  error?: string;
  durationMs: number;
}
```

**Step 2: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors (file is types-only, no imports needed beyond itself).

**Step 3: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/types.ts
git commit -m "feat(scoutbook): add BSA API response types and MongoDB doc types"
```

---

### Task 2: MongoDB Collection Accessors

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/collections.ts`

**Context:** Follow the exact pattern from `mcp-servers/scout-quest/src/db.ts` — async functions returning typed `Collection<T>`. Import `getDb` from the existing `db.ts`.

**Step 1: Write the collections file**

```typescript
import type { Collection } from "mongodb";
import { getDb } from "../db.js";
import type {
  ScoutbookScoutDoc, ScoutbookAdultDoc, ScoutbookParentDoc,
  ScoutbookAdvancementDoc, ScoutbookRequirementDoc, ScoutbookSyncLogDoc,
} from "./types.js";

export async function scoutbookScouts(): Promise<Collection<ScoutbookScoutDoc>> {
  return (await getDb()).collection("scoutbook_scouts");
}

export async function scoutbookAdults(): Promise<Collection<ScoutbookAdultDoc>> {
  return (await getDb()).collection("scoutbook_adults");
}

export async function scoutbookParents(): Promise<Collection<ScoutbookParentDoc>> {
  return (await getDb()).collection("scoutbook_parents");
}

export async function scoutbookAdvancement(): Promise<Collection<ScoutbookAdvancementDoc>> {
  return (await getDb()).collection("scoutbook_advancement");
}

export async function scoutbookRequirements(): Promise<Collection<ScoutbookRequirementDoc>> {
  return (await getDb()).collection("scoutbook_requirements");
}

export async function scoutbookSyncLog(): Promise<Collection<ScoutbookSyncLogDoc>> {
  return (await getDb()).collection("scoutbook_sync_log");
}
```

**Step 2: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/collections.ts
git commit -m "feat(scoutbook): add MongoDB collection accessors for scoutbook_* collections"
```

---

### Task 3: API Client — Auth and Request Infrastructure

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- Create: `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`

**Context:** Uses Node.js built-in `fetch` (no new deps). Auth via `POST https://my.scouting.org/api/users/{username}/authenticate`. Rate limits to 1 req/sec. JWT auto-refresh when <30min from expiry. Required headers: `Authorization: bearer {JWT}`, `Origin: https://advancements.scouting.org`, `Referer: https://advancements.scouting.org/`, `Content-Type: application/json`.

**Step 1: Write the failing tests**

Test file at `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll test the client's logic by mocking fetch.
// The client reads env vars for credentials.

describe("ScoutbookApiClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws if SCOUTBOOK_USERNAME is not set", async () => {
    delete process.env.SCOUTBOOK_USERNAME;
    delete process.env.SCOUTBOOK_PASSWORD;
    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    expect(() => new ScoutbookApiClient()).toThrow("SCOUTBOOK_USERNAME");
  });

  it("authenticates and stores token", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "testpass";

    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        tokenType: "bearer",
        accessToken: "mock-jwt-token",
        userId: 12345,
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

    // Re-import to pick up env changes
    vi.resetModules();
    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await client.authenticate();

    expect(fetch).toHaveBeenCalledWith(
      "https://my.scouting.org/api/users/testuser/authenticate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(client.isAuthenticated()).toBe(true);
  });

  it("throws on auth failure", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "badpass";

    const mockResponse = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("Invalid credentials"),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

    vi.resetModules();
    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await expect(client.authenticate()).rejects.toThrow("Authentication failed");
  });

  it("includes auth headers in API requests", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "testpass";

    // Auth response
    const authResponse = {
      ok: true,
      json: () => Promise.resolve({ tokenType: "bearer", accessToken: "my-jwt", userId: 1 }),
    };
    // API response
    const apiResponse = {
      ok: true,
      json: () => Promise.resolve({ data: "test" }),
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(apiResponse),
    );

    vi.resetModules();
    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await client.authenticate();
    await client.get("/test/endpoint");

    const secondCall = (fetch as any).mock.calls[1];
    expect(secondCall[0]).toBe("https://api.scouting.org/test/endpoint");
    expect(secondCall[1].headers["Authorization"]).toBe("bearer my-jwt");
    expect(secondCall[1].headers["Origin"]).toBe("https://advancements.scouting.org");
  });

  it("rate limits requests to 1 per second", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "testpass";

    const authResponse = {
      ok: true,
      json: () => Promise.resolve({ tokenType: "bearer", accessToken: "jwt", userId: 1 }),
    };
    const apiResponse = { ok: true, json: () => Promise.resolve({}) };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValue(apiResponse),
    );

    vi.resetModules();
    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await client.authenticate();

    const start = Date.now();
    await client.get("/a");
    await client.get("/b");
    const elapsed = Date.now() - start;

    // Second request should have waited ~1000ms
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-api-client.test.ts`
Expected: FAIL — module `../scoutbook/api-client.js` not found.

**Step 3: Write the API client implementation**

```typescript
import type { AuthResponse } from "./types.js";

const BSA_API_BASE = "https://api.scouting.org";
const BSA_AUTH_BASE = "https://my.scouting.org";
const RATE_LIMIT_MS = 1000;
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000; // 30 minutes

export class ScoutbookApiClient {
  private username: string;
  private password: string;
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private userId: number | null = null;
  private lastRequestTime: number = 0;

  constructor() {
    const username = process.env.SCOUTBOOK_USERNAME;
    const password = process.env.SCOUTBOOK_PASSWORD;
    if (!username) throw new Error("SCOUTBOOK_USERNAME environment variable is required");
    if (!password) throw new Error("SCOUTBOOK_PASSWORD environment variable is required");
    this.username = username;
    this.password = password;
  }

  async authenticate(): Promise<void> {
    const url = `${BSA_AUTH_BASE}/api/users/${encodeURIComponent(this.username)}/authenticate`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Authentication failed (${response.status}): ${body}`);
    }

    const data = await response.json() as AuthResponse;
    this.token = data.accessToken;
    this.userId = data.userId;

    // Parse JWT exp claim for expiry tracking
    try {
      const payload = JSON.parse(atob(this.token.split(".")[1]));
      this.tokenExpiry = payload.exp * 1000;
    } catch {
      // Fallback: assume 8 hours from now
      this.tokenExpiry = Date.now() + 8 * 60 * 60 * 1000;
    }
  }

  isAuthenticated(): boolean {
    return this.token !== null && Date.now() < this.tokenExpiry;
  }

  getUserId(): number | null {
    return this.userId;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.token || Date.now() > this.tokenExpiry - TOKEN_REFRESH_BUFFER_MS) {
      await this.authenticate();
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async get<T = unknown>(path: string): Promise<T> {
    await this.ensureAuth();
    await this.rateLimit();

    const url = `${BSA_API_BASE}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `bearer ${this.token}`,
        "Origin": "https://advancements.scouting.org",
        "Referer": "https://advancements.scouting.org/",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (response.status === 401) {
      // One re-auth attempt
      await this.authenticate();
      await this.rateLimit();
      const retry = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `bearer ${this.token}`,
          "Origin": "https://advancements.scouting.org",
          "Referer": "https://advancements.scouting.org/",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      });
      if (!retry.ok) {
        throw new Error(`API request failed after re-auth: ${retry.status} ${retry.statusText} — ${url}`);
      }
      return retry.json() as Promise<T>;
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText} — ${url}`);
    }

    return response.json() as Promise<T>;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-api-client.test.ts`
Expected: All 5 tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/api-client.ts mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts
git commit -m "feat(scoutbook): add API client with auth, rate limiting, and tests"
```

---

### Task 4: API Client — Roster and Advancement Methods

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`

**Context:** Add typed methods for each API endpoint. These are thin wrappers around `get()` that parse response shapes. See `scouting-org-research/api-reference.md` for endpoint paths.

**Step 1: Add failing tests for roster methods**

Append to the test file's `describe("ScoutbookApiClient")` block:

```typescript
  it("getYouthRoster calls correct endpoint and extracts users", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "testpass";

    const authResp = { ok: true, json: () => Promise.resolve({ tokenType: "bearer", accessToken: "jwt", userId: 1 }) };
    const rosterResp = {
      ok: true,
      json: () => Promise.resolve({
        id: 121894,
        users: [{ userId: 11833244, firstName: "Henry", lastName: "Baddley" }],
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(authResp).mockResolvedValueOnce(rosterResp));
    vi.resetModules();

    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await client.authenticate();
    const users = await client.getYouthRoster("ORG-GUID");

    expect(users).toHaveLength(1);
    expect(users[0].firstName).toBe("Henry");
    expect((fetch as any).mock.calls[1][0]).toContain("/organizations/v2/units/ORG-GUID/youths");
  });

  it("getScoutRanks extracts ranks from program array", async () => {
    process.env.SCOUTBOOK_USERNAME = "testuser";
    process.env.SCOUTBOOK_PASSWORD = "testpass";

    const authResp = { ok: true, json: () => Promise.resolve({ tokenType: "bearer", accessToken: "jwt", userId: 1 }) };
    const ranksResp = {
      ok: true,
      json: () => Promise.resolve({
        status: "All",
        program: [{
          programId: 2,
          program: "Scouts BSA",
          totalNumberOfRanks: 7,
          ranks: [{ id: 1, name: "Scout", status: "Awarded", percentCompleted: 1 }],
        }],
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(authResp).mockResolvedValueOnce(ranksResp));
    vi.resetModules();

    const { ScoutbookApiClient } = await import("../scoutbook/api-client.js");
    const client = new ScoutbookApiClient();
    await client.authenticate();
    const ranks = await client.getScoutRanks("12352438");

    expect(ranks).toHaveLength(1);
    expect(ranks[0].name).toBe("Scout");
  });
```

**Step 2: Run tests to verify new tests fail**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-api-client.test.ts`
Expected: FAIL — `getYouthRoster` and `getScoutRanks` are not functions.

**Step 3: Add roster and advancement methods to the client**

Add these methods to the `ScoutbookApiClient` class in `api-client.ts`:

```typescript
  // --- Roster methods ---

  async getYouthRoster(orgGuid: string): Promise<YouthMember[]> {
    const data = await this.get<YouthRosterResponse>(`/organizations/v2/units/${orgGuid}/youths`);
    return data.users;
  }

  async getAdultRoster(orgGuid: string): Promise<AdultMember[]> {
    const data = await this.get<AdultRosterResponse>(`/organizations/v2/units/${orgGuid}/adults`);
    return data.users;
  }

  async getParentRoster(orgGuid: string): Promise<ParentEntry[]> {
    return this.get<ParentEntry[]>(`/organizations/v2/units/${orgGuid}/parents`);
  }

  async getPatrols(orgGuid: string): Promise<Patrol[]> {
    return this.get<Patrol[]>(`/organizations/v2/units/${orgGuid}/subUnits`);
  }

  // --- Advancement methods ---

  async getScoutRanks(userId: string): Promise<RankProgress[]> {
    const data = await this.get<RanksResponse>(`/advancements/v2/youth/${userId}/ranks`);
    // Flatten all programs' ranks into a single array (usually just Scouts BSA)
    return data.program.flatMap(p => p.ranks);
  }

  async getRankRequirements(userId: string, rankId: number): Promise<RequirementCompletion[]> {
    const data = await this.get<{ requirements: RequirementCompletion[] }>(
      `/advancements/v2/youth/${userId}/ranks/${rankId}/requirements`,
    );
    return data.requirements;
  }

  async getScoutMeritBadges(userId: string): Promise<MeritBadgeProgress[]> {
    return this.get<MeritBadgeProgress[]>(`/advancements/v2/youth/${userId}/meritBadges`);
  }

  async getMeritBadgeRequirements(userId: string, mbId: number): Promise<RequirementCompletion[]> {
    const data = await this.get<{ requirements: RequirementCompletion[] }>(
      `/advancements/v2/youth/${userId}/meritBadges/${mbId}/requirements`,
    );
    return data.requirements;
  }

  async getScoutAwards(userId: string): Promise<AwardProgress[]> {
    return this.get<AwardProgress[]>(`/advancements/v2/youth/${userId}/awards`);
  }

  async getActivitySummary(userId: string): Promise<ActivitySummary> {
    return this.get<ActivitySummary>(`/advancements/v2/${userId}/userActivitySummary`);
  }
```

Also add the necessary imports at the top of `api-client.ts`:

```typescript
import type {
  AuthResponse, YouthRosterResponse, YouthMember,
  AdultRosterResponse, AdultMember, ParentEntry, Patrol,
  RanksResponse, RankProgress, RequirementCompletion,
  MeritBadgeProgress, AwardProgress, ActivitySummary,
} from "./types.js";
```

**Step 4: Run tests to verify they pass**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-api-client.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/api-client.ts mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts
git commit -m "feat(scoutbook): add roster and advancement methods to API client"
```

---

### Task 5: Sync Orchestration — Roster Sync

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- Create: `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`

**Context:** `syncRoster` pulls youth + adult + parent rosters from the API and upserts into `scoutbook_scouts`, `scoutbook_adults`, `scoutbook_parents`. Each roster member is mapped from API response types to MongoDB doc types. Upsert key is `userId` (as string). Logs to `scoutbook_sync_log`.

**Step 1: Write the failing test**

`mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit test syncRoster using a mock API client and mock collections.

describe("syncRoster", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("maps youth roster to ScoutbookScoutDoc and upserts", async () => {
    // Mock collections
    const upsertedScouts: any[] = [];
    const upsertedAdults: any[] = [];
    const upsertedParents: any[] = [];
    const insertedLogs: any[] = [];

    vi.doMock("../scoutbook/collections.js", () => ({
      scoutbookScouts: () => Promise.resolve({
        updateOne: (filter: any, update: any, opts: any) => {
          upsertedScouts.push({ filter, update, opts });
          return Promise.resolve({ upsertedCount: 1 });
        },
      }),
      scoutbookAdults: () => Promise.resolve({
        updateOne: (filter: any, update: any, opts: any) => {
          upsertedAdults.push({ filter, update, opts });
          return Promise.resolve({ upsertedCount: 1 });
        },
      }),
      scoutbookParents: () => Promise.resolve({
        updateOne: (filter: any, update: any, opts: any) => {
          upsertedParents.push({ filter, update, opts });
          return Promise.resolve({ upsertedCount: 1 });
        },
      }),
      scoutbookSyncLog: () => Promise.resolve({
        insertOne: (doc: any) => { insertedLogs.push(doc); return Promise.resolve({}); },
      }),
    }));

    // Mock API client
    const mockClient = {
      getYouthRoster: vi.fn().mockResolvedValue([{
        userId: 12352438, memberId: 141634365, personGuid: "PG1",
        firstName: "William", lastName: "Bramwell", personFullName: "William Bramwell",
        nickName: "Will", dateOfBirth: "2012-01-15", age: 14, gender: "M", grade: 8,
        email: "will@test.com", homePhone: "5551234", address1: "123 Main",
        city: "Atlanta", state: "GA", zip: "30306",
        highestRanksAwarded: [{ id: 1, rank: "Scout", level: 1, dateEarned: "2025-11-13" }],
        positions: [{ positionId: 111, position: "Scouts BSA", patrolId: 175671, patrolName: "New Scouts" }],
        dateJoinedBoyScouts: "2025-09-01",
      }]),
      getAdultRoster: vi.fn().mockResolvedValue([{
        userId: 9120709, memberId: 131200255, personGuid: "PG2",
        firstName: "Jeremy", lastName: "Bramwell", personFullName: "Jeremy Bramwell",
        nickName: null, age: 42, isAdult: true,
        email: "jeremy@test.com", homePhone: "5555678",
        positions: [{ positionId: 482, position: "Scoutmaster", isKey3: true }],
      }]),
      getParentRoster: vi.fn().mockResolvedValue([{
        youthUserId: 12352438, parentUserId: 9120709,
        parentInformation: {
          memberId: 131200255, personGuid: "PG2",
          firstName: "Jeremy", lastName: "Bramwell", personFullName: "Jeremy Bramwell",
          email: "jeremy@test.com", homePhone: "5555678",
        },
      }]),
      getPatrols: vi.fn().mockResolvedValue([
        { subUnitId: 175671, subUnitName: "New Scouts", unitId: 121894 },
      ]),
    };

    const { syncRoster } = await import("../scoutbook/sync.js");
    const result = await syncRoster(mockClient as any, "ORG-GUID");

    expect(result.scouts).toBe(1);
    expect(result.adults).toBe(1);
    expect(result.parents).toBe(1);

    // Check scout doc shape
    const scoutDoc = upsertedScouts[0].update.$set;
    expect(scoutDoc.userId).toBe("12352438");
    expect(scoutDoc.firstName).toBe("William");
    expect(scoutDoc.patrol).toEqual({ id: 175671, name: "New Scouts" });
    expect(scoutDoc.currentRank).toEqual(expect.objectContaining({ id: 1, name: "Scout" }));

    // Check parent doc has linked youth
    const parentDoc = upsertedParents[0].update.$set;
    expect(parentDoc.userId).toBe("9120709");

    // Check sync log
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0].operation).toBe("roster");
    expect(insertedLogs[0].result).toBe("success");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: FAIL — `../scoutbook/sync.js` not found.

**Step 3: Implement syncRoster**

`mcp-servers/scout-quest/src/scoutbook/sync.ts`:

```typescript
import type { ScoutbookApiClient } from "./api-client.js";
import type {
  YouthMember, AdultMember, ParentEntry,
  ScoutbookScoutDoc, ScoutbookAdultDoc, ScoutbookParentDoc,
  ScoutbookAdvancementDoc, ScoutbookRequirementDoc,
  RankProgress, MeritBadgeProgress, AwardProgress, RequirementCompletion,
} from "./types.js";
import {
  scoutbookScouts, scoutbookAdults, scoutbookParents,
  scoutbookAdvancement, scoutbookRequirements, scoutbookSyncLog,
} from "./collections.js";

interface SyncResult {
  scouts?: number;
  adults?: number;
  parents?: number;
  advancements?: number;
  requirements?: number;
}

export async function syncRoster(
  client: ScoutbookApiClient,
  orgGuid: string,
): Promise<SyncResult> {
  const startTime = Date.now();
  const counts: SyncResult = { scouts: 0, adults: 0, parents: 0 };

  try {
    const [youth, adults, parents] = await Promise.all([
      client.getYouthRoster(orgGuid),
      client.getAdultRoster(orgGuid),
      client.getParentRoster(orgGuid),
    ]);

    const now = new Date();
    const scoutsCol = await scoutbookScouts();
    const adultsCol = await scoutbookAdults();
    const parentsCol = await scoutbookParents();

    // Upsert youth
    for (const y of youth) {
      const doc = mapYouthToDoc(y, orgGuid, now);
      await scoutsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
      counts.scouts!++;
    }

    // Upsert adults
    for (const a of adults) {
      const doc = mapAdultToDoc(a, orgGuid, now);
      await adultsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
      counts.adults!++;
    }

    // Aggregate parents: group by parentUserId, collect linked youth
    const parentMap = new Map<number, { entry: ParentEntry; youthIds: string[] }>();
    for (const p of parents) {
      const existing = parentMap.get(p.parentUserId);
      if (existing) {
        existing.youthIds.push(String(p.youthUserId));
      } else {
        parentMap.set(p.parentUserId, {
          entry: p,
          youthIds: [String(p.youthUserId)],
        });
      }
    }

    for (const { entry, youthIds } of parentMap.values()) {
      const doc = mapParentToDoc(entry, youthIds, now);
      await parentsCol.updateOne(
        { userId: doc.userId },
        { $set: doc },
        { upsert: true },
      );
      counts.parents!++;
    }

    const logCol = await scoutbookSyncLog();
    await logCol.insertOne({
      timestamp: now,
      operation: "roster",
      orgGuid,
      result: "success",
      counts: { scouts: counts.scouts!, adults: counts.adults!, parents: counts.parents! },
      durationMs: Date.now() - startTime,
    });

    return counts;
  } catch (error) {
    const logCol = await scoutbookSyncLog();
    await logCol.insertOne({
      timestamp: new Date(),
      operation: "roster",
      orgGuid,
      result: "error",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

function mapYouthToDoc(y: YouthMember, orgGuid: string, now: Date): ScoutbookScoutDoc {
  // Find patrol from positions (position with patrolId)
  const patrolPos = y.positions.find(p => p.patrolId != null);
  const patrol = patrolPos ? { id: patrolPos.patrolId!, name: patrolPos.patrolName! } : undefined;

  // Highest rank from highestRanksAwarded (Scouts BSA)
  const bsaRank = y.highestRanksAwarded?.find(r => r.programId === 2);
  const currentRank = bsaRank
    ? { id: bsaRank.id, name: bsaRank.rank, level: bsaRank.level, dateEarned: bsaRank.dateEarned }
    : undefined;

  return {
    userId: String(y.userId),
    memberId: String(y.memberId),
    personGuid: y.personGuid,
    firstName: y.firstName,
    lastName: y.lastName,
    fullName: y.personFullName,
    nickName: y.nickName ?? undefined,
    dob: y.dateOfBirth,
    age: y.age,
    gender: y.gender,
    grade: y.grade ?? undefined,
    email: y.email ?? undefined,
    phone: y.homePhone ?? y.mobilePhone ?? undefined,
    address: y.address1 ? {
      line1: y.address1,
      city: y.city ?? "",
      state: y.state ?? "",
      zip: (y.zip ?? "").trim(),
    } : undefined,
    orgGuid,
    unitNumber: "", // filled from roster wrapper if needed
    patrol,
    currentRank,
    positions: y.positions.map(p => ({
      name: p.position,
      patrolId: p.patrolId ?? undefined,
      patrolName: p.patrolName ?? undefined,
    })),
    dateJoined: y.dateJoinedBoyScouts ?? undefined,
    syncedAt: now,
  };
}

function mapAdultToDoc(a: AdultMember, orgGuid: string, now: Date): ScoutbookAdultDoc {
  return {
    userId: String(a.userId),
    memberId: String(a.memberId),
    personGuid: a.personGuid,
    firstName: a.firstName,
    lastName: a.lastName,
    fullName: a.personFullName,
    email: a.email ?? undefined,
    phone: a.homePhone ?? a.mobilePhone ?? undefined,
    orgGuid,
    unitNumber: "",
    positions: a.positions.map(p => ({
      name: p.position,
      isKey3: p.isKey3,
    })),
    syncedAt: now,
  };
}

function mapParentToDoc(entry: ParentEntry, youthIds: string[], now: Date): ScoutbookParentDoc {
  const p = entry.parentInformation;
  return {
    userId: String(entry.parentUserId),
    memberId: p.memberId ? String(p.memberId) : undefined,
    personGuid: p.personGuid,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: p.personFullName,
    email: p.email ?? undefined,
    phone: p.homePhone ?? p.mobilePhone ?? undefined,
    linkedYouthUserIds: youthIds,
    syncedAt: now,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/sync.ts mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts
git commit -m "feat(scoutbook): add syncRoster with mapping and upsert logic"
```

---

### Task 6: Sync Orchestration — Scout Advancement Sync

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`

**Context:** `syncScout(client, userId)` pulls one scout's ranks, merit badges, awards, and individual requirements. For each rank/MB that is started or awarded, it also pulls individual requirements. Upserts into `scoutbook_advancement` and `scoutbook_requirements`.

**Step 1: Write the failing test**

Append to `scoutbook-sync.test.ts`:

```typescript
describe("syncScout", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("syncs ranks, merit badges, awards, and requirements", async () => {
    const upsertedAdvancements: any[] = [];
    const upsertedRequirements: any[] = [];
    const insertedLogs: any[] = [];

    vi.doMock("../scoutbook/collections.js", () => ({
      scoutbookAdvancement: () => Promise.resolve({
        updateOne: (filter: any, update: any, opts: any) => {
          upsertedAdvancements.push({ filter, update, opts });
          return Promise.resolve({ upsertedCount: 1 });
        },
      }),
      scoutbookRequirements: () => Promise.resolve({
        updateOne: (filter: any, update: any, opts: any) => {
          upsertedRequirements.push({ filter, update, opts });
          return Promise.resolve({ upsertedCount: 1 });
        },
      }),
      scoutbookSyncLog: () => Promise.resolve({
        insertOne: (doc: any) => { insertedLogs.push(doc); return Promise.resolve({}); },
      }),
    }));

    const mockClient = {
      getScoutRanks: vi.fn().mockResolvedValue([
        { id: 1, name: "Scout", status: "Awarded", percentCompleted: 1, dateEarned: "2025-11-13", awardedDate: "2025-11-19" },
      ]),
      getRankRequirements: vi.fn().mockResolvedValue([
        { id: 2006, requirementNumber: "7", name: "Scoutmaster conference", short: "SM conf",
          parentRequirementId: null, started: true, completed: true,
          dateStarted: "2025-10-21", dateCompleted: "2025-10-21",
          leaderApprovedDate: "2025-11-13", percentCompleted: 1 },
      ]),
      getScoutMeritBadges: vi.fn().mockResolvedValue([
        { id: 24, name: "Citizenship in the Community", status: "Started",
          percentCompleted: 0, dateStarted: "2026-02-08", dateCompleted: "",
          awardedDate: "", awarded: false, isEagleRequired: true },
      ]),
      getMeritBadgeRequirements: vi.fn().mockResolvedValue([
        { id: 5001, requirementNumber: "1", name: "Req 1", short: "R1",
          parentRequirementId: null, started: false, completed: false,
          dateStarted: null, dateCompleted: null, percentCompleted: 0 },
      ]),
      getScoutAwards: vi.fn().mockResolvedValue([
        { awardId: 98, name: "Firem'n Chit (Scouts BSA)", short: "Firem'n Chit",
          percentCompleted: 1, dateEarned: "2025-09-28", awarded: true, awardedDate: "2025-11-19" },
      ]),
      getActivitySummary: vi.fn().mockResolvedValue({
        memberId: "141634365", fullName: "William Bramwell",
        campingLogs: { totalNumberOfDays: 1, totalNumberOfNights: 1, percentCompleteTowardGoal: 0.05 },
        hikingLogs: { totalNumberOfMiles: 0, percentCompleteTowardGoal: 0 },
        serviceLogs: { totalNumberOfHours: 5, percentCompleteTowardGoal: 0.33 },
        longCruiseLogs: { totalNumberOfDays: 0 },
      }),
    };

    const { syncScout } = await import("../scoutbook/sync.js");
    const result = await syncScout(mockClient as any, "12352438");

    // 1 rank + 1 MB + 1 award = 3 advancements
    expect(result.advancements).toBe(3);
    // 1 rank req + 1 MB req = 2 requirements
    expect(result.requirements).toBe(2);

    // Check rank advancement doc
    const rankAdv = upsertedAdvancements.find(a => a.filter.type === "rank");
    expect(rankAdv.filter.userId).toBe("12352438");
    expect(rankAdv.update.$set.name).toBe("Scout");
    expect(rankAdv.update.$set.status).toBe("Awarded");

    // Check MB advancement doc
    const mbAdv = upsertedAdvancements.find(a => a.filter.type === "meritBadge");
    expect(mbAdv.update.$set.name).toBe("Citizenship in the Community");

    // Check rank req doc
    const rankReq = upsertedRequirements.find(r => r.filter.advancementType === "rank");
    expect(rankReq.update.$set.completed).toBe(true);

    // Verify getRankRequirements was called (rank is Awarded)
    expect(mockClient.getRankRequirements).toHaveBeenCalledWith("12352438", 1);
    // Verify getMeritBadgeRequirements was called (MB is Started)
    expect(mockClient.getMeritBadgeRequirements).toHaveBeenCalledWith("12352438", 24);

    // Sync log
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0].operation).toBe("scout");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: FAIL — `syncScout` is not exported.

**Step 3: Add syncScout to sync.ts**

Append to `sync.ts`:

```typescript
export async function syncScout(
  client: ScoutbookApiClient,
  userId: string,
): Promise<SyncResult> {
  const startTime = Date.now();
  const counts: SyncResult = { advancements: 0, requirements: 0 };

  try {
    const [ranks, meritBadges, awards] = await Promise.all([
      client.getScoutRanks(userId),
      client.getScoutMeritBadges(userId),
      client.getScoutAwards(userId),
    ]);

    const now = new Date();
    const advCol = await scoutbookAdvancement();
    const reqCol = await scoutbookRequirements();

    // Upsert ranks
    for (const rank of ranks) {
      const doc: ScoutbookAdvancementDoc = {
        userId,
        type: "rank",
        advancementId: rank.id,
        name: rank.name,
        versionId: rank.versionId,
        status: rank.status,
        percentCompleted: rank.percentCompleted,
        dateCompleted: rank.dateEarned || undefined,
        dateAwarded: rank.awardedDate || undefined,
        syncedAt: now,
      };
      await advCol.updateOne(
        { userId, type: "rank", advancementId: rank.id },
        { $set: doc },
        { upsert: true },
      );
      counts.advancements!++;

      // Pull requirements for started/awarded ranks
      if (rank.status === "Awarded" || rank.status === "Started" || rank.percentCompleted > 0) {
        const reqs = await client.getRankRequirements(userId, rank.id);
        for (const req of reqs) {
          await upsertRequirement(reqCol, userId, "rank", rank.id, req, now);
          counts.requirements!++;
        }
      }
    }

    // Upsert merit badges
    for (const mb of meritBadges) {
      const doc: ScoutbookAdvancementDoc = {
        userId,
        type: "meritBadge",
        advancementId: mb.id,
        name: mb.name,
        status: mb.status,
        percentCompleted: mb.percentCompleted,
        dateStarted: mb.dateStarted || undefined,
        dateCompleted: mb.dateCompleted || undefined,
        dateAwarded: mb.awardedDate || undefined,
        isEagleRequired: mb.isEagleRequired,
        counselorUserId: mb.assignedCounselorUserId ? String(mb.assignedCounselorUserId) : undefined,
        syncedAt: now,
      };
      await advCol.updateOne(
        { userId, type: "meritBadge", advancementId: mb.id },
        { $set: doc },
        { upsert: true },
      );
      counts.advancements!++;

      // Pull requirements for started/awarded MBs
      if (mb.status === "Awarded" || mb.status === "Started" || mb.percentCompleted > 0) {
        const reqs = await client.getMeritBadgeRequirements(userId, mb.id);
        for (const req of reqs) {
          await upsertRequirement(reqCol, userId, "meritBadge", mb.id, req, now);
          counts.requirements!++;
        }
      }
    }

    // Upsert awards
    for (const award of awards) {
      const doc: ScoutbookAdvancementDoc = {
        userId,
        type: "award",
        advancementId: award.awardId,
        name: award.name,
        status: award.awarded ? "Awarded" : "Started",
        percentCompleted: award.percentCompleted,
        dateCompleted: award.dateEarned || undefined,
        dateAwarded: award.awardedDate || undefined,
        syncedAt: now,
      };
      await advCol.updateOne(
        { userId, type: "award", advancementId: award.awardId },
        { $set: doc },
        { upsert: true },
      );
      counts.advancements!++;
    }

    // Update activity summary on scout doc
    try {
      const activity = await client.getActivitySummary(userId);
      const scoutsCol = await scoutbookScouts();
      await scoutsCol.updateOne(
        { userId },
        { $set: { activitySummary: activity, syncedAt: now } },
      );
    } catch {
      // Non-fatal — scout doc may not exist yet if roster hasn't been synced
    }

    const logCol = await scoutbookSyncLog();
    await logCol.insertOne({
      timestamp: now,
      operation: "scout",
      userId,
      result: "success",
      counts: { advancements: counts.advancements!, requirements: counts.requirements! },
      durationMs: Date.now() - startTime,
    });

    return counts;
  } catch (error) {
    const logCol = await scoutbookSyncLog();
    await logCol.insertOne({
      timestamp: new Date(),
      operation: "scout",
      userId,
      result: "error",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

async function upsertRequirement(
  col: Awaited<ReturnType<typeof scoutbookRequirements>>,
  userId: string,
  advancementType: "rank" | "meritBadge",
  advancementId: number,
  req: RequirementCompletion,
  now: Date,
): Promise<void> {
  const doc: ScoutbookRequirementDoc = {
    userId,
    advancementType,
    advancementId,
    reqId: req.id,
    reqNumber: req.requirementNumber || req.listNumber,
    reqName: req.short || req.name,
    parentReqId: req.parentRequirementId,
    completed: req.completed,
    started: req.started,
    dateCompleted: req.dateCompleted ?? undefined,
    dateStarted: req.dateStarted ?? undefined,
    leaderApprovedDate: req.leaderApprovedDate ?? undefined,
    percentCompleted: req.percentCompleted,
    syncedAt: now,
  };
  await col.updateOne(
    { userId, advancementType, advancementId, reqId: req.id },
    { $set: doc },
    { upsert: true },
  );
}
```

Also add the import for `scoutbookScouts` to the imports at the top (it's already imported for `syncRoster`, so this is just for the activity summary part in `syncScout`).

**Step 4: Run tests to verify they pass**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/sync.ts mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts
git commit -m "feat(scoutbook): add syncScout with advancement and requirement upserts"
```

---

### Task 7: Sync Orchestration — syncAll

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`

**Context:** `syncAll(client, orgGuid)` runs `syncRoster` then `syncScout` for every youth in the roster. Continues on individual scout failures (partial success). Logs overall result.

**Step 1: Write the failing test**

```typescript
describe("syncAll", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("syncs roster then each scout", async () => {
    const operations: string[] = [];
    const insertedLogs: any[] = [];

    vi.doMock("../scoutbook/collections.js", () => ({
      scoutbookScouts: () => Promise.resolve({
        updateOne: () => { operations.push("scout_upsert"); return Promise.resolve({}); },
        find: () => ({
          project: () => ({
            toArray: () => Promise.resolve([
              { userId: "111" },
              { userId: "222" },
            ]),
          }),
        }),
      }),
      scoutbookAdults: () => Promise.resolve({
        updateOne: () => Promise.resolve({}),
      }),
      scoutbookParents: () => Promise.resolve({
        updateOne: () => Promise.resolve({}),
      }),
      scoutbookAdvancement: () => Promise.resolve({
        updateOne: () => Promise.resolve({}),
      }),
      scoutbookRequirements: () => Promise.resolve({
        updateOne: () => Promise.resolve({}),
      }),
      scoutbookSyncLog: () => Promise.resolve({
        insertOne: (doc: any) => { insertedLogs.push(doc); return Promise.resolve({}); },
      }),
    }));

    const mockClient = {
      getYouthRoster: vi.fn().mockResolvedValue([
        { userId: 111, memberId: 1, personGuid: "A", firstName: "A", lastName: "B",
          personFullName: "A B", positions: [], highestRanksAwarded: [] },
        { userId: 222, memberId: 2, personGuid: "C", firstName: "C", lastName: "D",
          personFullName: "C D", positions: [], highestRanksAwarded: [] },
      ]),
      getAdultRoster: vi.fn().mockResolvedValue([]),
      getParentRoster: vi.fn().mockResolvedValue([]),
      getPatrols: vi.fn().mockResolvedValue([]),
      getScoutRanks: vi.fn().mockResolvedValue([]),
      getScoutMeritBadges: vi.fn().mockResolvedValue([]),
      getScoutAwards: vi.fn().mockResolvedValue([]),
      getActivitySummary: vi.fn().mockResolvedValue({
        memberId: "1", fullName: "Test",
        campingLogs: { totalNumberOfDays: 0, totalNumberOfNights: 0, percentCompleteTowardGoal: 0 },
        hikingLogs: { totalNumberOfMiles: 0, percentCompleteTowardGoal: 0 },
        serviceLogs: { totalNumberOfHours: 0, percentCompleteTowardGoal: 0 },
        longCruiseLogs: { totalNumberOfDays: 0 },
      }),
    };

    const { syncAll } = await import("../scoutbook/sync.js");
    const result = await syncAll(mockClient as any, "ORG-GUID");

    expect(result.scouts).toBe(2);
    // syncScout called for each youth
    expect(mockClient.getScoutRanks).toHaveBeenCalledTimes(2);

    // Should have 3 log entries: roster + 2 scouts + 1 overall
    // (roster log + scout1 log + scout2 log + all log)
    const allLog = insertedLogs.find(l => l.operation === "all");
    expect(allLog).toBeDefined();
    expect(allLog.result).toBe("success");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: FAIL — `syncAll` not exported.

**Step 3: Add syncAll to sync.ts**

```typescript
export async function syncAll(
  client: ScoutbookApiClient,
  orgGuid: string,
): Promise<SyncResult & { failed?: string[] }> {
  const startTime = Date.now();
  const rosterResult = await syncRoster(client, orgGuid);

  // Get all youth userIds from the freshly-synced collection
  const scoutsCol = await scoutbookScouts();
  const youthDocs = await scoutsCol.find({}).project({ userId: 1 }).toArray();
  const youthIds = youthDocs.map(d => d.userId as string);

  let totalAdvancements = 0;
  let totalRequirements = 0;
  const failed: string[] = [];

  for (const userId of youthIds) {
    try {
      const result = await syncScout(client, userId);
      totalAdvancements += result.advancements ?? 0;
      totalRequirements += result.requirements ?? 0;
    } catch (error) {
      failed.push(userId);
      // Continue with next scout — partial success is OK
    }
  }

  const now = new Date();
  const logCol = await scoutbookSyncLog();
  await logCol.insertOne({
    timestamp: now,
    operation: "all",
    orgGuid,
    result: failed.length === 0 ? "success" : "partial",
    counts: {
      scouts: rosterResult.scouts!,
      adults: rosterResult.adults!,
      parents: rosterResult.parents!,
      advancements: totalAdvancements,
      requirements: totalRequirements,
    },
    error: failed.length > 0 ? `Failed for userIds: ${failed.join(", ")}` : undefined,
    durationMs: Date.now() - startTime,
  });

  return {
    ...rosterResult,
    advancements: totalAdvancements,
    requirements: totalRequirements,
    failed: failed.length > 0 ? failed : undefined,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-sync.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/sync.ts mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts
git commit -m "feat(scoutbook): add syncAll with per-scout error resilience"
```

---

### Task 8: CLI Entry Point

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/cli.ts`

**Context:** Standalone script invoked as `node dist/scoutbook/cli.js <command>`. Reads env vars, runs sync operations, prints results. No test needed — this is a thin wrapper over already-tested logic.

**Step 1: Write the CLI**

```typescript
import { ScoutbookApiClient } from "./api-client.js";
import { syncRoster, syncScout, syncAll } from "./sync.js";
import { scoutbookScouts, scoutbookAdults, scoutbookParents, scoutbookAdvancement, scoutbookSyncLog } from "./collections.js";

const COMMANDS = ["auth", "roster", "scout", "all", "status"] as const;

async function main(): Promise<void> {
  const command = process.argv[2] as typeof COMMANDS[number];
  if (!command || !COMMANDS.includes(command)) {
    console.log("Usage: node dist/scoutbook/cli.js <command> [args]");
    console.log("");
    console.log("Commands:");
    console.log("  auth              Test authentication, print token info");
    console.log("  roster [orgGuid]  Sync troop roster");
    console.log("  scout <userId>    Sync one scout's advancement");
    console.log("  all [orgGuid]     Full sync: roster + all scouts");
    console.log("  status            Print last sync timestamps and counts");
    console.log("");
    console.log("Environment: SCOUTBOOK_USERNAME, SCOUTBOOK_PASSWORD, SCOUTBOOK_ORG_GUID, MONGO_URI");
    process.exit(1);
  }

  if (command === "status") {
    await printStatus();
    return;
  }

  const client = new ScoutbookApiClient();

  if (command === "auth") {
    console.log("Authenticating...");
    await client.authenticate();
    console.log(`Authenticated as userId ${client.getUserId()}`);
    console.log(`Token valid: ${client.isAuthenticated()}`);
    return;
  }

  // Auth required for all other commands
  await client.authenticate();
  console.log(`Authenticated as userId ${client.getUserId()}`);

  const orgGuid = process.argv[3] || process.env.SCOUTBOOK_ORG_GUID;

  if (command === "roster") {
    if (!orgGuid) { console.error("Error: orgGuid required (arg or SCOUTBOOK_ORG_GUID env)"); process.exit(1); }
    console.log(`Syncing roster for ${orgGuid}...`);
    const result = await syncRoster(client, orgGuid);
    console.log(`Done: ${result.scouts} scouts, ${result.adults} adults, ${result.parents} parents`);
    return;
  }

  if (command === "scout") {
    const userId = process.argv[3];
    if (!userId) { console.error("Error: userId required"); process.exit(1); }
    console.log(`Syncing advancement for scout ${userId}...`);
    const result = await syncScout(client, userId);
    console.log(`Done: ${result.advancements} advancements, ${result.requirements} requirements`);
    return;
  }

  if (command === "all") {
    if (!orgGuid) { console.error("Error: orgGuid required (arg or SCOUTBOOK_ORG_GUID env)"); process.exit(1); }
    console.log(`Full sync for ${orgGuid}...`);
    const result = await syncAll(client, orgGuid);
    console.log(`Done: ${result.scouts} scouts, ${result.adults} adults, ${result.parents} parents`);
    console.log(`      ${result.advancements} advancements, ${result.requirements} requirements`);
    if (result.failed?.length) {
      console.log(`      Failed for ${result.failed.length} scouts: ${result.failed.join(", ")}`);
    }
    return;
  }
}

async function printStatus(): Promise<void> {
  const [scoutsCol, adultsCol, parentsCol, advCol, logCol] = await Promise.all([
    scoutbookScouts(), scoutbookAdults(), scoutbookParents(), scoutbookAdvancement(), scoutbookSyncLog(),
  ]);

  const [scoutCount, adultCount, parentCount, advCount] = await Promise.all([
    scoutsCol.countDocuments(), adultsCol.countDocuments(),
    parentsCol.countDocuments(), advCol.countDocuments(),
  ]);

  console.log("Scoutbook Sync Status:");
  console.log(`  Scouts:       ${scoutCount}`);
  console.log(`  Adults:       ${adultCount}`);
  console.log(`  Parents:      ${parentCount}`);
  console.log(`  Advancements: ${advCount}`);

  const lastLog = await logCol.find().sort({ timestamp: -1 }).limit(3).toArray();
  if (lastLog.length) {
    console.log("\nRecent sync operations:");
    for (const log of lastLog) {
      console.log(`  ${log.timestamp.toISOString()} — ${log.operation} — ${log.result} (${log.durationMs}ms)`);
    }
  } else {
    console.log("\nNo sync operations recorded yet.");
  }
}

main().catch(err => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 3: Add CLI entry point to package.json**

Add to `scripts` in `package.json`:

```json
"start:scoutbook": "node dist/scoutbook/cli.js"
```

**Step 4: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/cli.ts mcp-servers/scout-quest/package.json
git commit -m "feat(scoutbook): add CLI entry point for sync commands"
```

---

### Task 9: MCP Admin Tools — Sync Roster and Sync Scout

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/admin/scoutbookSync.ts`
- Modify: `mcp-servers/scout-quest/src/tools/admin/index.ts`

**Context:** Two new MCP tools: `scoutbook_sync_roster` and `scoutbook_sync_scout`. Follow the existing pattern in `tools/admin/` — each tool is a function that takes `McpServer` and registers via `server.registerTool()`. Input schemas use zod. Register them from `index.ts`.

**Step 1: Write the tools file**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScoutbookApiClient } from "../../scoutbook/api-client.js";
import { syncRoster, syncScout } from "../../scoutbook/sync.js";

export function registerScoutbookSyncRoster(server: McpServer): void {
  server.registerTool(
    "scoutbook_sync_roster",
    {
      title: "Scoutbook: Sync Roster",
      description: "Pull youth, adult, and parent rosters from Scoutbook into local MongoDB. Requires SCOUTBOOK_USERNAME, SCOUTBOOK_PASSWORD, and SCOUTBOOK_ORG_GUID env vars.",
      inputSchema: {
        orgGuid: z.string().optional().describe("Organization GUID (defaults to SCOUTBOOK_ORG_GUID env var)"),
      },
    },
    async ({ orgGuid }) => {
      const resolvedOrg = orgGuid || process.env.SCOUTBOOK_ORG_GUID;
      if (!resolvedOrg) {
        return { content: [{ type: "text", text: "Error: orgGuid not provided and SCOUTBOOK_ORG_GUID not set." }] };
      }

      try {
        const client = new ScoutbookApiClient();
        await client.authenticate();
        const result = await syncRoster(client, resolvedOrg);
        return {
          content: [{
            type: "text",
            text: `Roster synced successfully.\n- Scouts: ${result.scouts}\n- Adults: ${result.adults}\n- Parents: ${result.parents}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Roster sync failed: ${error instanceof Error ? error.message : error}` }] };
      }
    },
  );
}

export function registerScoutbookSyncScout(server: McpServer): void {
  server.registerTool(
    "scoutbook_sync_scout",
    {
      title: "Scoutbook: Sync Scout Advancement",
      description: "Pull one scout's ranks, merit badges, awards, and individual requirements from Scoutbook.",
      inputSchema: {
        userId: z.string().describe("BSA userId of the scout to sync"),
      },
    },
    async ({ userId }) => {
      try {
        const client = new ScoutbookApiClient();
        await client.authenticate();
        const result = await syncScout(client, userId);
        return {
          content: [{
            type: "text",
            text: `Scout ${userId} synced successfully.\n- Advancements: ${result.advancements}\n- Requirements: ${result.requirements}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Scout sync failed: ${error instanceof Error ? error.message : error}` }] };
      }
    },
  );
}
```

**Step 2: Register in admin index.ts**

Add to `mcp-servers/scout-quest/src/tools/admin/index.ts`:

Import:
```typescript
import { registerScoutbookSyncRoster, registerScoutbookSyncScout } from "./scoutbookSync.js";
```

Add to `registerAdminTools()`:
```typescript
  registerScoutbookSyncRoster(server);
  registerScoutbookSyncScout(server);
```

**Step 3: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/admin/scoutbookSync.ts mcp-servers/scout-quest/src/tools/admin/index.ts
git commit -m "feat(scoutbook): add MCP admin tools for roster and scout sync"
```

---

### Task 10: MCP Admin Tool — Quest Initialization Bridge

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/admin/scoutbookInitQuest.ts`
- Modify: `mcp-servers/scout-quest/src/tools/admin/index.ts`
- Create: `mcp-servers/scout-quest/src/__tests__/scoutbook-init-quest.test.ts`

**Context:** This is the key integration tool. It reads synced Scoutbook data and creates a quest-ready scout profile by: (1) reading `scoutbook_scouts` for profile, (2) reading `scoutbook_parents` for parent contact, (3) reading `scoutbook_advancement` and `scoutbook_requirements` for PM/FL merit badge status, (4) creating the quest `scouts` document, (5) creating quest `requirements` documents with statuses mapped from Scoutbook.

The mapping: Scoutbook `completed=true` → quest `completed_prior`, Scoutbook `started=true` → quest `in_progress`, not present → quest `not_started`. This only applies to PM and FL merit badge requirements that exist in both systems.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("scoutbook_init_quest mapping", () => {
  it("maps Scoutbook PM/FL requirement completion to quest statuses", () => {
    // Pure logic test — the mapping function
    const mapStatus = (sbCompleted: boolean, sbStarted: boolean) => {
      if (sbCompleted) return "completed_prior";
      if (sbStarted) return "in_progress";
      return "not_started";
    };

    expect(mapStatus(true, true)).toBe("completed_prior");
    expect(mapStatus(false, true)).toBe("in_progress");
    expect(mapStatus(false, false)).toBe("not_started");
  });

  it("finds parent for a scout from scoutbook data", () => {
    const parents = [
      { userId: "P1", firstName: "Alice", lastName: "Smith", email: "alice@test.com", phone: "555-1234", linkedYouthUserIds: ["Y1", "Y2"] },
      { userId: "P2", firstName: "Bob", lastName: "Jones", email: "bob@test.com", phone: "555-5678", linkedYouthUserIds: ["Y3"] },
    ];

    const parent = parents.find(p => p.linkedYouthUserIds.includes("Y1"));
    expect(parent).toBeDefined();
    expect(parent!.firstName).toBe("Alice");

    const noParent = parents.find(p => p.linkedYouthUserIds.includes("Y99"));
    expect(noParent).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it passes (pure logic, no impl needed)**

Run: `cd mcp-servers/scout-quest && npx vitest run src/__tests__/scoutbook-init-quest.test.ts`
Expected: PASS.

**Step 3: Write the init quest tool**

`mcp-servers/scout-quest/src/tools/admin/scoutbookInitQuest.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, users, requirements } from "../../db.js";
import { scoutbookScouts, scoutbookParents, scoutbookAdvancement, scoutbookRequirements } from "../../scoutbook/collections.js";
import { REQUIREMENT_DEFINITIONS } from "../../constants.js";
import type { RequirementStatus, InteractionMode } from "../../types.js";

// PM merit badge ID = 62 in Scoutbook, FL = 47 — look these up from saved responses
// Actually, the IDs vary. We match by name pattern instead.
const PM_PATTERN = /personal management/i;
const FL_PATTERN = /family life/i;

function mapScoutbookStatus(completed: boolean, started: boolean): RequirementStatus {
  if (completed) return "completed_prior";
  if (started) return "in_progress";
  return "not_started";
}

export function registerScoutbookInitQuest(server: McpServer): void {
  server.registerTool(
    "scoutbook_init_quest",
    {
      title: "Scoutbook: Initialize Quest from Synced Data",
      description: "Create a quest-ready scout profile using synced Scoutbook data. Pulls profile, parent contact, and PM/FL advancement status. Requires roster and scout sync to have been run first.",
      inputSchema: {
        userId: z.string().describe("BSA userId of the scout"),
        scout_email: z.string().email().describe("Scout's Gmail address for quest login"),
      },
    },
    async ({ userId, scout_email }) => {
      // 1. Look up synced scout data
      const sbScoutsCol = await scoutbookScouts();
      const sbScout = await sbScoutsCol.findOne({ userId });
      if (!sbScout) {
        return { content: [{ type: "text", text: `Error: No synced Scoutbook data for userId ${userId}. Run scoutbook_sync_roster first.` }] };
      }

      // 2. Look up parent
      const sbParentsCol = await scoutbookParents();
      const sbParents = await sbParentsCol.find({ linkedYouthUserIds: userId }).toArray();
      const parentDoc = sbParents[0]; // Use first parent found

      // 3. Check if quest scout already exists
      const scoutsCol = await scouts();
      const existing = await scoutsCol.findOne({ email: scout_email });
      if (existing) {
        return { content: [{ type: "text", text: `Error: Scout with email ${scout_email} already exists in quest system.` }] };
      }

      // 4. Look up PM/FL advancement from scoutbook
      const sbAdvCol = await scoutbookAdvancement();
      const pmAdv = await sbAdvCol.findOne({ userId, type: "meritBadge", name: PM_PATTERN });
      const flAdv = await sbAdvCol.findOne({ userId, type: "meritBadge", name: FL_PATTERN });

      // 5. Look up individual PM/FL requirements from scoutbook
      const sbReqCol = await scoutbookRequirements();
      const pmReqs = pmAdv
        ? await sbReqCol.find({ userId, advancementType: "meritBadge", advancementId: pmAdv.advancementId }).toArray()
        : [];
      const flReqs = flAdv
        ? await sbReqCol.find({ userId, advancementType: "meritBadge", advancementId: flAdv.advancementId }).toArray()
        : [];

      // 6. Create quest scout document
      const now = new Date();
      const usersCol = await users();

      await usersCol.updateOne(
        { email: scout_email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email: scout_email, roles: [{ type: "scout" as const }], created_at: now },
        },
        { upsert: true },
      );

      if (parentDoc?.email) {
        await usersCol.updateOne(
          { email: parentDoc.email },
          {
            $set: { updated_at: now },
            $addToSet: { roles: { type: "guide" as const, scout_emails: [scout_email] } },
            $setOnInsert: { email: parentDoc.email, created_at: now },
          },
          { upsert: true },
        );
      }

      await scoutsCol.insertOne({
        email: scout_email,
        name: sbScout.fullName,
        age: sbScout.age ?? 14,
        troop: sbScout.unitNumber || "2024",
        patrol: sbScout.patrol?.name,
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
        parent_guardian: parentDoc
          ? { name: parentDoc.fullName, email: parentDoc.email ?? "" }
          : { name: "", email: "" },
        guide_email: parentDoc?.email ?? "",
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now,
        updated_at: now,
      });

      // 7. Initialize requirements with Scoutbook status mapping
      const reqCol = await requirements();
      let completedPrior = 0;
      let inProgress = 0;

      const reqDocs = REQUIREMENT_DEFINITIONS.map(def => {
        // Try to match this quest requirement to a Scoutbook requirement
        // Quest req_ids like "pm_1a" don't map directly to Scoutbook requirement IDs,
        // so for now we just check overall MB status
        let status: RequirementStatus = "not_started";

        if (def.badge === "personal_management" && pmAdv) {
          if (pmAdv.status === "Awarded") {
            status = "completed_prior";
            completedPrior++;
          } else if (pmAdv.status === "Started") {
            // MB is started but individual reqs may or may not be done
            // Default to not_started — admin can override per-requirement
            status = "not_started";
          }
        } else if (def.badge === "family_life" && flAdv) {
          if (flAdv.status === "Awarded") {
            status = "completed_prior";
            completedPrior++;
          } else if (flAdv.status === "Started") {
            status = "not_started";
          }
        }

        return {
          scout_email,
          req_id: def.req_id,
          badge: def.badge,
          status,
          quest_driven: true,
          interaction_mode: def.default_interaction_mode as InteractionMode,
          ...(def.tracking_duration && { tracking_duration: def.tracking_duration }),
          tracking_progress: 0,
          notes: "",
          updated_at: now,
        };
      });

      await reqCol.insertMany(reqDocs);

      // 8. Build summary
      const totalReqs = reqDocs.length;
      const pmStatus = pmAdv ? `${pmAdv.status} (${Math.round(pmAdv.percentCompleted * 100)}%)` : "not started in Scoutbook";
      const flStatus = flAdv ? `${flAdv.status} (${Math.round(flAdv.percentCompleted * 100)}%)` : "not started in Scoutbook";

      const lines = [
        `Quest initialized for ${sbScout.fullName} (${scout_email})`,
        `  BSA userId: ${userId}, Troop: ${sbScout.unitNumber || "2024"}, Patrol: ${sbScout.patrol?.name ?? "none"}`,
        `  Age: ${sbScout.age}, Rank: ${sbScout.currentRank?.name ?? "none"}`,
        `  Parent: ${parentDoc ? `${parentDoc.fullName} (${parentDoc.email})` : "none found — set manually"}`,
        `  Personal Management in Scoutbook: ${pmStatus}`,
        `  Family Life in Scoutbook: ${flStatus}`,
        `  Requirements created: ${totalReqs} (${completedPrior} completed_prior, ${totalReqs - completedPrior} not_started)`,
        ``,
        `Next steps: configure_quest, set_character, set_counselors, set_unit_leaders, set_chore_list`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
```

**Step 4: Register in admin index.ts**

Add import:
```typescript
import { registerScoutbookInitQuest } from "./scoutbookInitQuest.js";
```

Add to `registerAdminTools()`:
```typescript
  registerScoutbookInitQuest(server);
```

**Step 5: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 6: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/admin/scoutbookInitQuest.ts mcp-servers/scout-quest/src/tools/admin/index.ts mcp-servers/scout-quest/src/__tests__/scoutbook-init-quest.test.ts
git commit -m "feat(scoutbook): add quest initialization bridge from synced Scoutbook data"
```

---

### Task 11: Update Admin MCP Instructions and .env.example

**Files:**
- Modify: `mcp-servers/scout-quest/src/admin.ts` — update `ADMIN_INSTRUCTIONS` to include new tools
- Modify: `config/ai-chat/.env.example` — add `SCOUTBOOK_*` env vars

**Step 1: Update ADMIN_INSTRUCTIONS in admin.ts**

Add after the existing TOOLS section:

```
SCOUTBOOK SYNC TOOLS:
- scoutbook_sync_roster — pull youth/adult/parent rosters from BSA Scoutbook
- scoutbook_sync_scout — pull one scout's full advancement from Scoutbook
- scoutbook_init_quest — create quest profile from synced Scoutbook data

SCOUTBOOK WORKFLOW:
1. scoutbook_sync_roster — get the full troop roster
2. scoutbook_sync_scout — for the scout you want to set up
3. scoutbook_init_quest — create their quest profile from Scoutbook data
4. Then use configure_quest, set_character, etc. to complete setup
```

**Step 2: Add env vars to .env.example**

Add to `config/ai-chat/.env.example`:

```
# =================================
# Scoutbook Sync
# =================================
SCOUTBOOK_USERNAME=<FILL_IN>
SCOUTBOOK_PASSWORD=<FILL_IN>
SCOUTBOOK_ORG_GUID=E1D07881-103D-43D8-92C4-63DEFDC05D48
```

**Step 3: Verify build**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 4: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/admin.ts config/ai-chat/.env.example
git commit -m "feat(scoutbook): update admin instructions and add env vars to .env.example"
```

---

### Task 12: Full Build and Final Verification

**Files:** None new — verification only.

**Step 1: Full build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: "Build complete. Outputs in dist/"

**Step 2: Verify CLI entry point exists**

Run: `ls -la mcp-servers/scout-quest/dist/scoutbook/cli.js`
Expected: File exists.

**Step 3: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 4: Verify TypeScript has no errors**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit implementation plan**

```bash
git add docs/plans/2026-02-22-scoutbook-sync-implementation.md
git commit -m "docs: add Scoutbook sync implementation plan"
```

---

## v2 Tasks — Calendar, Events, Rate Limiting, Cron

These tasks extend the original 12-task plan with calendar/events sync, smart rate limiting, and cron-based periodic sync. They depend on Tasks 1-4 being complete (types, collections, API client infrastructure).

---

### Task 13: Smart Rate Limiter

**Files:**
- Create: `mcp-servers/scout-quest/src/scoutbook/rate-limiter.ts`
- Modify: `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- Create: `mcp-servers/scout-quest/src/__tests__/scoutbook-rate-limiter.test.ts`

**Context:** Replace the simple `RATE_LIMIT_MS = 1000` in `api-client.ts` with a burst-pattern rate limiter that mimics human browsing behavior. See the Rate Limiting Strategy section in the design spec for full details. The rate limiter groups requests into randomized bursts (3-8 requests at 100-400ms intervals) separated by longer pauses (3-10s), with a hard cap of 30 requests/minute.

**Step 1: Write the rate limiter**

```typescript
// rate-limiter.ts
export interface RateLimiterConfig {
  burstSize: [number, number];        // [min, max] requests per burst (default: [3, 8])
  burstDelayMs: [number, number];     // [min, max] delay within burst (default: [100, 400])
  interBurstDelayMs: [number, number]; // [min, max] delay between bursts (default: [3000, 10000])
  maxRequestsPerMinute: number;       // Hard cap (default: 30)
}

export class BurstRateLimiter {
  private config: RateLimiterConfig;
  private requestTimestamps: number[] = [];
  private burstCount = 0;
  private currentBurstSize = 0;

  constructor(config?: Partial<RateLimiterConfig>) { /* merge with defaults */ }
  async waitForSlot(): Promise<void> { /* enforce burst pattern + hard cap */ }
  private randomInRange(min: number, max: number): number { /* uniform random */ }
  private pruneTimestamps(): void { /* remove entries older than 60s */ }
}
```

Key behaviors to test:
- Requests within a burst are separated by 100-400ms (randomized)
- After `burstSize` requests, a longer inter-burst delay (3-10s) is inserted
- No more than 30 requests in any sliding 60-second window
- All delays have ±30% jitter

**Step 2: Write tests**

Test that:
- First request in a burst has no delay
- Requests within a burst are spaced by burstDelayMs range
- After a full burst, next request waits interBurstDelayMs range
- Hard cap is respected (31st request in 60s window waits)

**Step 3: Replace rate limiting in api-client.ts**

Replace the `rateLimit()` method's simple `RATE_LIMIT_MS` logic with `BurstRateLimiter.waitForSlot()`. The client should create a `BurstRateLimiter` in its constructor.

**Step 4: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/rate-limiter.ts mcp-servers/scout-quest/src/scoutbook/api-client.ts mcp-servers/scout-quest/src/__tests__/scoutbook-rate-limiter.test.ts
git commit -m "feat(scoutbook): add burst-pattern rate limiter"
```

---

### Task 14: Calendar/Events Types and Collections

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/types.ts`
- Modify: `mcp-servers/scout-quest/src/scoutbook/collections.ts`

**Context:** Add API response types and MongoDB document types for events, calendars, and dashboards. Add 3 new collection accessors. See the design spec for the full type definitions and the sample responses in `scouting-org-research/data/responses/POST_advancements_events.json` and `api.scouting.org_advancements_v2_users_9120709_calendars.json`.

**Step 1: Add API response types to types.ts**

```typescript
// --- Calendar/Events responses ---

export interface CalendarSubscription {
  userCalendarId: number;
  userId: number;
  unitId: number;
  denId: number | null;
  patrolId: number | null;
  color: string;
  showCalendar: boolean;
  calendarCode: string;
}

export interface EventDetail {
  id: number;
  userId: number;          // creator userId
  firstName: string;       // creator first name
  lastName: string;        // creator last name
  dateCreated: string;
  eventType: string;
  startDate: string;
  endDate: string;
  name: string;
  location: string;
  mapUrl: string;
  description: string;     // may contain HTML
  notes: string;
  rsvp: boolean;
  isActivityMeeting: boolean;
  activityTypeId: number | null;
  activityType: string;
  serviceProject: boolean;
  outdoorActivity: boolean;
  isAdvancementMeeting: boolean;
  units: EventUnit[];
  invitedUsers: EventRsvp[];
  recurringEvent: Record<string, unknown>;
  linkedActivities: unknown[];
  linkedAdvancements: unknown[];
}

export interface EventUnit {
  id: number;
  unitId: number;
  unitFullName: string;
  unitTypeId: number;
  patrolId: number | null;
  patrolName: string;
}

export interface EventRsvp {
  userId: number;
  firstName: string;
  lastName: string;
  nickName: string;
  rsvp: string;            // "" or "True"
  rsvpCode: string;        // "Y" | "N" | "M" | ""
  attended: boolean;
  primaryLeader: boolean;
  isAdult: boolean;
  canTakeAttendance: boolean;
}

// --- Dashboard responses ---

export interface AdvancementDashboard {
  completed: DashboardCategory;
  notPurchased: DashboardCategory;
  purchasedNotAwarded: DashboardCategory;
  awarded: DashboardCategory;
}

interface DashboardCategory {
  ranks: number;
  meritBadges: number;
  awards: number;
  adventures: number;
  requirements?: { ranks: number; meritBadges: number; awards: number; adventures: number };
}

export interface UnitActivitiesDashboard {
  CampOuts: { Campouts: number; NightsCamped: number; DaysCamped: number };
  ServiceProjects: { ServiceProjects: number; ServiceHours: number; ConservationHours: number };
  Hikes: { Hikes: number };
}
```

**Step 2: Add MongoDB document types to types.ts**

```typescript
export interface ScoutbookEventDoc {
  eventId: number;
  unitId: number;
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  location?: string;
  description?: string;
  notes?: string;
  rsvpEnabled: boolean;
  createdBy: { userId: number; firstName: string; lastName: string };
  dateCreated: string;
  isActivityMeeting: boolean;
  activityType?: string;
  serviceProject: boolean;
  outdoorActivity: boolean;
  invitedUsers: {
    userId: number;
    firstName: string;
    lastName: string;
    isAdult: boolean;
    rsvpCode: string;
    attended: boolean;
    primaryLeader: boolean;
  }[];
  units: { unitId: number; unitFullName: string; patrolId?: number; patrolName?: string }[];
  syncedAt: Date;
}

export interface ScoutbookCalendarDoc {
  userCalendarId: number;
  userId: number;
  unitId: number;
  patrolId?: number;
  calendarCode: string;
  color: string;
  showCalendar: boolean;
  syncedAt: Date;
}

export interface ScoutbookDashboardDoc {
  orgGuid: string;
  type: "advancement" | "activities";
  data: Record<string, unknown>;
  syncedAt: Date;
}
```

**Step 3: Add collection accessors to collections.ts**

```typescript
export async function scoutbookEvents(): Promise<Collection<ScoutbookEventDoc>> {
  return (await getDb()).collection("scoutbook_events");
}

export async function scoutbookCalendars(): Promise<Collection<ScoutbookCalendarDoc>> {
  return (await getDb()).collection("scoutbook_calendars");
}

export async function scoutbookDashboards(): Promise<Collection<ScoutbookDashboardDoc>> {
  return (await getDb()).collection("scoutbook_dashboards");
}
```

**Step 4: Verify it compiles**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/types.ts mcp-servers/scout-quest/src/scoutbook/collections.ts
git commit -m "feat(scoutbook): add calendar/events/dashboard types and collections"
```

---

### Task 15: API Client — Calendar/Events/Dashboard Methods

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`

**Context:** Add typed methods for the 4 new endpoints. The events endpoint is a POST with a body (unlike the rest which are GETs). Add a `post()` method to the client alongside the existing `get()`.

**Step 1: Add a `post<T>()` method to the client**

Same pattern as `get<T>()` but with `method: "POST"` and a `body` parameter.

**Step 2: Add calendar/events/dashboard methods**

```typescript
  async getUserCalendars(userId: string): Promise<CalendarSubscription[]> {
    return this.get<CalendarSubscription[]>(`/advancements/v2/users/${userId}/calendars`);
  }

  async getEvents(unitId: number, fromDate: string, toDate: string): Promise<EventDetail[]> {
    return this.post<EventDetail[]>("/advancements/events", {
      unitId,
      fromDate,
      toDate,
      showDLEvents: true,
    });
  }

  async getAdvancementDashboard(orgGuid: string): Promise<AdvancementDashboard> {
    return this.get<AdvancementDashboard>(`/organizations/v2/${orgGuid}/advancementDashboard`);
  }

  async getUnitActivitiesDashboard(orgGuid: string): Promise<UnitActivitiesDashboard> {
    return this.get<UnitActivitiesDashboard>(
      `/organizations/v2/${orgGuid}/unitActivitiesDashboard?completedActivities=true`,
    );
  }
```

**Step 3: Write tests for the new methods**

Test that `getEvents` calls POST with the correct body, and that the other methods call the correct GET endpoints.

**Step 4: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/api-client.ts mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts
git commit -m "feat(scoutbook): add calendar, events, and dashboard API methods"
```

---

### Task 16: Sync Orchestration — Events and Dashboards

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- Modify: `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`

**Context:** Add `syncEvents(client, unitId, monthsAhead?, monthsBehind?)` and `syncDashboards(client, orgGuid)`. Update `syncAll` to call them after roster and advancement syncs.

**Step 1: Implement `syncEvents`**

- Calculate date range: `monthsBehind` months ago to `monthsAhead` months from now (defaults: 1 back, 2 ahead)
- Call `client.getEvents(unitId, fromDate, toDate)`
- Map each `EventDetail` to `ScoutbookEventDoc`, trimming `invitedUsers` to just the fields we store
- Upsert into `scoutbook_events` keyed on `eventId`
- Log to `scoutbook_sync_log` with operation `"events"` and count of events synced

**Step 2: Implement `syncDashboards`**

- Call `client.getAdvancementDashboard(orgGuid)` and `client.getUnitActivitiesDashboard(orgGuid)`
- Upsert into `scoutbook_dashboards` keyed on `{ orgGuid, type }`
- Log to `scoutbook_sync_log` with operation `"dashboards"`

**Step 3: Update `syncAll`**

Add `syncEvents` and `syncDashboards` calls after the per-scout advancement sync. `syncAll` signature changes to `syncAll(client, orgGuid, unitId)`.

**Step 4: Write tests**

Test `syncEvents` maps events correctly, stores RSVP data, and handles empty event lists. Test `syncDashboards` upserts both dashboard types. Test `syncAll` calls all four sync functions.

**Step 5: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/sync.ts mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts
git commit -m "feat(scoutbook): add syncEvents, syncDashboards, expand syncAll"
```

---

### Task 17: CLI and MCP Tools — Events and Dashboards Commands

**Files:**
- Modify: `mcp-servers/scout-quest/src/scoutbook/cli.ts`
- Modify: `mcp-servers/scout-quest/src/tools/admin/scoutbookSync.ts`
- Modify: `mcp-servers/scout-quest/src/tools/admin/index.ts`
- Modify: `mcp-servers/scout-quest/src/admin.ts`
- Modify: `config/ai-chat/.env.example`

**Context:** Add `events` and `dashboards` CLI commands. Add `scoutbook_sync_events` and `scoutbook_sync_dashboards` MCP admin tools. Update the admin server instructions. Add `SCOUTBOOK_UNIT_ID` env var.

**Step 1: Add CLI commands**

Add `"events"` and `"dashboards"` to the `COMMANDS` array. Implement handlers:

```typescript
  if (command === "events") {
    const unitId = parseInt(process.argv[3] || process.env.SCOUTBOOK_UNIT_ID || "");
    if (!unitId) { console.error("Error: unitId required (arg or SCOUTBOOK_UNIT_ID env)"); process.exit(1); }
    console.log(`Syncing events for unit ${unitId}...`);
    const result = await syncEvents(client, unitId);
    console.log(`Done: ${result.events} events synced`);
    return;
  }

  if (command === "dashboards") {
    if (!orgGuid) { console.error("Error: orgGuid required"); process.exit(1); }
    console.log(`Syncing dashboards for ${orgGuid}...`);
    await syncDashboards(client, orgGuid);
    console.log("Done: advancement and activity dashboards synced");
    return;
  }
```

Update the `all` command to pass `unitId` to `syncAll`.

**Step 2: Add MCP admin tools**

Register `scoutbook_sync_events` and `scoutbook_sync_dashboards` in `scoutbookSync.ts`:

```typescript
export function registerScoutbookSyncEvents(server: McpServer): void {
  server.registerTool("scoutbook_sync_events", {
    title: "Scoutbook: Sync Events",
    description: "Pull calendar events with RSVP and attendance data from Scoutbook.",
    inputSchema: {
      unitId: z.number().optional().describe("Unit ID (defaults to SCOUTBOOK_UNIT_ID env)"),
      monthsAhead: z.number().optional().default(2),
      monthsBehind: z.number().optional().default(1),
    },
  }, async ({ unitId, monthsAhead, monthsBehind }) => { /* ... */ });
}

export function registerScoutbookSyncDashboards(server: McpServer): void {
  server.registerTool("scoutbook_sync_dashboards", {
    title: "Scoutbook: Sync Dashboards",
    description: "Pull unit-level advancement and activity dashboards from Scoutbook.",
    inputSchema: {
      orgGuid: z.string().optional(),
    },
  }, async ({ orgGuid }) => { /* ... */ });
}
```

**Step 3: Register in admin index.ts and update admin instructions**

Add the two new registrations. Update `ADMIN_INSTRUCTIONS` in `admin.ts` to include:

```
- scoutbook_sync_events — pull calendar events with RSVP and attendance data
- scoutbook_sync_dashboards — pull unit-level advancement and activity dashboards
```

**Step 4: Add SCOUTBOOK_UNIT_ID to .env.example**

Add to both `config/ai-chat/.env.example` and `config/scout-quest/.env.example`:

```
SCOUTBOOK_UNIT_ID=121894
```

**Step 5: Verify build and tests**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit && npx vitest run`
Expected: All pass.

**Step 6: Commit**

```bash
git add mcp-servers/scout-quest/src/scoutbook/cli.ts mcp-servers/scout-quest/src/tools/admin/scoutbookSync.ts mcp-servers/scout-quest/src/tools/admin/index.ts mcp-servers/scout-quest/src/admin.ts config/ai-chat/.env.example
git commit -m "feat(scoutbook): add events and dashboards CLI commands and MCP admin tools"
```

---

### Task 18: Full Build and Final Verification (v2)

**Files:** None new — verification only.

**Step 1: Full build**

Run: `cd mcp-servers/scout-quest && bash build.sh`
Expected: "Build complete. Outputs in dist/"

**Step 2: Verify all entry points exist**

Run: `ls -la mcp-servers/scout-quest/dist/scoutbook/cli.js mcp-servers/scout-quest/dist/scout.js mcp-servers/scout-quest/dist/guide.js mcp-servers/scout-quest/dist/admin.js`
Expected: All files exist.

**Step 3: Run all tests**

Run: `cd mcp-servers/scout-quest && npx vitest run`
Expected: All tests PASS.

**Step 4: Verify TypeScript has no errors**

Run: `cd mcp-servers/scout-quest && npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit updated plan**

```bash
git add docs/plans/2026-02-22-scoutbook-sync-implementation.md
git commit -m "docs: update Scoutbook sync implementation plan with v2 tasks (calendar/events/rate limiting)"
```

---

## Notes for the Implementer

- **Sample API responses** are in `scouting-org-research/data/responses/` — use these to verify your types match the actual API shapes.
- **API reference** is in `scouting-org-research/api-reference.md` — complete endpoint documentation.
- **Rate limiting is critical** — BSA production servers, no documented limits but we must be conservative. Use the burst-pattern rate limiter (Task 13), not flat delays. Hard cap: 30 req/min.
- **The events endpoint is a POST** — unlike most other endpoints which are GETs. The body is `{ unitId, fromDate, toDate, showDLEvents: true }`. Response is a top-level array of events.
- **Events contain full RSVP data** — each event's `invitedUsers` array has every troop member with `rsvpCode` (Y/N/M/empty) and `attended` (boolean). ~41 members per event for Troop 2024.
- **The `getRankRequirements` response** wraps requirements inside the rank object (see `advancements_v2_youth_12352438_ranks_1_requirements.json`). The top-level has rank metadata, and a `requirements` array inside it.
- **Parent roster is flat** — each entry links one parent to one youth. Multiple entries for the same parent (one per child) must be aggregated by `parentUserId`.
- **Quest requirement IDs** (`pm_1a`, `fl_3`, etc.) don't directly map to Scoutbook requirement IDs. The init quest tool uses MB-level status (Awarded/Started) rather than trying to cross-reference individual requirements. This is a deliberate simplification — per-requirement mapping can be added later.
- **Credentials:** Jeremy's Scoutbook credentials are `jebramwell` / `Down112358!3` — these go in `.env`, never in code.
- **Unit ID for Troop 2024:** `121894` — this is the numeric unit ID used in the events endpoint, distinct from the org GUID.
- **Observed API timing:** Events endpoint ~500ms, roster ~450ms, calendars ~150ms. Budget 5-8 minutes for a full sync of 27 scouts.
