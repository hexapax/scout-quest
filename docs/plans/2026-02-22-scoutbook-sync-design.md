# Scoutbook Sync — Design Spec

**Date:** 2026-02-22
**Status:** Approved (Expanding — v2 adds calendar/events and smart rate limiting)
**Purpose:** Pull scout profiles, parent contacts, advancement data, calendar/events, and activity summaries from BSA's undocumented API to maintain a comprehensive local mirror of troop data. This is the data backbone of the Scout Quest system.

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
  // v2 additions — Calendar/Events
  getUserCalendars(userId: string): Promise<CalendarSubscription[]>
  getEvents(unitId: number, fromDate: string, toDate: string): Promise<EventDetail[]>
  getAdvancementDashboard(orgGuid: string): Promise<AdvancementDashboard>
  getUnitActivitiesDashboard(orgGuid: string): Promise<UnitActivitiesDashboard>
}
```

### API Endpoints Used

| Method | Endpoint | Auth | Category |
|--------|----------|------|----------|
| Auth | `POST my.scouting.org/api/users/{username}/authenticate` | No | Auth |
| Youth roster | `GET /organizations/v2/units/{orgGuid}/youths` | Yes | Roster |
| Adult roster | `GET /organizations/v2/units/{orgGuid}/adults` | Yes | Roster |
| Parent roster | `GET /organizations/v2/units/{orgGuid}/parents` | Yes | Roster |
| Patrols | `GET /organizations/v2/units/{orgGuid}/subUnits` | Yes | Roster |
| My scouts | `GET /persons/{userId}/myScout` | Yes | Roster |
| Scout ranks | `GET /advancements/v2/youth/{userId}/ranks` | Yes | Advancement |
| Rank reqs | `GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements` | Yes | Advancement |
| Scout MBs | `GET /advancements/v2/youth/{userId}/meritBadges` | Yes | Advancement |
| MB reqs | `GET /advancements/v2/youth/{userId}/meritBadges/{mbId}/requirements` | Yes | Advancement |
| Scout awards | `GET /advancements/v2/youth/{userId}/awards` | Yes | Advancement |
| Activity summary | `GET /advancements/v2/{userId}/userActivitySummary` | Yes | Activity |
| Person profile | `GET /persons/v2/{userId}/personprofile` | Yes | Profile |
| **User calendars** | `GET /advancements/v2/users/{userId}/calendars` | Yes | **Calendar** |
| **Events** | `POST /advancements/events` | Yes | **Calendar** |
| **Advancement dashboard** | `GET /organizations/v2/{orgGuid}/advancementDashboard` | Yes | **Dashboard** |
| **Activities dashboard** | `GET /organizations/v2/{orgGuid}/unitActivitiesDashboard` | Yes | **Dashboard** |

## MongoDB Collections

Nine `scoutbook_*` collections (6 original + 3 new for calendar/dashboards). Each document includes `syncedAt: Date` for staleness tracking. Upserts keyed on unique identifiers — re-running sync updates in place, never duplicates.

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
```

### `scoutbook_events`

Troop calendar events with RSVP and attendance data. Upsert key: `eventId`.

```typescript
interface ScoutbookEventDoc {
  eventId: number;
  unitId: number;
  name: string;
  eventType: string;
  startDate: string;        // ISO 8601
  endDate: string;
  location?: string;
  description?: string;     // May contain HTML
  notes?: string;
  rsvpEnabled: boolean;
  createdBy: { userId: number; firstName: string; lastName: string };
  dateCreated: string;
  // Activity flags
  isActivityMeeting: boolean;
  activityType?: string;
  serviceProject: boolean;
  outdoorActivity: boolean;
  // Attendance data
  invitedUsers: ScoutbookEventRsvp[];
  // Unit association
  units: { unitId: number; unitFullName: string; patrolId?: number; patrolName?: string }[];
  syncedAt: Date;
}

interface ScoutbookEventRsvp {
  userId: number;
  firstName: string;
  lastName: string;
  isAdult: boolean;
  rsvp: string;             // "" or "True" (string)
  rsvpCode: string;         // "Y" | "N" | "M" | "" (Yes/No/Maybe/no response)
  attended: boolean;
  primaryLeader: boolean;
}
```

