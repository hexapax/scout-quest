# Scout Quest — Development State

**Last updated:** 2026-02-25

## Current Architecture

```
Internet → Caddy (auto-HTTPS)
  ├── ai-chat.hexapax.com:3080    — Full-access LibreChat (admin)
  ├── scout-quest.hexapax.com:3081 — Locked-down LibreChat (scouts/parents/scouters)
  └── admin.hexapax.com:3082       — AdminJS panel (system visibility)

Each instance: LibreChat + MongoDB + Redis
MCP servers: scout.js (scout-facing), guide.js (parent/scouter-facing), admin.js (admin)
Scoutbook sync: periodic cron + on-demand admin tools
  ├── Roster: youth, adults, parents, patrols
  ├── Advancement: ranks, merit badges, awards, requirements
  ├── Calendar/Events: events with RSVP and attendance per member
  └── Activity: camping nights, hiking miles, service hours

Devbox (devbox.hexapax.com) → GCP HTTPS LB + IAP
  └── LibreChat (native Node.js, :3080)
        ├── MongoDB + Redis (Docker)
        ├── MCP: claude-code-mcp → Claude Code CLI
        └── MCP: @playwright/mcp → headless Chromium
```

## Component Status

### Infrastructure (Working)
- [x] GCP VM (e2-medium, us-east4-b) running all services
- [x] Caddy reverse proxy with auto-HTTPS
- [x] Terraform for infrastructure management
- [x] Docker Compose stacks with isolated databases
- [x] deploy-config.sh for config deployment
- [x] GCS bucket for secrets management

### Devbox / Remote Development (Deployed, Working)
- [x] GCP VM (e2-standard-4, us-east4-b) in hexapax-devbox project
- [x] IAP-protected HTTPS at devbox.hexapax.com (Google-managed OAuth, jeremy@hexapax.com)
- [x] HTTPS LB with managed SSL cert (auto-provisioned, ACTIVE)
- [x] LibreChat v0.8.3-rc1 running natively (systemd service, port 3080)
- [x] MongoDB + Redis running as Docker containers on VM
- [x] claude-code-mcp providing Claude Code as MCP tool (1 tool: `claude_code`)
- [x] @playwright/mcp providing headless browser automation (22 tools)
- [x] Cross-project IAM verified: devbox SA has editor on scout-assistant, dns.admin on hexapax-web, storage.admin on scout-assistant
- [x] Claude Code CLI authenticated (jebramwell@gmail.com Max plan, `--dangerously-skip-permissions` accepted)
- [x] API keys configured (Anthropic, OpenAI, Google — copied from scout-assistant, to be replaced with devbox-specific keys)
- [x] Secrets stored in GCS (`gs://hexapax-devbox-tfstate/config/devbox/.env`)
- [x] Terraform provider upgraded to google/google-beta v6.50.0 (required for IAP Google-managed OAuth)
- [x] Smoke tests passed: cross-project DNS and compute access from service account
- [ ] **First MCP call is slow** (~5 min) — Claude Code CLI init + prompt cache warmup. Subsequent calls faster.
- [ ] **LibreChat config version outdated** — librechat.yaml is v1.2.1, latest is v1.3.4 (cosmetic warning)
- [ ] **No model-as-approver hooks** — future enhancement where a cheap model reviews Claude Code tool calls via PreToolUse hooks

### LibreChat Instances (Working, Needs Refinement)
- [x] ai-chat instance running with full access
- [x] scout-quest instance running with locked-down presets
- [x] Google OAuth working for both instances
- [x] Model presets configured: Claude Sonnet 4.6, Gemini 3 Flash, GPT-4.1 mini
- [x] Speech (STT/TTS) configured
- [ ] **Issue: AI hallucinating tool use** — model sometimes "simulates" MCP calls instead of actually making them. Updated instructions (2026-02-22) to explicitly forbid this. Needs re-testing.

