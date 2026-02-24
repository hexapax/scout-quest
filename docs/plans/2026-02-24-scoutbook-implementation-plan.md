# Scoutbook Sync — Detailed Implementation Plan

**Date:** 2026-02-24
**Status:** Ready to implement
**Goal:** Build Scoutbook sync so that ai-chat.hexapax.com can query Scoutbook advancement data to prepare for tonight's scout meeting.

## Prerequisites

- Design spec: `docs/plans/2026-02-22-scoutbook-sync-design.md` (Approved)
- Implementation task list: `docs/plans/2026-02-22-scoutbook-sync-implementation.md` (18 tasks, 0 complete on main)
- API reference: `scouting-org-research/api-reference.md` (79 endpoints cataloged)
- Sample responses: `scouting-org-research/data/responses/` (93 JSON files)
- No existing `src/scoutbook/` directory on main — the `feat/scoutbook-sync` branch (with tasks 1-3) was apparently squashed or never merged. Starting fresh from main.

---

## Today's Target Scope

**Minimum viable path to "query Scoutbook advancement data for tonight's meeting":**

| Priority | Task | Why needed | Est. time |
|----------|------|-----------|-----------|
| P0 | Tasks 1-3 | Types, collections, API client with auth | 30 min |
| P0 | Task 4 | Roster + advancement API methods | 15 min |
| P0 | Task 5 | syncRoster orchestration | 20 min |
| P0 | Task 6 | syncScout orchestration | 20 min |
| P0 | Task 7 | syncAll orchestrator | 15 min |
| P0 | Task 8 | CLI entry point | 10 min |
| P0 | Task 9 | MCP admin tools (sync_roster, sync_scout) | 15 min |
| P0 | Task 11 | Update admin instructions + .env.example | 5 min |
| P0 | Task 12 | Build + verify | 10 min |
| **P0 total** | **Tasks 1-9, 11-12** | **Core sync chain** | **~2.5 hrs** |
| P1 | Task 10 | Quest init bridge (nice but not blocking query) | 20 min |
| P2 | Task 13 | Smart rate limiter (upgrade from simple 1/sec) | 30 min |
| P2 | Tasks 14-17 | Calendar/events/dashboards v2 scope | 1.5 hrs |
| P2 | Task 18 | Final v2 build verification | 10 min |

**After P0 is done**, the admin at ai-chat.hexapax.com can:
1. Call `scoutbook_sync_roster` to pull 27 youth + 37 adults + parents
2. Call `scoutbook_sync_scout` for specific scouts to get rank/MB requirements
3. Ask the AI "What rank requirements does Will Bramwell need to work on at tonight's meeting?"

**Deployment requires:** Add 4 env vars to the ai-chat `.env`, rebuild MCP server, push to VM.

---

## Revised Task Breakdown (All 18 Tasks)

### Task 1: BSA API Response Types
- **Create:** `mcp-servers/scout-quest/src/scoutbook/types.ts`
- **Depends on:** Nothing
- **Complexity:** Low (type definitions only, no logic)
- **Content:** ~360 lines. Auth response, roster responses (Youth/Adult/Parent/Patrol), advancement responses (Ranks/MeritBadges/Awards/Requirements), activity summary, linked scouts, plus MongoDB document types for all 6 original collections.
- **Verification:** `npx tsc --noEmit` from `mcp-servers/scout-quest`

### Task 2: MongoDB Collection Accessors
- **Create:** `mcp-servers/scout-quest/src/scoutbook/collections.ts`
- **Depends on:** Task 1 (imports types)
- **Complexity:** Low (6 one-liner functions following `src/db.ts` pattern)
- **Content:** Imports `getDb` from `../db.js`, exports async functions returning typed `Collection<T>` for `scoutbook_scouts`, `scoutbook_adults`, `scoutbook_parents`, `scoutbook_advancement`, `scoutbook_requirements`, `scoutbook_sync_log`.
- **Verification:** `npx tsc --noEmit`