### `scoutbook_calendars`

Calendar subscriptions per user (unit + patrol calendars). Upsert key: `userCalendarId`.

```typescript
interface ScoutbookCalendarDoc {
  userCalendarId: number;
  userId: number;
  unitId: number;
  patrolId?: number;
  calendarCode: string;     // "UnitID121894" or "PatrolID175529"
  color: string;
  showCalendar: boolean;
  syncedAt: Date;
}
```

### `scoutbook_dashboards`

Unit-level dashboard snapshots (advancement + activities). Upsert key: `orgGuid` + `type`.

```typescript
interface ScoutbookDashboardDoc {
  orgGuid: string;
  type: "advancement" | "activities";
  data: Record<string, any>;  // Raw dashboard response — shape differs by type
  syncedAt: Date;
}
```

### `scoutbook_sync_log`

Audit trail of sync operations. Insert-only (append log).

```typescript
interface ScoutbookSyncLog {
  timestamp: Date;
  operation: "roster" | "scout" | "all" | "events" | "dashboards" | "auth_test";
  orgGuid?: string;
  userId?: string;
  result: "success" | "partial" | "error";
  counts?: { scouts?: number; adults?: number; parents?: number; advancements?: number; requirements?: number; events?: number };
  error?: string;
  durationMs: number;
}
```

## Rate Limiting Strategy

BSA's API has no documented rate limits, but we must avoid creating an obvious scraping signature. The strategy uses human-like request patterns:

### Observed Human Patterns (from HAR analysis)

- Average response time: ~266ms per request
- Page loads trigger ~9 API calls in rapid succession (burst)
- Typical browsing session: bursts of 5-15 requests separated by 10-60 seconds of inactivity
- Total requests per session: 50-200 depending on navigation depth

### Sync Rate Limiter

Replace the simple `1 req/sec` with a more realistic pattern:

```typescript
interface RateLimiterConfig {
  minDelayMs: number;       // Minimum delay between requests (default: 500)
  maxDelayMs: number;       // Maximum delay between requests (default: 2000)
  burstSize: number;        // Number of requests in a burst (default: 5)
  burstDelayMs: number;     // Delay between burst requests (default: 200)
  interBurstDelayMs: number; // Delay between bursts (default: 3000-8000 random)
  maxRequestsPerMinute: number; // Hard cap (default: 30)
}
```

**Behavior:**
- Requests are grouped into bursts of 3-8 (randomized)
- Within a burst: 100-400ms between requests (mimics page load)
- Between bursts: 3-10 seconds (mimics human reading/navigating)
- Jitter on all delays: ±30% randomization
- Hard cap: 30 requests/minute (~0.5 req/sec average)
- Full sync of 27 scouts: ~5-8 minutes (vs ~3-5 min at flat 1/sec)

The rate limiter tracks a sliding window of request timestamps for the hard cap and randomizes inter-request delays within the configured bounds.

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

### `syncEvents(unitId, monthsAhead?, monthsBehind?)`

Pulls events for the unit over a configurable window (default: 1 month back, 2 months ahead). Upserts into `scoutbook_events` including full `invitedUsers` with RSVP data. 1 API call per month-range query.

Request body: `{ unitId, fromDate, toDate, showDLEvents: true }`

Each event includes the full troop member list in `invitedUsers` with per-member RSVP (`rsvpCode`: Y/N/M/empty) and attendance. This makes events the richest single data source — one query gives you the calendar AND engagement data.

~1-3 API calls depending on date range.

### `syncDashboards(orgGuid)`

Pulls unit-level advancement dashboard and activities dashboard. Upserts into `scoutbook_dashboards`. 2 API calls.

### `syncAll(orgGuid, unitId)`

Runs all sync operations in order:
1. `syncRoster(orgGuid)` — ~5 API calls
2. `syncScout(userId)` for every youth — ~5-15 calls per scout
3. `syncEvents(unitId)` — ~1-3 API calls
4. `syncDashboards(orgGuid)` — 2 API calls

