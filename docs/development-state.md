# Scout Quest — Development State

**Last updated:** 2026-07-06 — retrospective refresh covering everything landed through 2026-05-29 (the most recent commit). The repo has been idle since then; the 2026-06-07 alpha target passed with no launch or re-plan recorded here.

## Active roadmap

The current direction is the **Alpha Evolution Roadmap** (`docs/plans/2026-04-26-alpha-evolution-roadmap.md`), which extends the 2026-04-16 alpha-launch plan with four new streams (G/H/I/J) and one post-alpha stream (K). Hard prerequisites for first real-youth user:

| Stream | Status | Design doc |
|--------|--------|-----------|
| A — Roles | ✅ landed 2026-04-16 | 2026-04-16-alpha-launch-plan.md |
| D — Eval cleanup + multi-model tools | ✅ landed 2026-04-16 | 2026-04-16-alpha-launch-plan.md |
| C — Cost logging | ✅ landed | 2026-04-16-alpha-launch-plan.md |
| B' — Parent visibility (finish) | 🟡 mostly closed — Summaries tab + Coach recap card landed via Stream G; safety banners await Stream H | 2026-04-16-alpha-launch-plan.md + 2026-04-26-scout-state-and-summaries.md |
| E — UI polish + voice | 🟡 partial | 2026-04-16-alpha-launch-plan.md |
| F — Onboarding + runbook | ⬜ not started | 2026-04-16-alpha-launch-plan.md |
| **G — Scout state + summaries** | ✅ landed 2026-04-29 (steps 1–10; step-11 tests partial) | 2026-04-26-scout-state-and-summaries.md |
| **H — Safety flagging** | 🟡 half — classifier + tier rules + store + Safety Queue landed 2026-04-30; **notification routing (steps 5–13) not built** | 2026-04-26-safety-flagging.md |
| **I — Observability + budget** | ⬜ designed, not started | 2026-04-26-observability-cicd.md |
| **J — CI/CD eval gates** | ⬜ designed, not started | 2026-04-26-observability-cicd.md |
| **K — Stable + Dev envs** (post-alpha) | ⬜ designed 2026-04-26 | 2026-04-26-ab-environments.md |
| Tool hardening | ⬜ scoped | 2026-04-26-alpha-evolution-roadmap.md |

Target alpha launch was **2026-06-07**; the date passed with Stream H's notification half, Streams I/J/F, and tool hardening still open. Next session should re-baseline the launch date and sequencing.

## Current Architecture