### Task 3: API Client — Auth and Request Infrastructure
- **Create:** `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- **Create:** `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`
- **Depends on:** Task 1 (imports `AuthResponse`)
- **Complexity:** Medium
- **Key decisions:**
  - Auth: `POST https://my.scouting.org/api/users/{username}/authenticate`
  - Rate limit: 1 req/sec (simple for now, upgraded in Task 13)
  - Required headers: `Authorization: bearer {JWT}`, `Origin: https://advancements.scouting.org`, `Referer: https://advancements.scouting.org/`
  - JWT expiry parsed from token payload `exp` claim, auto-refresh when <30min remaining
  - On 401: one re-auth attempt, then throw
  - Uses built-in Node.js `fetch` — no new dependencies
- **Tests:** 5 tests — env var validation, auth flow, auth failure, header injection, rate limiting
- **Verification:** `npx vitest run src/__tests__/scoutbook-api-client.test.ts`

### Task 4: API Client — Roster and Advancement Methods
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- **Modify:** `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`
- **Depends on:** Task 3
- **Complexity:** Low (thin typed wrappers around `get()`)
- **Methods added:**
  - `getYouthRoster(orgGuid)` → `GET /organizations/v2/units/{orgGuid}/youths` → extracts `.users`
  - `getAdultRoster(orgGuid)` → `GET /organizations/v2/units/{orgGuid}/adults` → extracts `.users`
  - `getParentRoster(orgGuid)` → `GET /organizations/v2/units/{orgGuid}/parents` → flat array
  - `getPatrols(orgGuid)` → `GET /organizations/v2/units/{orgGuid}/subUnits`
  - `getScoutRanks(userId)` → `GET /advancements/v2/youth/{userId}/ranks` → flattens `.program[].ranks`
  - `getRankRequirements(userId, rankId)` → `GET /advancements/v2/youth/{userId}/ranks/{rankId}/requirements`
  - `getScoutMeritBadges(userId)` → `GET /advancements/v2/youth/{userId}/meritBadges`
  - `getMeritBadgeRequirements(userId, mbId)` → same pattern
  - `getScoutAwards(userId)` → `GET /advancements/v2/youth/{userId}/awards`
  - `getActivitySummary(userId)` → `GET /advancements/v2/{userId}/userActivitySummary`
- **Tests:** 2 new tests (roster endpoint + ranks extraction)