Rate-limited with human-like burst patterns. For 27 youth: ~120-220 API calls, ~5-8 minutes.

All operations log to `scoutbook_sync_log`.

## CLI Interface

Entry point: `node dist/scoutbook/cli.js <command>`

```
Commands:
  auth              Test authentication, print token info and expiry
  roster [orgGuid]  Sync troop roster (defaults to SCOUTBOOK_ORG_GUID env)
  scout <userId>    Sync one scout's full advancement
  events [unitId]   Sync calendar events and RSVPs (defaults to SCOUTBOOK_UNIT_ID env)
  dashboards [org]  Sync unit-level advancement and activity dashboards
  all [orgGuid]     Full sync: roster + all youth + events + dashboards
  status            Print last sync timestamps and record counts
```

Environment variables: `SCOUTBOOK_USERNAME`, `SCOUTBOOK_PASSWORD`, `SCOUTBOOK_ORG_GUID`, `SCOUTBOOK_UNIT_ID`, `MONGO_URI`.

## MCP Admin Tools

Five new tools registered on the admin MCP server (in `tools/admin/scoutbookSync.ts`):

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

### `scoutbook_sync_events`

Syncs calendar events with RSVP and attendance data for the troop.

Input: `unitId` (optional, defaults to env), `monthsAhead` (optional, default 2), `monthsBehind` (optional, default 1).

Returns: summary of events synced, total RSVP counts.

### `scoutbook_sync_dashboards`

Syncs unit-level advancement and activity dashboards.

Input: `orgGuid` (optional, defaults to env).

Returns: dashboard summary (total ranks awarded, MBs completed, camping nights, etc.).

## Auth & Security

- Credentials stored in `.env` files (synced via GCS, never in git)
- JWT cached in memory only — no disk persistence
- CLI reads env vars directly; MCP tools inherit from LibreChat container process env
- New env vars added to `.env.example`: `SCOUTBOOK_USERNAME`, `SCOUTBOOK_PASSWORD`, `SCOUTBOOK_ORG_GUID`, `SCOUTBOOK_UNIT_ID`

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Auth failure (bad credentials) | Clear error message, suggest checking SCOUTBOOK_USERNAME/PASSWORD |
| 401 during request | Attempt one re-auth, then fail with context |
| 429 / rate limit | Exponential backoff (2s, 4s, 8s), max 3 retries |
| Network error | Fail immediately with error context |
| Partial sync failure | Log successes, report failures, don't rollback successful upserts |
| Missing env vars | Fail fast at startup with list of missing vars |

## Cron Sync Strategy

Periodic background sync added to the existing `cron.ts` pipeline. Different data types have different freshness requirements:

| Data Type | Sync Interval | Rationale |
|-----------|--------------|-----------|
| Events/RSVPs | Every 4 hours | RSVPs change frequently, especially before events |
| Roster | Daily | Members rarely join/leave mid-week |
| Advancement | Daily | Requirements get signed off at meetings |
| Dashboards | Daily | Aggregate stats, low urgency |
| Full sync (all) | Weekly (Sunday night) | Comprehensive refresh before the new week |

Each cron run uses the smart rate limiter and logs to `scoutbook_sync_log`. On-demand sync via MCP admin tools bypasses the schedule for immediate refreshes.

## Future Considerations (not in scope)

- **Scoutbook Plus import file generation** — pipe-delimited format for pushing quest-completed advancements back to Scoutbook. Deferred until quest system is in active use.
- **Write-back to Scoutbook** — RSVP on behalf of scouts, update attendance. Deferred — read-only for now. Revisit if: the API supports write operations reliably and we have user demand.
- **Webhook/change detection** — BSA API has no webhooks; would need polling with diff detection.
- **Per-event sync** — pulling just one event's RSVP updates rather than the full month. Deferred — full month query is efficient enough.
- **Calendar subscription URLs** — using the `calendarCode` values to generate iCal subscription URLs. Low priority but potentially useful.
