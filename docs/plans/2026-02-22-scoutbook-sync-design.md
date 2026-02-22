# Scoutbook Sync — Design Spec

**Date:** 2026-02-22
**Status:** Approved
**Purpose:** Pull scout profiles, parent contacts, and advancement data from BSA's undocumented API to bootstrap quest initialization and maintain a local mirror of troop data.

## Background

Scouting America's API at `api.scouting.org` (reverse-engineered from Chrome DevTools HAR captures) provides REST endpoints for rosters, advancement, and profiles. Authentication is via JWT obtained from `my.scouting.org` username/password login. Full API documentation is in `scouting-org-research/api-reference.md` with 52+ saved response bodies in `scouting-org-research/data/responses/`.

## Architecture

The sync tool lives inside the existing `mcp-servers/scout-quest` package — no new npm project. It shares the MongoDB connection, types, and build system. Two interfaces: a standalone CLI for manual/cron use, and MCP admin tools for use via ai-chat.

```
mcp-servers/scout-quest/src/
├── scoutbook/                   # All sync logic
│   ├── api-client.ts            # HTTP client with auth, rate limiting
│   ├── types.ts                 # BSA API response types
│   ├── sync.ts                  # Core sync orchestration
│   ├── collections.ts           # MongoDB collection accessors (scoutbook_*)
│   └── cli.ts                   # CLI entry point
├── tools/admin/
│   ├── scoutbookSync.ts         # MCP tool wrappers
│   └── ...existing...
└── ...existing...
```

Build produces `dist/scoutbook/cli.js` as a separate entry point, same pattern as `admin.ts`, `scout.ts`, `guide.ts`, `cron.ts`.

## API Client

`ScoutbookApiClient` in `api-client.ts`:

- **Auth:** Reads `SCOUTBOOK_USERNAME` + `SCOUTBOOK_PASSWORD` from env. Authenticates via `POST https://my.scouting.org/api/users/{username}/authenticate`. Caches JWT in memory, auto-refreshes when <30 min from expiry.
- **Rate limiting:** 1 request/second max, sequential (no parallel requests). BSA production servers have no documented rate limits but we must be conservative.
- **Retry:** On 401 → one re-auth attempt then fail. On 429 or network error → exponential backoff (2s, 4s, 8s), max 3 retries.
- **Headers:** `Authorization: bearer {JWT}`, `Origin: https://advancements.scouting.org`, `Referer: https://advancements.scouting.org/`, `Content-Type: application/json`, `Accept: application/json`.

### Methods

```typescript
class ScoutbookApiClient {
  authenticate(): Promise<void>
  getMyScouts(): Promise<LinkedScout[]>
  getYouthRoster(orgGuid: string): Promise<YouthMember[]>
  getAdultRoster(orgGuid: string): Promise<AdultMember[]>
  getParentRoster(orgGuid: string): Promise<ParentMember[]>
  getPatrols(orgGuid: string): Promise<Patrol[]>
  getScoutRanks(userId: string): Promise<RankProgress[]>
  getScoutMeritBadges(userId: string): Promise<MeritBadgeProgress[]>
  getScoutAwards(userId: string): Promise<AwardProgress[]>
  getRankRequirements(userId: string, rankId: number): Promise<RequirementCompletion[]>
  getMeritBadgeRequirements(userId: string, mbId: number): Promise<RequirementCompletion[]>
  getActivitySummary(userId: string): Promise<ActivitySummary>
  getPersonProfile(userId: string): Promise<PersonProfile>
}
```

### API Endpoints Used