### MCP Server — Scout-Facing (Partially Working)
- [x] 11 tools registered and loading (log_chore, log_budget_entry, advance_requirement, compose_email, send_notification, adjust_tone, setup_time_mgmt, log_diary_entry, update_quest_goal, update_quest_plan, log_session_notes)
- [x] 10 resources registered (quest-state, quest-plan, last-session, requirements, chore-streak, budget-summary, character, reminders, quest-summary)
- [x] Server instructions with Scoutbook data source context
- [ ] **Not tested end-to-end** — tools register but we haven't verified a scout can actually log chores, track budget, etc. with real data flowing to/from MongoDB
- [ ] **No scout data in DB** — scouts collection is empty. Waiting on Scoutbook sync to populate.
- [ ] **Tool hallucination** — even with updated instructions, need to verify models actually call tools

### MCP Server — Guide-Facing (Partially Working)
- [x] 15 tools registered (onboarding, monitoring, adjustment tools)
- [x] Resources for viewing linked scouts
- [x] Instructions updated for Scoutbook data source
- [ ] **Not tested** — no guide/parent profiles exist yet
- [ ] **setup_scout_profile tool** — still registered but instructions say scouts come from Scoutbook. May need to remove or repurpose.

### MCP Server — Admin-Facing (Unknown)
- [x] Registered on ai-chat instance
- [ ] **Not tested recently** — unclear if admin tools work

### Admin Panel (Working, Incomplete)
- [x] AdminJS running at admin.hexapax.com
- [x] Google OAuth authentication
- [x] 13 Scout Quest resources in sidebar (Scouts, Requirements, Chore Logs, Budget Entries, Time Management, Loan Analysis, Emails Sent, Reminders, Users, Quest Plans, Session Notes, Plan Changelog, Setup Status)
- [x] 2 System resources (Audit Log, Cron Log)
- [x] 2 Libre Chat resources (Conversations, LibreChat Users)
- [ ] **Conversations show ai-chat only** — admin panel reads from ai-chat MongoDB, not scout-quest. New conversations created on scout-quest don't appear.
- [ ] **All Scout Quest resources are empty** — no data has been created yet
- [ ] **Dense CSS not rendering** — dashboard still shows default AdminJS styling

### Scoutbook Sync (v2 Complete — All 18 Tasks Done)
- [x] Design spec approved (`docs/plans/2026-02-22-scoutbook-sync-design.md`)
- [x] Implementation plan with 18 tasks (roster + advancement + events + dashboards + calendars)
- [x] API client with auth, rate limiting, and tests (committed on feat/scoutbook-sync)
- [x] MongoDB collection accessors for all 9 scoutbook_* collections
- [x] BSA API response types and MongoDB doc types (all v2 types)
- [x] 79 API endpoints cataloged across 9 categories
- [x] Core sync orchestration — syncRoster, syncScout, syncEvents, syncDashboards, syncCalendars, syncAll
- [x] MCP admin tools — 9 tools: sync_roster, sync_scout, sync_all, sync_events, sync_status, get_scout_advancement, init_quest, sync_dashboards, sync_calendars
- [x] Calendar/events sync — events with invitedUsers + RSVP, calendar subscriptions per user
- [x] Activity dashboard sync — advancement + activities dashboards upserted to scoutbook_dashboards
- [x] Quest bridge — initQuestFromScoutbook creates quest profiles from synced data
- [ ] **Smart rate limiting** — randomized burst patterns to avoid scraping signatures (~0.5 req/sec avg, 30 req/min hard cap, human-like timing)
- [ ] **Shared email detection** — families using same email for parent and scout accounts
- [ ] **Cron-based periodic sync** — automated background sync with configurable intervals per data type

### Cron System (Exists, Not Verified)
- [x] Cron sidecar in Docker Compose
- [x] Session backfill (Haiku) and plan review (Sonnet) steps designed
- [ ] **Cron Log is empty** — either not running or not logging
- [ ] **Not tested**

### Character System (Designed, Not Tested with Real Users)
- [x] Character spec complete (`docs/scout-quest-character.md`)
- [x] Base characters (guide, pathfinder, trailblazer) with quest overlays
- [x] Tone dial and domain intensity calibration
- [ ] **Untested with real scouts** — personality calibration is theoretical

