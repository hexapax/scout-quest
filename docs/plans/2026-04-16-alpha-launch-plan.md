# Alpha Launch Plan — 2026-04-16

## Context

We're preparing the first alpha with real scout + parent/leader users. This plan gets Scout Quest into a supportable, unified state across UIs, voice, evals, multi-model tool support, role-based chat history viewing, and cost accounting.

Findings driving this plan come from a 4-part audit (2026-04-16):
- **UI/voice** — `app.html` unified chat+voice is beta; `voice.html` mobile-stable; no parent/leader UI variants
- **Eval suite** — v7 canonical (`eval-sets/scout-eval-v7.yaml`), but v4/v5/v6/graph-v1 are superseded-but-present; TS harness deprecated; 165 tracked reports linger
- **Multi-model** — clean provider adapter pattern supports Anthropic + OpenAI-compat (Grok, OpenAI, OpenRouter). Gemini stubbed (converters exist, provider unwired). Custom-endpoint tool restriction is **LibreChat-only** — our home backend routes tools to every wired provider
- **Observability** — AdminJS `users` collection already has `roles[]`, `troop`, `scout_emails[]` but **backend never consults it** (admin via hardcoded email allowlist). No production cost logging.

---

## Goals

1. **Alpha-ready**: scouts, parents, and leaders can sign in, use chat/voice, and see appropriate chat history
2. **Role-driven**: one source of truth for roles; backend honors it; viewers filter by it
3. **Cost-accounted**: every production message has structured cost logged against user + scout + troop
4. **Uniform test suite**: v7 as canonical, superseded sets archived, tool support on all promising models
5. **Observable**: viewers exist for eval runs, chat history (per role), and cost dashboards

---

## Non-goals

- Billing/quota enforcement (log first, enforce later)
- O1/O3 tool support (tool-calling not guaranteed; defer)
- Native mobile app (Capacitor) — web-only for alpha
- Shimming tool calls via prompt engineering — document the pattern, don't build it unless a high-value model needs it

---

## Work streams

Six streams, with an explicit dependency graph. **Stream A is the critical path** — B, C, and E all depend on it.

```
           ┌─► B. History viewers (role-based)
A. Roles ──┼─► C. Cost logging (per user/scout/troop)
           └─► E. UI polish & voice reliability
               ▲
               │ (B provides parent/leader list views E consumes)

D. Eval suite cleanup + multi-model tools  (independent — runs in parallel)

F. Alpha onboarding & ops  (depends on A–E being stable)
```

### A. Role model — backend ↔ AdminJS alignment  `[CRITICAL PATH]`

**Problem**: `admin/src/models/scout-quest/user.ts` defines `roles[]`, `troop`, `scout_emails[]` for scouts/parents/leaders. `backend/src/chat.ts:87` hardcodes admin email allowlist. These two don't talk.

**Deliverables**:
1. Move the AdminJS `User` schema into a shared location (or duplicate it read-only in backend) so backend can query it.
2. New `backend/src/auth/role-lookup.ts`: given an authenticated email, return `{ role, troop, scoutEmails[], scoutId? }`. One-line admin fallback for Jeremy until the DB entry exists.
3. Replace hardcoded admin list in `chat.ts:23–28` with role lookup. Pass resolved role+troop through to tool filter and persona selector.
4. Extend `AppUser` type (`backend/src/types.ts`) with `role`, `troop`, `scoutEmails`. Expose via `/auth/me`.
5. Migration: ensure Jeremy's own user doc exists with role=superuser; seed script for first alpha users.

**Depends on**: nothing
**Blocks**: B, C, E
**Est**: 1–2 days for one agent
**File touchpoints**: `backend/src/auth/*`, `backend/src/chat.ts`, `backend/src/types.ts`, `backend/src/tools/definitions.ts`, `admin/src/models/scout-quest/user.ts`

### B. Role-based chat history viewers

**Problem**: `conversations` collection is `userEmail`-scoped only. No parent can see their scout's chat; no leader can see troop; admin is hardcoded. Voice sessions don't persist (`chat.ts:381` TODO).

**Deliverables**:
1. Schema extension: add `scoutEmail`, `troopId` to `conversations` (back-fill existing docs).
2. New endpoints:
   - `GET /api/history/mine` — own conversations (current behavior)
   - `GET /api/history/scout/:email` — parent→child (checks `scoutEmails` contains `:email`)
   - `GET /api/history/troop/:troopId` — leader (checks `role=leader && troop===troopId`)
   - `GET /api/history/all` — admin only