### Task 5: Sync Orchestration — Roster Sync
- **Create:** `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- **Create:** `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`
- **Depends on:** Tasks 2, 4
- **Complexity:** Medium
- **`syncRoster(client, orgGuid)`:**
  - Fetches youth + adults + parents in parallel (3 API calls)
  - Maps `YouthMember` → `ScoutbookScoutDoc` (extracts patrol from positions, highest rank from `highestRanksAwarded`)
  - Maps `AdultMember` → `ScoutbookAdultDoc`
  - Aggregates `ParentEntry[]` by `parentUserId` → `ScoutbookParentDoc` with `linkedYouthUserIds`
  - Upserts each doc by `{ userId }` using `updateOne` with `{ upsert: true }`
  - Logs to `scoutbook_sync_log` with operation "roster"
  - ~5 API calls total
- **Tests:** 1 test with mocked collections and API client, verifies doc shapes and counts

### Task 6: Sync Orchestration — Scout Advancement
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- **Modify:** `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`
- **Depends on:** Task 5
- **Complexity:** Medium-High
- **`syncScout(client, userId)`:**
  - Fetches ranks + merit badges + awards in parallel
  - For each rank/MB that is Started/Awarded/percentCompleted>0: fetches individual requirements
  - Upserts `scoutbook_advancement` by `{ userId, type, advancementId }`
  - Upserts `scoutbook_requirements` by `{ userId, advancementType, advancementId, reqId }`
  - Fetches activity summary → updates `scoutbook_scouts.activitySummary`
  - ~5-15 API calls depending on started advancements
- **Tests:** 1 test verifying rank/MB/award upserts, requirement upserts, and API call patterns

### Task 7: Sync Orchestration — syncAll
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- **Modify:** `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`
- **Depends on:** Tasks 5, 6
- **Complexity:** Low
- **`syncAll(client, orgGuid)`:**
  - Calls `syncRoster(orgGuid)` first
  - Queries all `userId` values from `scoutbook_scouts` collection
  - Calls `syncScout(userId)` for each, continuing on failures
  - Logs overall result to `scoutbook_sync_log` with operation "all"
  - For 27 youth: ~120-220 API calls, ~3-5 minutes at 1 req/sec
- **Tests:** 1 test with 2 mock scouts, verifies continuation on failure

### Task 8: CLI Entry Point
- **Create:** `mcp-servers/scout-quest/src/scoutbook/cli.ts`
- **Modify:** `mcp-servers/scout-quest/package.json` (add `start:scoutbook` script)
- **Depends on:** Tasks 3, 5, 6, 7
- **Complexity:** Low (thin wrapper, no new logic)
- **Commands:** `auth`, `roster [orgGuid]`, `scout <userId>`, `all [orgGuid]`, `status`
- **Env vars:** `SCOUTBOOK_USERNAME`, `SCOUTBOOK_PASSWORD`, `SCOUTBOOK_ORG_GUID`, `MONGO_URI`
- **No tests needed** — delegates to already-tested sync functions

### Task 9: MCP Admin Tools — Sync Roster and Sync Scout
- **Create:** `mcp-servers/scout-quest/src/tools/admin/scoutbookSync.ts`
- **Modify:** `mcp-servers/scout-quest/src/tools/admin/index.ts`
- **Depends on:** Tasks 5, 6
- **Complexity:** Low
- **Tools:**
  - `scoutbook_sync_roster` — input: `orgGuid` (optional, defaults to env), returns scout/adult/parent counts
  - `scoutbook_sync_scout` — input: `userId` (required), returns advancement/requirement counts
- **Pattern:** Follows existing tools in `tools/admin/` — function takes `McpServer`, registers via `server.registerTool()`, input schema uses zod

### Task 10: MCP Admin Tool — Quest Initialization Bridge
- **Create:** `mcp-servers/scout-quest/src/tools/admin/scoutbookInitQuest.ts`
- **Modify:** `mcp-servers/scout-quest/src/tools/admin/index.ts`
- **Create:** `mcp-servers/scout-quest/src/__tests__/scoutbook-init-quest.test.ts`
- **Depends on:** Tasks 2, 5, 6 (needs synced data to exist)
- **Complexity:** High
- **`scoutbook_init_quest`:**
  - Input: `userId` (BSA), `scout_email` (Gmail for quest login)
  - Reads `scoutbook_scouts` for profile data
  - Reads `scoutbook_parents` for parent contact
  - Reads `scoutbook_advancement` for PM/FL merit badge status
  - Creates `users` doc (scout role) and parent `users` doc (guide role)
  - Creates `scouts` doc with pre-filled profile from Scoutbook
  - Creates `requirements` docs for all PM + FL requirements using `REQUIREMENT_DEFINITIONS` from `constants.ts`
  - Status mapping: Scoutbook `completed=true` → `completed_prior`, `started=true` → `in_progress`, else `not_started`
  - **Note:** Per-requirement cross-referencing is deliberately deferred — uses MB-level status
- **Tests:** Pure logic tests for status mapping and parent-youth linking

### Task 11: Update Admin Instructions and .env.example
- **Modify:** `mcp-servers/scout-quest/src/admin.ts` (ADMIN_INSTRUCTIONS)
- **Modify:** `config/ai-chat/.env.example`
- **Depends on:** Tasks 9, 10
- **Complexity:** Low (config/docs only)
- **Adds:** Scoutbook sync tools and workflow to admin instructions, `SCOUTBOOK_*` env vars to .env.example

### Task 12: Full Build and Final Verification
- **No new files**
- **Depends on:** All P0 tasks
- **Steps:** `bash build.sh`, verify `dist/scoutbook/cli.js` exists, `npx vitest run`, `npx tsc --noEmit`

### Task 13: Smart Rate Limiter (v2)
- **Create:** `mcp-servers/scout-quest/src/scoutbook/rate-limiter.ts`
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- **Create:** `mcp-servers/scout-quest/src/__tests__/scoutbook-rate-limiter.test.ts`
- **Depends on:** Task 3
- **Complexity:** Medium
- **`BurstRateLimiter`:** Groups requests into randomized bursts (3-8) with 100-400ms intervals, 3-10s between bursts, 30 req/min hard cap, ±30% jitter on all delays
- **Replaces:** Simple `RATE_LIMIT_MS = 1000` in api-client.ts

### Task 14: Calendar/Events Types and Collections (v2)
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/types.ts`
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/collections.ts`
- **Depends on:** Tasks 1, 2
- **Complexity:** Low
- **Adds:** `CalendarSubscription`, `EventDetail`, `EventUnit`, `EventRsvp`, `AdvancementDashboard`, `UnitActivitiesDashboard` API types; `ScoutbookEventDoc`, `ScoutbookCalendarDoc`, `ScoutbookDashboardDoc` MongoDB types; 3 new collection accessors

### Task 15: API Client — Calendar/Events/Dashboard Methods (v2)
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/api-client.ts`
- **Modify:** `mcp-servers/scout-quest/src/__tests__/scoutbook-api-client.test.ts`
- **Depends on:** Tasks 3, 14
- **Complexity:** Low-Medium
- **Adds:** `post<T>()` method (events endpoint is POST), `getUserCalendars`, `getEvents`, `getAdvancementDashboard`, `getUnitActivitiesDashboard`
- **Note:** Events POST body: `{ unitId, fromDate, toDate, showDLEvents: true }`