```
Internet → Caddy (auto-HTTPS)
  ├── ai-chat.hexapax.com       → :3080  LibreChat (admin full access)
  ├── scout-quest.hexapax.com   → :3090  Custom v2 backend (scouts/parents/scouters)
  ├── voice-chat.hexapax.com    → :3090  same backend, root rewritten to /app.html
  ├── api / voice-api           → :3090  ElevenLabs + external integrations
  ├── admin.hexapax.com         → :3082  AdminJS panel (system visibility)
  └── mcp.hexapax.com/admin     → :3083  admin MCP over Streamable HTTP (remote clients)
  (eval.hexapax.com → eval viewer, port 9090 via Cloudflare tunnel)

Custom v2 backend (:3090) — the production scout-facing surface:
  ├── Multi-provider adapters (Anthropic Sonnet 4.6 primary; OpenAI-compat, Gemini)
  ├── 165K cached BSA knowledge (compact doc auto-selected for ≤200K-context models)
  ├── FalkorDB (graph + vector + full-text search)
  ├── 9 server-side tools (get_scout_status, search_bsa_reference,
  │   cross_reference, advance_requirement, rsvp_event, log_activity,
  │   log_requirement_work, create_pending_action, bsa_token)
  ├── scout_state rolling summaries + conversation_summaries (Stream G)
  ├── Haiku safety classifier → safety_events + admin Safety Queue (Stream H, partial)
  └── Micro-apps: app.html (chat+voice), history.html, progress.html, email.html

LibreChat scout-quest instance (:3081): still in the Docker Compose stack but NO LONGER
ROUTED by Caddy — the v2 backend replaced it as the scout-facing surface. Its scout.js /
guide.js MCP servers have no public path. Formal retirement pending (single-path cleanup).

Domains registered:
  ├── troopquest.com (Cloudflare, primary)
  ├── troopquest.org (Cloudflare, redirect)
  └── troop2024.ai (planned, not yet registered)
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
- [x] Perplexity MCP server configured (both devuser and jeremy_hexapax_com)
- [x] Brave Search MCP server configured (both devuser and jeremy_hexapax_com)
- [x] Node.js 24 installed system-wide (replaced nvm dependency)
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
- [x] **Scoutbook data loaded** — 20 scouts, 15 adults, 419 advancement, 2,535 requirements in MongoDB (2026-03-15)
- [ ] **Not tested end-to-end** — tools register but we haven't verified a scout can actually log chores, track budget, etc. with real data flowing to/from MongoDB
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

### Scoutbook Sync (Deployed — Token-Injection Refresh Workflow)
- [x] Design spec approved (`docs/plans/2026-02-22-scoutbook-sync-design.md`)
- [x] Implementation plan with 18 tasks (roster + advancement + events + dashboards + calendars)
- [x] API client with auth, rate limiting, and tests
- [x] MongoDB collection accessors for all 9 scoutbook_* collections
- [x] BSA API response types and MongoDB doc types (all v2 types)
- [x] 79 API endpoints cataloged across 9 categories
- [x] Core sync orchestration — syncRoster, syncScout, syncEvents, syncDashboards, syncCalendars, syncAll
- [x] MCP admin tools — 9 tools deployed to ai-chat instance
- [x] **MongoDB populated (2026-03-15)** — 20 scouts, 15 adults, 419 advancement records, 2,535 requirements
- [x] **`scoutbook_get_scout_advancement` tool verified working** with real data in MongoDB
- [x] **Token-injection sync is the single path (2026-05-15)** — all sync flows collapsed into `cli.js sync-with-token`; run via `SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh`, then reload the FalkorDB graph with `graph-loader.js` (see CLAUDE.md "Scoutbook Data Refresh")
- [x] **Playwright token refresh (2026-04-30 → 05-01)** — persistent Chrome profile, Windows PowerShell wrappers + Task Scheduler installer; manual JWT copy from DevTools also works
- [x] **Sync hardening (2026-04-29 → 05-13)** — targeted IDs, auth override, jitter, `syncSkip` flag to suppress known-bad scout syncs
- [ ] **BSA automated username/password auth still broken** — `my.scouting.org/api/users/{username}/authenticate` returns 503 (since ~March 2026); token injection is the workaround until BSA fixes it
- [ ] **`docs/scoutbook-data-refresh.md` is stale** — still documents the retired Chrome CDP flow (last updated 2026-03-15); needs rewrite around token-injection sync
- [ ] **Smart rate limiting** — enhancement, not blocking
- [ ] **Cron-based periodic sync** — still blocked by BSA auth; Task Scheduler token refresh gets partway there

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

### Custom API Backend v2 (Deployed — Production Scout-Facing Surface)
- [x] `backend/` directory with TypeScript + Express
- [x] OpenAI-compatible `/v1/chat/completions` endpoint
- [x] Anthropic SSE → OpenAI SSE streaming translation
- [x] BSA knowledge injection as `system[0]` with `cache_control: {type: "ephemeral"}`
- [x] Scout Coach / Scout Guide persona as `system[1]`
- [x] Per-scout context injection as `system[2]` (from MongoDB scoutbook + quest collections)
- [x] `ScoutCoachV2` custom endpoint in `librechat.yaml`
- [x] `Scout Coach v2` preset in modelSpecs
- [x] `scripts/deploy-backend.sh` deploy script
- [x] Interim knowledge document: 40 scouting-knowledge/ files → 52K tokens
- [x] `BACKEND_API_KEY` auth between LibreChat and backend
- [x] **Deployed and serving production** — Caddy routes scout-quest.hexapax.com and voice-chat.hexapax.com directly to :3090; LibreChat is out of the scout-facing path
- [x] Multi-provider adapters + server-side tool dispatch for every wired model (Streams A/D) — the LibreChat MCP constraint does not apply to this path
- [x] UI smoke harness — headless Chromium against the deployed backend (2026-04-29)
- [x] May 2026 hardening: compact-knowledge fallback for ≤200K-context models, provider errors surfaced to the UI, per-container mem limits, graph-loader typed Advancement/Requirement keys, modern `CREATE VECTOR INDEX` syntax (orphaned load-vectors dropped)
- Note: the 52K interim knowledge doc below is historical — production runs the 165K doc with a compact variant

### Scout State + Summaries — Stream G (Landed 2026-04-28/29)
- [x] `scout_state` collection — rolling event log + Haiku-generated rolling summary, regenerated on new events (steps 1+3)
- [x] `conversation_summaries` — per-conversation parent-facing recaps: generator, writer, readers (step 2)
- [x] End-of-session pipeline wired into chat.ts + voice persistence; in-process sweeper every 15m, idle ≥ 30m (steps 4+5)
- [x] Rolling summary + recent episodes injected into the system prompt — cold-start gap closed (step 6)
- [x] Role-checked read APIs; Summaries tab in history.html; Coach recap card in chat UI (steps 7–9)
- [x] 30-day backfill script; conversationId plumbed through the text-chat path (step 10)
- [x] Isolated-DB test harness for scout-memory scenarios; extractor fixture coverage + idempotency
- [ ] **Step 11 partial** — full-pipeline integration test still outstanding

### Safety Flagging — Stream H (Half-Landed 2026-04-29/30)
- [x] Haiku safety classifier, post-response fire-and-forget (`backend/src/safety/`) — steps 1–2
- [x] Piped into chat.ts; `safety_events` collection + writer — steps 3–4
- [x] Admin Safety Queue dashboard — list flagged events, filter by tier, ack — step 7
- [ ] **Notification routing (step 5) NOT BUILT** — Tier 2/3 flags reach the dashboard but notify no one. This is the hard blocker for real youth users.
- [ ] Remaining: pattern-detection cron (6), parent email templates (8), in-conversation crisis response (9), mandated-report review/decide UI (10), Twilio (11), tier fixture tests (12), parent-facing "what we flag" page (13)

### Scouting Knowledge Base (Superseded by v2 Architecture)
- [x] 40 scouting-knowledge/ docs assembled into `backend/knowledge/interim-bsa-knowledge.md` (52K tokens)
- [x] `scripts/assemble-knowledge.sh` for regeneration
- [ ] pgvector embedding pipeline (deferred — v2 uses FalkorDB instead, Phase 2)
- [ ] Version-aware advancement (Phase 2 — FalkorDB knowledge graph)

### Test Harness (Working, on Devbox)
- [x] Multi-session chain framework (7,580 lines) committed from devbox
- [x] Guide tools experiments, thinking budget experiments
- [x] Experiment reports generated
- [ ] **Not integrated with CI** — manual runs on devbox only

### Evaluation Framework v2 (Built 2026-03-20/21)
- [x] **Eval Runner** (`scripts/run-eval.py`) — v7 canonical set: 109 questions + 25 chain steps (`eval-sets/scout-eval-v7.yaml`); legacy `run-model-eval.py` deleted 2026-07-06
- [x] **Eval Viewer** (`eval.hexapax.com`) — web app for browsing results, drill-down, voice narration
- [x] **12-model comparison** — Claude, GPT-4.1/5.4, Gemini 2.5/3.x, DeepSeek tested
- [x] **Adaptive thinking sweep** — medium effort is sweet spot (8.0 avg)
- [x] **Panel evaluator** — DeepSeek/GPT-nano/Grok observe, Claude scores
- [x] **Prompt caching** — 88% cost reduction on Anthropic model calls
- [x] **Budget enforcement** — `--budget` flag, fail-fast on errors
- [x] **MongoDB dual-write** — eval_results (1,387 docs), eval_usage, eval_rankings, eval_embeddings
- [x] **Cost tracking** — real-time per-call tracking, viewer cost dashboard
- [x] **Listwise ranking** — Borda count from 3 cheap judges, cross-validates scores
- [x] **Embedding clustering** — Gemini embedding-001, cached in MongoDB
- [x] **ElevenLabs TTS** — v3 voices (Liam/Scoutmaster1/Brian), viewer integration
- [x] **Eval set versioning** — v5 with rubric-style eval_notes, question types
- [x] **Web search tool** — Brave Search integration for layer ablation
- [x] **Pre-item budget guard + Grok pricing rows** (2026-05-03) — budget enforced before each item, not just per run
- [x] **Scoutmaster sweep** — `run-scoutmaster-full-eval.sh`: 8 questions × 3 Anthropic configs (2026-04-29)
- [x] **Viewer runner tab** — `/run` page + `/api/eval/launch` endpoints (landed 2026-03-22; `backend/src/routes/eval-runner.ts`, served by `eval-server.mjs`)
- [ ] **Bug tracking** — auto-detect failures, triage workflow
- [ ] **Layer ablation** — L0-L5 with working web search (partially tested)
- [ ] **Bradley-Terry proper** — currently using Borda count, BT would give confidence intervals

### Key Eval Findings
- **Claude Sonnet 4.6 Adaptive Medium** is the best Scout Coach model (8.0 avg)
- **Gemini 3 Flash Preview** is best value at $0.50/$3 (7.6-8.0 depending on evaluator)
- **Opus underperforms Sonnet** on coaching — overthinks emotional questions
- **The Blind Evaluator Problem** — evaluator lacked the model's knowledge, penalized correct troop references
- **Panel evaluation** is more accurate and cheaper than single-model evaluation
- **Ranking cross-validation** shows score-rank disagreements on 3/3 pilot questions — scoring has blind spots
- **Prompt caching was broken** by delimiter collision — fixed, saving ~$300 per full run
- **Total API spend**: ~$400 (2026-03-20/21), now tracked per-call in MongoDB

## Critical Path to MVP

**Updated 2026-04-26**: this section is superseded by `docs/plans/2026-04-26-alpha-evolution-roadmap.md`. The roadmap is the source of truth for sequencing and effort estimates. Below is a condensed view; consult the roadmap for stream details.

### Phase 1 — Data Foundation ✅ COMPLETE
- Scoutbook sync (roster + advancement + events) — all 18 tasks landed
- Real data in production MongoDB — 20 scouts, 15 adults, 419 advancement, 2,535 requirements
- BSA automated auth still broken (503); manual Chrome CDP refresh workflow documented in `docs/scoutbook-data-refresh.md`

### Phase 2 — Backend v2 + eval framework ✅ COMPLETE
- Custom backend with prompt caching, FalkorDB graph, multi-provider tools
- 9 server-side tools deployed
- v7 eval set (109 questions + 25 chain steps), MongoDB-backed results
- Cost-per-message logging (`message_usage`) shipped via Stream C

### Phase 3 — Alpha launch readiness 🟡 STALLED (last repo activity 2026-05-29)
- Stream G ✅ landed; Stream H 🟡 half (notification routing missing); Streams I, J, F + tool hardening ⬜ not started
- Remaining hard blockers for real youth users: Stream H notifications, budget guards (I), onboarding + runbook (F)
- Internal calibration week before any external user

### Phase 4 — External alpha
- 5-10 users, 30-day support commitment
- Then add Stream K (dev environments) once stable has a baseline

### Phase 5 — Broaden
- Multi-troop, mobile, scouter features, council demo

## Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| Stream H notifications missing — safety flags reach the dashboard but notify no one | High | Steps 5–13 of `2026-04-26-safety-flagging.md` not started. Hard blocker for real youth users. |
| LibreChat scout-quest instance (:3081) unrouted but still deployed | Medium | The v2 backend replaced it. Retire the stack + scout.js/guide.js MCP registration, or re-route — single-path violation as-is. |
| BSA automated auth endpoint 503 | Medium | Still 503. Workaround shipped: Playwright token refresh + token-injection sync (`scripts/run-token-sync-vm.sh`). `docs/scoutbook-data-refresh.md` still documents the old CDP flow — rewrite needed. |
| AI hallucinates MCP tool calls (LibreChat path) | Low (was High) | Largely mooted — scout traffic now goes through the v2 backend, which dispatches tools server-side. Only relevant if the LibreChat scout-quest instance is revived. |
| Eval scoring inconsistency | Medium | Panel evaluator + ranking cross-validation identifies blind spots. Score-rank disagreement on 3/3 pilot questions — investigating. |
| Admin panel shows only ai-chat conversations | Medium | Need second LibreChat DB connection or config fix |
| Scoutbook API has no documented rate limits | Medium | Using conservative 1 req/sec with randomized timing |
| Cron system not verified | Medium | Need to check if sidecar is running |
| Dense CSS not applied to admin panel | Low | Cosmetic |

### Resolved Issues

| Issue | Resolution |
|-------|-----------|
| No scout data in MongoDB | **Resolved 2026-03-15** — 20 scouts, 419 advancement, 2,535 requirements loaded via Chrome CDP capture + mongosh import |
| gcloud gsutil re-auth failures | Switched to `gcloud storage cp` |
| Prompt caching broken | **Resolved 2026-03-21** — delimiter collision with BSA knowledge doc (78 occurrences of `---`). Fixed with unique delimiter. Saved ~$300/run. |
| Blind evaluator penalizing correct answers | **Resolved 2026-03-21** — evaluator lacked troop context and BSA facts. Fixed with panel evaluator + eval_notes. See `docs/reports/2026-03-21-eval-framework-discovery.md`. |

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
