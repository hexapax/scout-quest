# Scout Quest — Development State

**Last updated:** 2026-02-22

## Current Architecture

```
Internet → Caddy (auto-HTTPS)
  ├── ai-chat.hexapax.com:3080    — Full-access LibreChat (admin)
  ├── scout-quest.hexapax.com:3081 — Locked-down LibreChat (scouts/parents)
  └── admin.hexapax.com:3082       — AdminJS panel (system visibility)

Each instance: LibreChat + MongoDB + Redis
MCP servers: scout.js (scout-facing), guide.js (parent-facing), admin.js (admin)
Scoutbook sync: in-progress (feat/scoutbook-sync branch)
```

## Component Status

### Infrastructure (Working)
- [x] GCP VM (e2-medium, us-east4-b) running all services
- [x] Caddy reverse proxy with auto-HTTPS
- [x] Terraform for infrastructure management
- [x] Docker Compose stacks with isolated databases
- [x] deploy-config.sh for config deployment
- [x] GCS bucket for secrets management

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

### Scoutbook Sync (In Progress)
- [x] Design spec approved (`docs/plans/2026-02-22-scoutbook-sync-design.md`)
- [x] Implementation plan with 12 tasks
- [x] API client with auth, rate limiting, and tests (committed on feat/scoutbook-sync)
- [x] MongoDB collection accessors for scoutbook_* collections
- [x] BSA API response types and MongoDB doc types
- [ ] **Core sync orchestration** — not yet implemented
- [ ] **CLI entry point** — not yet built
- [ ] **MCP admin tools** — not yet wired up
- [ ] **Roster-to-scout mapping** — need to connect scoutbook_scouts to the quest system's scouts collection
- [ ] **Shared email detection** — families using same email for parent and scout accounts

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
1. **Complete Scoutbook sync** — populate scouts, parents, advancement
2. **Map Scoutbook scouts to quest system** — create scout profiles from roster data
3. **Verify email matching** — scouts log in via Google OAuth, email must match Scoutbook

### Phase 2: Close the Loop
4. **Test MCP tools end-to-end** — verify a scout can log chores, track budget, advance requirements
5. **Test resource loading** — verify quest-state, character, etc. return meaningful data
6. **Fix tool hallucination** — confirm models actually call tools after instruction update
7. **Test guide flow** — parent can see their scout's progress, set up quest parameters

### Phase 3: Verify Consistency
8. **Multi-session continuity** — does session_notes → last_session flow preserve context?
9. **Character consistency** — does the AI maintain character persona across sessions?
10. **Cron verification** — do automated checks (backfill, plan review) actually run?

### Phase 4: Pilot
11. **Onboard 2-3 scouts** — walk parents through guide setup, scouts through first session
12. **Monitor via admin panel** — watch for issues, gaps, hallucinations
13. **Iterate** — fix what breaks, refine what's awkward

## Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| AI hallucinates MCP tool calls | High | Instructions updated 2026-02-22, needs retest |
| No scout data in MongoDB | Blocker | Waiting on Scoutbook sync |
| Admin panel shows only ai-chat conversations | Medium | Need second LibreChat DB connection or config fix |
| gcloud gsutil re-auth failures | Fixed | Switched to `gcloud storage cp` |
| Chrome DevTools MCP stale connection | Low | Server doesn't auto-reconnect after Chrome restart |
| Cron system not verified | Medium | Need to check if sidecar is running |
| Dense CSS not applied to admin panel | Low | Cosmetic |

## Open Questions

1. How do we handle the Scoutbook → quest scout profile mapping? Create quest profiles automatically on first sync, or require guide onboarding?
2. Should admin panel connect to both MongoDB instances for conversations?
3. How do we detect and handle shared parent/scout emails from Scoutbook?
4. What's the minimum character/quest setup needed before a scout can start using the system?
5. How do we measure "consistency" — what metrics tell us the AI coaching is working?