### Task 16: Sync Orchestration — Events and Dashboards (v2)
- **Modify:** `mcp-servers/scout-quest/src/scoutbook/sync.ts`
- **Modify:** `mcp-servers/scout-quest/src/__tests__/scoutbook-sync.test.ts`
- **Depends on:** Tasks 5, 14, 15
- **Complexity:** Medium
- **Adds:** `syncEvents(client, unitId, monthsAhead?, monthsBehind?)` and `syncDashboards(client, orgGuid)`
- **Updates:** `syncAll` signature to `syncAll(client, orgGuid, unitId)` and calls events+dashboards after advancement sync

### Task 17: CLI and MCP Tools — Events and Dashboards (v2)
- **Modify:** CLI, scoutbookSync.ts, admin index.ts, admin.ts, .env.example
- **Depends on:** Task 16
- **Complexity:** Low
- **Adds:** `events` and `dashboards` CLI commands; `scoutbook_sync_events` and `scoutbook_sync_dashboards` MCP tools; `SCOUTBOOK_UNIT_ID` env var

### Task 18: Full v2 Build Verification
- **No new files**
- **Depends on:** All v2 tasks
- **Steps:** Same as Task 12 but verifying all v2 additions

---

## File Structure

All new files under `mcp-servers/scout-quest/src/scoutbook/`:

```
mcp-servers/scout-quest/src/
├── scoutbook/                              # NEW — all Scoutbook sync logic
│   ├── types.ts                            # Task 1 — BSA API response types + MongoDB doc types
│   ├── collections.ts                      # Task 2 — MongoDB collection accessors (scoutbook_*)
│   ├── api-client.ts                       # Task 3+4 — HTTP client with auth, rate limiting, all API methods
│   ├── sync.ts                             # Task 5+6+7 — Sync orchestration (roster, scout, all)
│   ├── rate-limiter.ts                     # Task 13 — Burst-pattern rate limiter (v2)
│   └── cli.ts                              # Task 8 — CLI entry point (node dist/scoutbook/cli.js)
├── tools/admin/
│   ├── scoutbookSync.ts                    # Task 9+17 — MCP tools (sync_roster, sync_scout, sync_events, sync_dashboards)
│   ├── scoutbookInitQuest.ts               # Task 10 — Quest initialization bridge
│   └── index.ts                            # Modified — registers new tools
├── __tests__/
│   ├── scoutbook-api-client.test.ts        # Task 3+4 — API client tests
│   ├── scoutbook-sync.test.ts              # Task 5+6+7 — Sync orchestration tests
│   ├── scoutbook-rate-limiter.test.ts      # Task 13 — Rate limiter tests
│   └── scoutbook-init-quest.test.ts        # Task 10 — Quest init logic tests
└── admin.ts                                # Modified — updated ADMIN_INSTRUCTIONS

config/ai-chat/.env.example                 # Modified — SCOUTBOOK_* env vars added
mcp-servers/scout-quest/package.json        # Modified — start:scoutbook script added
```

**Build output:** `dist/scoutbook/cli.js` as a separate entry point alongside `dist/admin.js`, `dist/scout.js`, `dist/guide.js`, `dist/cron.js`.

---

## Environment Variables

Add to the ai-chat instance `.env` (and `.env.example`):

```bash
# =================================
# Scoutbook Sync
# =================================
# BSA credentials — login at my.scouting.org
SCOUTBOOK_USERNAME=jebramwell
SCOUTBOOK_PASSWORD=<password-from-1password>

# Troop 2024 identifiers
SCOUTBOOK_ORG_GUID=E1D07881-103D-43D8-92C4-63DEFDC05D48
SCOUTBOOK_UNIT_ID=121894
```

These env vars are read by:
- **CLI:** Directly from `process.env` when running `node dist/scoutbook/cli.js`
- **MCP admin tools:** Inherited from the LibreChat container's process environment (must be in the ai-chat `.env` which gets passed to Docker)

**Propagation path:** `.env` → `deploy-config.sh push` → GCS → `deploy-config.sh deploy` → VM → `docker-compose.override.yml` passes env vars into the LibreChat container → MCP servers spawned as stdio subprocesses inherit them.

The `docker-compose.override.yml` for ai-chat already passes `MCP_*` env vars — need to verify `SCOUTBOOK_*` vars are also forwarded. If not, add them to the `environment:` section.

---

## Key Design Decisions