3. Single viewer UI (`backend/public/history.html`) with role-aware filters. Reuse chat bubble rendering from `app.js`. Show thinking blocks + tool calls + timings.
4. Wire voice→persistence: close the `chat.ts:381` TODO. Voice sessions write to `conversations` with `channel: "voice"` tag. ElevenLabs webhook stores final transcript.
5. Ensure tool call payloads (input, output, timing) are stored structured, not stringified.

**Depends on**: A (needs role + troop + scout_emails)
**Blocks**: F
**Est**: 2–3 days
**File touchpoints**: `backend/src/routes/conversations.ts`, new `backend/src/routes/history.ts`, `backend/src/voice-context.ts`, new `backend/public/history.html`

### C. Production cost logging

**Problem**: `eval_panel.py:34–49` hardcodes `PRICING` dict; evals log to `eval_usage`. Production chat returns `usage` in the response body and drops it. No way to answer "how much is this scout costing us?"

**Deliverables**:
1. Extract pricing into canonical source — YAML (`config/pricing.yaml` or augment `eval-sets/configs.yaml`). Both eval engine (`eval_panel.py`) and backend consume same source.
2. New `message_usage` MongoDB collection, schema mirrors `eval_usage` + `userEmail`, `scoutEmail`, `troopId`, `conversationId`, `channel` (chat/voice), `toolCallCount`, `provider`, `modelExact`.
3. Middleware/hook in `chat.ts` that writes one `message_usage` doc per assistant message. Capture cache_creation + cache_read separately (already extracted in `providers/anthropic.ts:136`, just never persisted).
4. Aggregation endpoint: `GET /api/cost/summary?scope=user|scout|troop|global&period=today|week|month`.
5. Extend eval-viewer or build `cost-viewer.html` with: spend by user, spend by scout, spend by model, spend by day. Admin-only.
6. **No enforcement** — just logging. Quota/throttling is post-alpha.

**Depends on**: A (need `userEmail → scoutEmail/troopId` to attribute cost)
**Blocks**: F
**Est**: 2 days
**File touchpoints**: `backend/src/chat.ts`, new `backend/src/cost/logger.ts`, new `backend/src/routes/cost.ts`, `scripts/eval_panel.py` (read pricing from shared YAML), new `backend/public/cost-viewer.html` (or extend eval-viewer)

### D. Eval suite consolidation + multi-model tool support

**Problem**: Test suite is functional but cluttered. v4/v5/v6/graph-v1 YAML sets still present; 165 tracked JSON reports from deprecated TS harness; Gemini/DeepSeek/Grok fall back to single-turn without tools in eval engine.

**Deliverables**:
1. **Archive superseded eval sets**: move v4/v5/v6/graph-v1 to `eval-sets/archived/` with a README noting their replacement in v7. Update `scripts/run-eval.py` to warn if archived sets are referenced.
2. **Purge deprecated TS reports**: move `mcp-servers/scout-quest/test/reports/` contents to an S3/GCS archive (or just delete — MongoDB has the canonical eval results). Update `.gitignore` to reject new reports in that path.
3. **Multi-turn tools for all providers** in `scripts/eval_engine.py`:
   - Extend OpenAI-compat loop (currently Anthropic-only) to Grok, DeepSeek, Gemini, OpenRouter. Backend already does this — port the logic.
   - Document which models we've verified tool-calling on (result matrix in `docs/model-capability-matrix.md`).
4. **Gemini provider** in backend (`backend/src/providers/gemini.ts`): tool-format converters already exist (`tool-format.ts:86–101`), just wire the adapter. ~1 day.
5. **Tool shimming stub**: design doc only for now in `docs/plans/2026-04-XX-tool-shimming.md`. Don't build unless a high-value model without native tools emerges.
6. **Verify xAI native-endpoint MCP claim**: actually test Grok with tools on LibreChat to close the CLAUDE.md uncertainty.

**Depends on**: nothing (can run parallel to A, B, C, E)
**Blocks**: F (alpha wants a clean matrix for "which models work reliably")
**Est**: 2–3 days
**File touchpoints**: `eval-sets/*`, `scripts/eval_engine.py`, `scripts/run-eval.py`, `backend/src/providers/gemini.ts`, `mcp-servers/scout-quest/test/reports/` (purge), `docs/model-capability-matrix.md`