| Method | Endpoint | Auth |
|--------|----------|------|
| Auth | `POST my.scouting.org/api/users/{username}/authenticate` | No |
| Youth roster | `GET /organizations/v2/units/{orgGuid}/youths` | Yes |
| Adult roster | `GET /organizations/v2/units/{orgGuid}/adults` | Yes |
| Parent roster | `GET /organizations/v2/units/{orgGuid}/parents` | Yes |
| Patrols | `GET /organizations/v2/units/{orgGuid}/subUnits` | Yes |
| My scouts | `GET /persons/{userId}/myScout` | Yes |
| Scout ranks | `GET /advancements/v2/youth/{userId}/ranks` | Yes |
| Rank reqs | `GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements` | Yes |
| Scout MBs | `GET /advancements/v2/youth/{userId}/meritBadges` | Yes |
| MB reqs | `GET /advancements/v2/youth/{userId}/meritBadges/{mbId}/requirements` | Yes |
| Scout awards | `GET /advancements/v2/youth/{userId}/awards` | Yes |
| Activity summary | `GET /advancements/v2/{userId}/userActivitySummary` | Yes |
| Person profile | `GET /persons/v2/{userId}/personprofile` | Yes |

## MongoDB Collections

Six new collections, all prefixed `scoutbook_` to separate from quest data. Each document includes `syncedAt: Date` for staleness tracking. Upserts keyed on unique identifiers — re-running sync updates in place, never duplicates.

### `scoutbook_scouts`

Youth members from roster endpoint. Upsert key: `userId`.

```typescript
interface ScoutbookScout {
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
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
  currentRank?: { id: number; name: string; dateEarned?: string };
  positions?: { name: string; patrolId?: number }[];
  swimmingClassification?: string;
  dateJoined?: string;
  syncedAt: Date;
}
```

### `scoutbook_adults`

Adult leaders from roster endpoint. Upsert key: `userId`.

```typescript
interface ScoutbookAdult {
  userId: string;
  memberId: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  orgGuid: string;
  unitNumber: string;
  positions?: { name: string; code: string }[];
  yptStatus?: string;
  yptExpiry?: string;
  syncedAt: Date;
}
```

### `scoutbook_parents`

Parents linked to youth. Upsert key: `userId`.

```typescript
interface ScoutbookParent {
  userId: string;
  memberId?: string;
  personGuid: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  linkedYouthUserIds: string[];
  syncedAt: Date;
}
```

### `scoutbook_advancement`

Rank, merit badge, and award progress per scout. Upsert key: `userId` + `type` + `advancementId`.

```typescript
interface ScoutbookAdvancement {
  userId: string;
  type: "rank" | "meritBadge" | "award";
  advancementId: number;
  name: string;
  versionId?: number;
  status: string;           // "Awarded", "Started", etc.
  percentCompleted: number;  // 0-1
  dateStarted?: string;
  dateCompleted?: string;
  dateAwarded?: string;
  counselorUserId?: string;
  syncedAt: Date;
}
```

### `scoutbook_requirements`

Individual requirement completion status. Upsert key: `userId` + `advancementType` + `advancementId` + `reqId`.

```typescript
interface ScoutbookRequirement {
  userId: string;
  advancementType: "rank" | "meritBadge";
  advancementId: number;
  reqId: string;
  reqName: string;
  parentReqId?: string;
  completed: boolean;
  started: boolean;
  dateCompleted?: string;
  dateStarted?: string;
  leaderApprovedDate?: string;
  leaderApprovedUserId?: string;
  percentCompleted: number;
  syncedAt: Date;
}
```

### `scoutbook_sync_log`

Audit trail of sync operations. Insert-only (append log).

```typescript
interface ScoutbookSyncLog {
  timestamp: Date;
  operation: "roster" | "scout" | "all" | "auth_test";
  orgGuid?: string;
  userId?: string;
  result: "success" | "partial" | "error";
  counts?: { scouts?: number; adults?: number; parents?: number; advancements?: number; requirements?: number };
  error?: string;
  durationMs: number;
}
```

## Sync Operations

### `syncRoster(orgGuid)`

Pulls youth + adult + parent rosters and patrols. Upserts into `scoutbook_scouts`, `scoutbook_adults`, `scoutbook_parents`. ~5 API calls.

### `syncScout(userId)`