### Auth Approach
- **Direct username/password auth** to `my.scouting.org/api/users/{username}/authenticate`
- Returns JWT with ~8-hour expiry (parsed from token's `exp` claim)
- Auto-refresh when <30 minutes from expiry
- No OAuth flow, no refresh tokens — BSA's API is simple bearer token auth
- On 401 during a request: one silent re-auth attempt, then fail

### Rate Limiting
- **P0 (today):** Simple 1 req/sec delay. Safe, conservative, easy to implement.
- **P2 (later):** Burst-pattern rate limiter mimicking human browsing. Randomized bursts of 3-8 requests at 100-400ms, 3-10s between bursts, 30 req/min hard cap.
- **Full sync budget:** ~120-220 API calls for 27 scouts. At 1 req/sec: ~3-5 minutes. With burst limiter: ~5-8 minutes (more human-like but slightly slower average).

### MongoDB Schema
- **Nine `scoutbook_*` collections** — all use `syncedAt: Date` for staleness tracking
- **Upsert-based** — re-running sync updates in place, never duplicates
- **Upsert keys:** `userId` (scouts/adults/parents), `userId+type+advancementId` (advancement), `userId+advancementType+advancementId+reqId` (requirements), `eventId` (events), `userCalendarId` (calendars), `orgGuid+type` (dashboards)
- **No indexes created** — collection sizes are small (27 scouts, ~200 advancements). Add indexes later if query performance warrants.
- **Append-only `scoutbook_sync_log`** — audit trail of all sync operations

### Quest Init Mapping (Task 10)
- **MB-level status mapping** (not per-requirement): If the merit badge is "Awarded" → all quest requirements = `completed_prior`. If "Started" → requirements default to `not_started` (admin overrides individually).
- **Why not per-requirement:** Scoutbook requirement IDs (numeric like 2006) don't map directly to quest requirement IDs (like `pm_1a`). Cross-referencing would require maintaining a manual mapping table. Deferred for later.

---

## Testing Strategy

### Unit Tests (mocked, offline)
All tests use vitest with mocked `fetch` and mocked MongoDB collections. No live API calls or database required.

- **API client tests:** Mock `fetch` globally, verify correct URLs, headers, auth flow, rate limiting
- **Sync tests:** Mock collections (`updateOne`, `insertOne`) and mock API client methods, verify document shapes and upsert counts
- **Quest init tests:** Pure logic tests for status mapping function

### Using the 93 Sample JSON Files
The sample responses in `scouting-org-research/data/responses/` serve two purposes:

1. **Type verification:** Compare TypeScript interfaces against actual JSON shapes. Key files:
   - `api.scouting.org_organizations_v2_units_E1D07881..._youths.json` → `YouthRosterResponse`
   - `advancements_v2_youth_12352438_ranks.json` → `RanksResponse`
   - `advancements_v2_youth_12352438_ranks_1_requirements.json` → requirements wrapper
   - `POST_api.scouting.org_advancements_events.json` → `EventDetail[]`
   - `api.scouting.org_advancements_v2_users_9120709_calendars.json` → `CalendarSubscription[]`

2. **Realistic test fixtures:** Load sample JSONs in tests to verify mapping logic with real data shapes:
   ```typescript
   import youthRoster from "../../scouting-org-research/data/responses/api.scouting.org_organizations_v2_units_E1D07881..._youths.json";
   ```
   (Requires `resolveJsonModule: true` in tsconfig — already enabled)

### Integration Testing (manual, on VM)
After deployment, test the full chain manually:
1. SSH into VM, run `node dist/scoutbook/cli.js auth` → verify token acquired
2. Run `node dist/scoutbook/cli.js roster` → verify scouts/adults/parents populated
3. Run `node dist/scoutbook/cli.js scout 12352438` → verify Will's advancement synced
4. Check MongoDB: `db.scoutbook_scouts.find()`, `db.scoutbook_advancement.find()`
5. In ai-chat, call `scoutbook_sync_roster` via the AI → verify MCP tool works
6. Ask "What requirements does Will Bramwell need to complete for Second Class?" → verify AI can answer from synced data

---

## Deployment Steps

After all P0 code is written and tests pass:

### 1. Build
```bash
cd mcp-servers/scout-quest && bash build.sh
```
Verify `dist/scoutbook/cli.js` exists.

### 2. Update .env on GCS
```bash
./deploy-config.sh pull                    # Get current .env files
# Edit config/ai-chat/.env — add SCOUTBOOK_* vars:
#   SCOUTBOOK_USERNAME=jebramwell
#   SCOUTBOOK_PASSWORD=<actual-password>
#   SCOUTBOOK_ORG_GUID=E1D07881-103D-43D8-92C4-63DEFDC05D48
#   SCOUTBOOK_UNIT_ID=121894
./deploy-config.sh push                    # Upload to GCS
```

### 3. Verify docker-compose.override.yml forwards env vars
Check `config/ai-chat/docker-compose.override.yml` — the `SCOUTBOOK_*` env vars must be accessible to the LibreChat container's MCP subprocesses. If they're not passed through, add them to the `environment:` section.

### 4. Deploy to VM
```bash
./deploy-config.sh update gcloud          # Push .env + configs, docker compose up -d
```

### 5. Run initial sync
```bash
# SSH into VM and run CLI inside the LibreChat container (or locally with MONGO_URI pointing to VM)
./scripts/ssh-vm.sh "docker exec -it ai-chat-api-1 node /app/mcp-servers/scout-quest/dist/scoutbook/cli.js auth"
./scripts/ssh-vm.sh "docker exec -it ai-chat-api-1 node /app/mcp-servers/scout-quest/dist/scoutbook/cli.js all"
```

Or use the MCP admin tools from ai-chat:
1. Open ai-chat.hexapax.com
2. Tell the AI: "Run scoutbook_sync_roster to pull the troop roster"
3. Then: "Run scoutbook_sync_scout for userId 12352438 (Will Bramwell)"

### 6. Verify
Ask the AI: "What requirements does Will Bramwell still need for his current rank?"

---

## Ambiguities and Questions

### Must resolve before implementing:

1. **Docker env var passthrough:** Do `SCOUTBOOK_*` env vars automatically get passed to MCP stdio subprocesses, or do they need explicit `environment:` entries in `docker-compose.override.yml`? Need to check how existing MCP env vars (like `NTFY_TOPIC`, `ADMIN_EMAIL`) are passed.

2. **CLI entry point in container:** The CLI (`dist/scoutbook/cli.js`) needs MongoDB access. It can either:
   - Run inside the LibreChat container (has MongoDB network access via `mongodb:27017`)
   - Run locally with `MONGO_URI=mongodb://VM_IP:27017/scoutquest`
   - The docker-compose stack may not expose MongoDB's port externally
   Need to determine the right invocation path.

### Can resolve during implementation:

3. **`getRankRequirements` response shape:** The implementation plan says it returns `{ requirements: RequirementCompletion[] }`, but need to verify against `advancements_v2_youth_12352438_ranks_1_requirements.json`. The response may be nested inside a rank object.

4. **Parent roster aggregation:** A parent appearing for multiple children gets multiple `ParentEntry` records. The sync correctly aggregates by `parentUserId` and collects all `youthUserId` values, but need to confirm the sample data matches this assumption.

5. **`REQUIREMENT_DEFINITIONS` completeness:** Task 10 imports from `constants.ts`. Verify these definitions cover all PM (18) and FL (8) requirements — currently 26 entries which looks correct.

### Deferred (not blocking today):

6. **Cron integration:** The design spec defines sync intervals (events every 4h, roster daily, etc.) but there's no cron task yet. This can be added after the core sync works.

7. **BSA API stability:** The API is undocumented and could change. We're using endpoints observed in HAR captures from 2026-02-22. If endpoints start returning different shapes, the types and mapping functions will need updates.

8. **Credential rotation:** JWT tokens expire in ~8 hours. The in-memory caching with auto-refresh handles this, but if the BSA account password changes, all syncs will fail until `.env` is updated.

---

## Implementation Order

The recommended order optimizes for "working sync as fast as possible":

```
Task 1 (types)           ─┐
Task 2 (collections)      ├─> Can be done together, no deps between them
Task 3 (api-client auth) ─┘
         │
Task 4 (api-client methods)
         │
Task 5 (syncRoster) ──────┐
Task 6 (syncScout)         ├─> Can parallelize 5+6 since they're independent sync functions
         │                 │
Task 7 (syncAll) ──────────┘
         │
Task 8 (CLI) ────────────── At this point: can test full sync from command line
         │
Task 9 (MCP tools) ─────── At this point: can sync via ai-chat
         │
Task 11 (instructions) ─── Admin can discover tools
Task 12 (build+verify) ─── Ship it
         │
Task 10 (quest init) ───── Nice-to-have for today, enables quest setup from Scoutbook data
         │
Tasks 13-18 (v2) ───────── Calendar, events, dashboards, smart rate limiter, cron
```

Tasks 1+2 can be written in one file creation pass. Tasks 5+6 are independent functions in the same file. The critical path is Tasks 1→3→4→5/6→7→8→9→12.