### E. UI polish + voice reliability

**Problem**: `app.html` is unified but role-agnostic. No parent/leader variants. `voice.html` is stable after mobile audio unlock but doesn't persist to conversations.

**Deliverables**:
1. Role-aware `app.html`: fetch `/auth/me` once, render role-specific widgets:
   - **Parent**: "Your scouts" list → click → view chat history (reads `/api/history/scout/:email`)
   - **Leader**: "Your troop" roster + "Recent scout activity" feed
   - **Admin**: links to eval-viewer, cost-viewer, history/all, AdminJS
2. Voice conversation persistence (see stream B deliverable 4 — shared).
3. Voice agent-per-role: current single ElevenLabs `agent_id` limits personality tuning. Plan to add `scoutAgentId`, `parentAgentId`, `leaderAgentId` envs; domain-based selection becomes role-based.
4. Error surfacing: frontend toasts on SSE errors (currently swallowed). Log to a `client_errors` collection for debugging alpha user reports.
5. Kill unused `email.html` (legacy per audit). Confirm with grep before deleting.

**Depends on**: A (role), shares voice-persistence deliverable with B
**Blocks**: F
**Est**: 2–3 days
**File touchpoints**: `backend/public/app.html`, `backend/public/app.js`, `backend/public/voice.html`, `backend/src/routes/auth.ts` (/auth/me response shape)

### F. Alpha onboarding + ops

**Problem**: No way to invite a new alpha user today. No runbook if a parent reports "my scout's chat is broken". No central alpha status page.

**Deliverables**:
1. Invite flow: admin-side form (in AdminJS or a new `/admin-invite` page) creates a `User` doc with role + troop + scout_emails before the user signs in. First Google sign-in with matching email claims the doc.
2. Seed 5–10 alpha User docs (Jeremy picks the cohort).
3. Ops runbook `docs/alpha-runbook.md`: how to debug a user-reported issue (which logs, which collections, which viewer).
4. `/api/health` endpoint with DB + voice + provider checks (already partial — confirm coverage).
5. Alpha feedback channel: either a ntfy topic (already in stack) or a simple `feedback` collection + form.
6. Comms: short "welcome" page at `scout-quest.hexapax.com/welcome.html` explaining what alpha users get, what's not finished, how to report issues.

**Depends on**: A, B, C, E all green
**Est**: 2 days
**File touchpoints**: new `admin/src/pages/invite.tsx` or `backend/src/routes/admin-invite.ts`, new `docs/alpha-runbook.md`, new `backend/public/welcome.html`

---

## Should this be subagent-parallelized?

**Yes, but only for streams B/C/D/E after A lands.** Here's the honest calculus:

- **Streams B, C, E all block on A** — running them in parallel before A is done is wasted work (they'd build against a moving role model).
- **Stream D is fully independent** — can run in parallel with anything.
- **Total effort** is ~10–12 agent-days sequential, ~5–6 days with the below phasing.

**Recommended phasing**:

| Phase | Agents in parallel | Streams | Wall-clock |
|-------|-------------------|---------|------------|
| 1 | 1 agent (A) + 1 agent (D) | A, D | 2 days |
| 2 | 3 agents | B, C, E | 2–3 days |
| 3 | 1 agent (F) | F | 2 days |

Each agent gets:
- A dedicated worktree (`isolation: worktree`) so branches don't collide
- A self-contained brief with its stream's deliverables + the other streams' interfaces
- Mandate to commit early and push a draft PR, not merge to main

**When NOT to parallelize**: if I notice the streams are touching the same files (e.g., `chat.ts` is edited by A, B, and C), squash into sequential runs to avoid merge hell. `chat.ts` is a real risk — A touches auth + admin check, B touches persistence, C touches cost logging. May need one agent to own all chat.ts changes while others work around it.

---

## Cost accounting posture

Two things to get right for alpha:

1. **Parity between eval and production** — same pricing source, same schema, same aggregation. Today they diverge (hardcoded Python vs nothing-in-backend).
2. **Attribution chain** — every dollar must trace back to `(user, scout, troop, conversation, message, tool_calls[])`. Without this, we can't answer "why did this month cost $X?"

Data points to always capture per message:
- `provider`, `modelExact` (e.g., `claude-sonnet-4-6-20250514`)
- `prompt_tokens`, `completion_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- `cost_usd` (computed at write time with then-current pricing)
- `toolCalls[]` with name, duration_ms, success
- `latency_ms`, `ttfb_ms`
- `userEmail`, `scoutEmail`, `troopId`, `conversationId`
- `channel` (chat | voice), `elevenlabs_agent_id` (if voice)

This is uniform whether a message came from eval or production — a single `usage` collection with a `source: eval|prod` discriminator is cleaner than two collections.

---

## Decisions (answered 2026-04-16)

1. **AdminJS user docs**: none seeded. Stream F must create them as part of alpha onboarding. Keep the seed script small — this is also the migration tool for post-alpha growth.
2. **Alpha cohort**: 3–5 scouts, 2–3 parents/leaders. Scouts are **older** (self-directed) — prioritize scout-facing quality and parent/leader visibility over hand-holding features.
3. **Voice transcript storage**: we are authoritative. Store full transcripts in our `conversations` collection with `channel: "voice"`. ElevenLabs recording is secondary; we don't rely on it for history.
4. **Tracked TS reports**: deleted (commit `4509f5f`, 165 files / 247k lines removed). `.gitignore` updated to prevent new reports in that path.
5. **Alerting**: GCP Cloud Monitoring + alerting policies. Stream F owns the Terraform for alert policies + notification channels (email + ntfy). No PagerDuty.

## Scope adjustments from decisions

- **Stream A** — no existing AdminJS data to migrate from. Role lookup reads the `users` collection but the collection starts empty; backend falls back to a seeded admin allowlist (only Jeremy) until F seeds the alpha cohort. This means A can ship before F without breaking anything.
- **Stream F** — expanded to include:
  - A Terraform module `terraform/monitoring.tf` for GCP alert policies: backend 5xx rate, MongoDB connection failures, voice endpoint errors, per-user cost anomaly (>$X/day), Caddy reverse-proxy errors.
  - Notification channel: email (Jeremy) + ntfy topic for passive alerts.
  - Seed script `scripts/seed-alpha-users.ts` that takes a YAML of `{email, role, troop, scoutEmails[]}` and upserts `users` docs.
- **Stream E** — since alpha scouts are older, deprioritize hand-holding flows (tutorials, onboarding wizards). Prioritize: voice reliability, fast session start, clear "what happened" transparency (tool calls visible).
- **Stream B** — since parents *are* the leaders in our alpha, the parent and leader views collapse to a single "adult" view for the first cohort. Still build both endpoints (roles are orthogonal — one user can be both parent-of-X and leader-of-troop) but one UI page covers both initially.

## GCP alerting design sketch (stream F)

Target metrics (all via GCP Cloud Monitoring custom metrics emitted from backend):

| Metric | Threshold | Channel | Severity |
|--------|-----------|---------|----------|
| `backend_http_5xx_rate` | >2% over 5 min | email + ntfy | P1 |
| `mongodb_connection_errors` | >0 in 5 min | email + ntfy | P1 |
| `voice_signed_url_error_rate` | >10% over 10 min | email | P2 |
| `provider_api_error_rate` (per provider) | >20% over 10 min | email | P2 |
| `daily_cost_per_user_usd` | >$5/day for any user | email | P2 (budget guard) |
| `eval_viewer_uptime` | down >5 min | email | P3 |

Cost guard is critical — without it, a runaway provider loop could burn budget before we notice.

---

## Milestone exit criteria

- [ ] A: `chat.ts` consults `users` collection; `/auth/me` returns role+troop; hardcoded admin list gone
- [ ] B: parent can view scout's chat history via UI; voice sessions appear in history
- [ ] C: every production message writes to `message_usage`; cost-viewer shows per-user spend for last 7 days
- [ ] D: v7 is the only non-archived eval set in active use; eval engine runs multi-turn tools on Grok + Gemini + DeepSeek
- [ ] E: `app.html` renders role-specific widgets; voice persists
- [ ] F: 5+ alpha User docs seeded; runbook written; welcome page live
- [ ] All streams: no regressions on existing eval scores (>= current v7 baseline on canonical configs)

## Timeline estimate

Aggressive: 5 working days with 3-agent parallelism in Phase 2.
Realistic: 8–10 working days accounting for integration friction on `chat.ts`.