## Critical Path to MVP

The minimum needed to run a pilot with 2-3 scouts from the troop:

### Phase 1: Data Foundation
1. **Complete Scoutbook sync — roster + advancement** — populate scouts, parents, advancement data
2. **Add calendar/events sync** — events with RSVP and attendance data
3. **Map Scoutbook scouts to quest system** — create scout profiles from roster data
4. **Verify email matching** — scouts log in via Google OAuth, email must match Scoutbook
5. **Set up cron-based periodic sync** — automated background sync with smart rate limiting

### Phase 2: Close the Loop
6. **Test MCP tools end-to-end** — verify a scout can log chores, track budget, advance requirements
7. **Test resource loading** — verify quest-state, character, etc. return meaningful data
8. **Test calendar/event queries** — scouts, parents, and scouters can ask about upcoming events and RSVPs
9. **Fix tool hallucination** — confirm models actually call tools after instruction update
10. **Test guide flow** — parent can see their scout's progress, upcoming events, set up quest parameters

### Phase 3: Verify Consistency
11. **Multi-session continuity** — does session_notes → last_session flow preserve context?
12. **Character consistency** — does the AI maintain character persona across sessions?
13. **Cron verification** — do automated checks (Scoutbook sync, backfill, plan review) actually run?
14. **Data freshness** — is the periodic sync keeping data current enough for useful responses?

### Phase 4: Pilot
15. **Onboard 2-3 scouts** — walk parents through guide setup, scouts through first session
16. **Test scouter flow** — can I (as scoutmaster) get useful event/RSVP/advancement info from the assistant?
17. **Monitor via admin panel** — watch for issues, gaps, hallucinations
18. **Iterate** — fix what breaks, refine what's awkward

## Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| AI hallucinates MCP tool calls | High | Instructions updated 2026-02-22, needs retest |
| No scout data in MongoDB | Blocker | Waiting on Scoutbook sync |
| Admin panel shows only ai-chat conversations | Medium | Need second LibreChat DB connection or config fix |
| Scoutbook API has no documented rate limits | Medium | Using conservative 1 req/sec with randomized timing |
| gcloud gsutil re-auth failures | Fixed | Switched to `gcloud storage cp` |
| Chrome DevTools MCP stale connection | Low | Server doesn't auto-reconnect after Chrome restart |
| Cron system not verified | Medium | Need to check if sidecar is running |
| Dense CSS not applied to admin panel | Low | Cosmetic |

## Scoutbook API Data Available

79 endpoints cataloged. Core data for sync:

| Category | Key Endpoints | What We Get |
|----------|--------------|-------------|
| **Roster** | Youth/Adult/Parent rosters, Patrols | Full member list with positions, patrol assignments, contact info |
| **Advancement** | Ranks, Merit Badges, Awards, Requirements per scout | Individual progress with dates, completion %, counselor assignments |
| **Calendar/Events** | `POST /advancements/events` | Events with full invitedUsers array, RSVP status (Y/N/M/blank), attendance |
| **Calendars** | `GET /advancements/v2/users/{id}/calendars` | Calendar subscriptions (unit + patrol codes) |
| **Activity** | Activity summaries, unit dashboards | Camping nights, hiking miles, service hours per scout and unit-wide |

The events endpoint is especially rich — each event's `invitedUsers` array contains every troop member with their RSVP response (`rsvpCode`: Y/N/M/empty) and attendance status. A single month query returns ~41 members per event across ~6-7 events.

## Open Questions

1. How do we handle the Scoutbook → quest scout profile mapping? Create quest profiles automatically on first sync, or require guide onboarding?
2. Should admin panel connect to both MongoDB instances for conversations?
3. How do we detect and handle shared parent/scout emails from Scoutbook?
4. What's the minimum character/quest setup needed before a scout can start using the system?
5. How do we measure "consistency" — what metrics tell us the AI coaching is working?
6. How often should calendar/event data sync? Events change more frequently than roster/advancement — may need different sync intervals.
7. Should the assistant be able to help scouts RSVP (write-back to Scoutbook) or strictly read-only?