Pulls one scout's full advancement:
1. Ranks progress → upsert `scoutbook_advancement` (type: rank)
2. For each started/awarded rank → pull requirements → upsert `scoutbook_requirements`
3. Merit badges progress → upsert `scoutbook_advancement` (type: meritBadge)
4. For each started/completed MB → pull requirements → upsert `scoutbook_requirements`
5. Awards → upsert `scoutbook_advancement` (type: award)
6. Activity summary → stored on `scoutbook_scouts` as embedded fields
7. Person profile → merge into `scoutbook_scouts`

~5-15 API calls depending on number of started advancements.

### `syncAll(orgGuid)`

Runs `syncRoster(orgGuid)`, then `syncScout(userId)` for every youth in the roster. Rate-limited at 1 req/sec. For 27 youth: ~100-200 API calls, ~3-5 minutes.

All operations log to `scoutbook_sync_log`.

## CLI Interface

Entry point: `node dist/scoutbook/cli.js <command>`

```
Commands:
  auth              Test authentication, print token info and expiry
  roster [orgGuid]  Sync troop roster (defaults to SCOUTBOOK_ORG_GUID env)
  scout <userId>    Sync one scout's full advancement
  all [orgGuid]     Full sync: roster + all youth advancement
  status            Print last sync timestamps and record counts
```

Environment variables: `SCOUTBOOK_USERNAME`, `SCOUTBOOK_PASSWORD`, `SCOUTBOOK_ORG_GUID`, `MONGO_URI`.

## MCP Admin Tools

Three new tools registered on the admin MCP server (in `tools/admin/scoutbookSync.ts`):

### `scoutbook_sync_roster`

Triggers roster sync for the configured org. Returns summary: new members, updated members, total counts.

Input: `orgGuid` (optional, defaults to env).

### `scoutbook_sync_scout`

Syncs one scout's advancement data.

Input: `userId` (required).

Returns: advancement summary (ranks, MBs, awards with statuses).

### `scoutbook_init_quest`

The integration bridge — reads synced Scoutbook data and creates a quest-ready scout profile:

1. Reads `scoutbook_scouts` for profile (name, age, patrol, DOB)
2. Reads `scoutbook_parents` for parent contact info
3. Reads `scoutbook_advancement` for PM/FL merit badge status
4. Reads `scoutbook_requirements` for individual PM/FL requirement completion
5. Creates the `scouts` document (reuses `create_scout` logic, pre-filled)
6. Creates `requirements` documents with statuses mapped from Scoutbook:

| Scoutbook status | Quest status |
|-----------------|--------------|
| `completed=true` | `completed_prior` |
| `started=true, completed=false` | `in_progress` |
| Not present / not started | `not_started` |

Input: `userId` (required), `scout_email` (required — their Gmail for quest login).

Returns: created scout summary with pre-filled fields and requirement status counts.

## Auth & Security

- Credentials stored in `.env` files (synced via GCS, never in git)
- JWT cached in memory only — no disk persistence
- CLI reads env vars directly; MCP tools inherit from LibreChat container process env
- New env vars added to `.env.example`: `SCOUTBOOK_USERNAME`, `SCOUTBOOK_PASSWORD`, `SCOUTBOOK_ORG_GUID`

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Auth failure (bad credentials) | Clear error message, suggest checking SCOUTBOOK_USERNAME/PASSWORD |
| 401 during request | Attempt one re-auth, then fail with context |
| 429 / rate limit | Exponential backoff (2s, 4s, 8s), max 3 retries |
| Network error | Fail immediately with error context |
| Partial sync failure | Log successes, report failures, don't rollback successful upserts |
| Missing env vars | Fail fast at startup with list of missing vars |

## Future Considerations (not in scope)

- **Scoutbook Plus import file generation** — pipe-delimited format for pushing quest-completed advancements back to Scoutbook. Deferred until quest system is in active use.
- **Automated cron sync** — periodic background sync to keep mirror fresh. Can be added to existing `cron.ts` pipeline later.
- **Webhook/change detection** — BSA API has no webhooks; would need polling with diff detection.
