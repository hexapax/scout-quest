# Alpha Evolution Roadmap

**Created:** 2026-04-26
**Status:** Planning (approved 2026-04-26)
**Supersedes (in part):** `docs/plans/2026-04-16-alpha-launch-plan.md` — that plan's streams A-F remain valid; this doc adds new streams G-J and re-sequences the remaining work.

## Where we are

Since the 2026-04-16 alpha-launch plan was written:

- **Stream A (roles)** — landed. Backend reads `users` collection, two personas, role-checked tools.
- **Stream B (history viewers)** — partial. `history.html` exists; voice persistence wired; no per-conversation summaries (today's gap).
- **Stream C (cost logging)** — landed. `message_usage` writes per assistant message.
- **Stream D (eval cleanup + multi-model tools)** — landed. v7 canonical, multi-turn tools on all major providers.
- **Stream E (UI polish + voice)** — partial. Role-aware UI partial; voice persists to history.
- **Stream F (alpha onboarding + ops)** — not started. No invite flow, no runbook, no GCP alerts, no welcome page.

## What's still missing for safe alpha

User-stated requirements (2026-04-26):

1. **Session memory** — agent should remember across sessions. ✅ Designed: [Scout State + Summaries](2026-04-26-scout-state-and-summaries.md)
2. **Tool logic hardening** — existing tools tested via evals; needs hardening pass for production
3. **Auth** — landed in Stream A
4. **Scoutbook sync** — landed; manual refresh workflow until BSA fixes 503 auth
5. **Parent chat visibility** — partial (Stream B); summaries close the gap
6. **Safety notifications for flagged content** — ✅ Designed: [Safety Flagging](2026-04-26-safety-flagging.md)
7. **CI/CD test system** — ✅ Designed: [Observability + CI/CD](2026-04-26-observability-cicd.md)
8. **Metrics & dashboards rework** — ✅ Designed: [Observability + CI/CD](2026-04-26-observability-cicd.md)
9. **Status boards & budget alerts** — ✅ Designed: [Observability + CI/CD](2026-04-26-observability-cicd.md)
10. **A/B environments with shared user data** — ✅ Designed: [Stable + Dev Environments](2026-04-26-ab-environments.md)

## Re-baselined stream map

```
Phase 0 — Stream A (DONE), Stream D (DONE)

Phase 1 — Foundation for safe alpha
  ├─ G. Scout State + Summaries          (closes session-memory gap)
  ├─ H. Safety Flagging + Notifications  (HARD prereq for real youth users)
  └─ B'. Stream B finish: voice integration into summaries, role-aware UI

Phase 2 — Operational confidence
  ├─ I. Observability + Budget Enforcement
  └─ J. CI/CD Eval Gates

Phase 3 — Pre-launch
  ├─ Stream F (onboarding flow, runbook, welcome page)
  └─ Tool logic hardening pass

Phase 4 — Launch + early access
  ├─ Stable launch with first 5-10 alpha cohort
  └─ Stream K. Stable + Dev environments (after stable users have a baseline)

Phase 5 — Post-launch
  └─ Iterate based on real usage
```

A/B (Stream K) intentionally lands AFTER initial alpha, not before. Reasoning: dev environment value depends on having an opinionated stable to compare against. Pre-launch dev-environment work would be premature.

## New Stream G — Scout State + Summaries

See [scout-state-and-summaries.md](2026-04-26-scout-state-and-summaries.md). Summary:

- New `scout_state` collection with rolling event log + LLM-generated rolling summary
- New `conversation_summaries` collection for per-conversation parent-facing recaps
- Wires episodes (already captured but unused) into next-session context
- Cost: <$0.01/conversation, all on Haiku

**Effort**: ~6 agent-days
**Blocks**: Stream B' completion, Stream H (safety classifier reads summaries)

## New Stream H — Safety Flagging

See [safety-flagging.md](2026-04-26-safety-flagging.md). Summary:

- Three-tier escalation framework adapted from Crisis Text Line
- Haiku-based classifier post-response (alpha); YouthSafe revisit at week 8
- Two-deep notifications (parent + scoutmaster) for Tier 2/3
- Mandated-reporter compliance — system surfaces, human files
- Trauma-informed framing in all parent communications

**Effort**: ~6 agent-days
**Blocks**: alpha launch (cannot expose youth without this)

## New Stream I — Observability, Budget, Status

See [observability-cicd.md](2026-04-26-observability-cicd.md) Phase weeks 1-3. Summary:

- Cost dashboards on existing `message_usage` (no Helicone)
- Per-user soft/hard daily budget with HTTP 402 cutoff
- Loop detection sidecar
- Prometheus + Grafana on the VM
- BetterStack status page

**Effort**: ~9 agent-days
**Blocks**: alpha launch (cannot accept users without budget guards)

## New Stream J — CI/CD Eval Gates

See [observability-cicd.md](2026-04-26-observability-cicd.md) Phase week 4. Summary:

- GitHub Actions eval-gate on PRs touching prompt/persona/tools/knowledge
- 5% quality regression = block merge
- Weekly full eval cron with trend dashboard
- Feature flags for canary rollouts

**Effort**: ~3 agent-days
**Blocks**: nothing critical for alpha launch, but every prompt edit before this lands is uncovered

## New Stream K — Stable + Dev Environments

See [ab-environments.md](2026-04-26-ab-environments.md). Summary:

- Per-user copy-on-opt-in fork of state into `scoutquest_dev` MongoDB
- Daily reconciliation: dev → summary → stable; never raw writes
- Schema additivity discipline
- Read-only Scoutbook from dev (no write-back risk)

**Effort**: ~7 agent-days
**Blocks**: nothing — POST-alpha work

## Stream B' — finish parent visibility

What's left of original Stream B after summaries land:

- [ ] Wire `conversation_summaries` into history.html as the default tab (raw transcript = secondary)
- [ ] Tier 2/3 safety banners on summary cards
- [ ] Aggregate troop view for scoutmaster (counts of safety events, top topics, scout activity heatmap)
- [ ] Parent-only "request transcript export" button (manual fulfillment in alpha)

**Effort**: ~2 agent-days
**Blocks**: alpha launch

## Stream F (carried forward) — onboarding + runbook

From the 2026-04-16 plan, still needed:

- [ ] Admin invite UI / seed script
- [ ] Welcome / consent page (now incorporates COPPA + safety system disclosures from Stream H)
- [ ] `docs/alpha-runbook.md` — debug, safety review, budget review, support flow
- [ ] `/api/health` coverage check + BetterStack hookup

**Effort**: ~3 agent-days
**Blocks**: alpha launch

## Tool logic hardening

Specific fixes called out by recent audits + this rework:

- [ ] `advance_requirement` tool: confirm scout email vs. tool's userId match before BSA write — currently relies on the persona context block
- [ ] `log_activity` tool: validate the activity matches a real Scoutbook event before writing
- [ ] `rsvp_event` tool: confirm scout is on the invitedUsers list before writing
- [ ] All tools: add input validation that returns helpful error to model on bad args (currently many silent failures)
- [ ] `search_bsa_reference` tool: make sure it's hitting FalkorDB and not hallucinating
- [ ] Add eval coverage for tool error paths — model should recover gracefully when a tool fails

**Effort**: ~3 agent-days
**Blocks**: alpha launch (write tools without input validation are dangerous)

## Critical path → alpha launch

```
Weeks 1-2 (parallel):
  ├─ Agent 1: Stream G (scout state + summaries)
  ├─ Agent 2: Stream H (safety flagging)
  └─ Agent 3: Stream I week 1-2 (cost viz + budget enforcement)

Week 3 (parallel):
  ├─ Agent 1: Stream B' (parent visibility finish, depends on G)
  ├─ Agent 2: Tool hardening
  └─ Agent 3: Stream I week 3 (Prometheus + Grafana + status page)

Week 4 (parallel):
  ├─ Agent 1: Stream F (onboarding + runbook + welcome)
  └─ Agent 2: Stream J (CI/CD eval gate)

Week 5: Pre-launch dry run
  ├─ Internal alpha (just Jeremy + son) for 7 days
  ├─ Calibrate safety classifier FPR
  ├─ Verify budget enforcement under real load
  └─ Fix what breaks

Week 6: External alpha launch (5-10 users)

Post-alpha (week 7+):
  ├─ Stream K (dev environments)
  └─ Iterate on stream H thresholds based on real safety data
```

**Realistic alpha launch: ~6 calendar weeks from 2026-04-26 → 2026-06-07.**

Aggressive (full-time, three-agent parallelism): 4 weeks → 2026-05-24.

## Decisions (2026-04-26)

1. **Hard prereq for first user**: Streams G + H + I-1/2 + B' + F + tool hardening. Without all of these, no real-youth alpha.
2. **CI/CD (Stream J) ships during pre-launch**, not as a hard prereq. We can manually ensure quality for the first PRs.
3. **A/B environments (Stream K) is post-alpha**. Reason: build it once we know what stable looks like; otherwise we're fork-testing a moving target.
4. **Calibration week mandatory**: 7-day internal dry-run before any external user. Goal: <5% Tier 2 false-positive rate, zero billing surprises.
5. **Three-agent parallelism is the assumed shape**, with Jeremy as integrator. Each agent works in a worktree to avoid `chat.ts` collisions (same lesson as the 2026-04-16 plan).

## Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Safety classifier misses real signal | Critical | Conservative thresholds; manual review queue; calibration week |
| Budget runaway | High | Hard $1/day cutoff per user; loop detector; Stream C cost logging |
| Voice transcripts go missing | Medium | Voice-persistence already wired; sweeper handles crashes |
| BSA write tools corrupt records | Medium | Tool hardening; dev environment is Scoutbook-read-only |
| Schema drift between dev and stable | Medium | Stream K's additivity hook; pre-commit check |
| Alpha user shares dev URL publicly | Low | Auth-gated; dev banner + opt-out clear |

## Out of scope for alpha

- Native mobile (still web-only per 2026-04-16 plan)
- Per-state COPPA variations beyond Georgia
- Self-hosted YouthSafe classifier (revisit week 8)
- Helicone gateway (revisit at scale)
- Bradley-Terry proper for evals
- Bedrock provider
- Quota billing/charging users
- Multi-troop tenancy (alpha is Troop 2024 only)

## What "alpha launch" means concretely

Externally:
- 5-10 real users (scouts + parents + leaders) with confirmed COPPA consent
- Public welcome page at scout-quest.hexapax.com explaining what alpha is
- Status page at status.troopquest.com
- 30-day commitment from Jeremy: respond to issues within 24h, post weekly update

Internally:
- All hard prereq streams green
- Calibration week complete with FPR <5%
- Eval scores green
- Per-user budgets configured
- Welcome / consent flow tested end-to-end with one external user (parent of a scout) before launch announcement
- Slack or ntfy channel for alpha-cohort feedback

## How this plan stays alive

- This doc gets updated weekly during the 6-week run-up. Status checkboxes filled in.
- Each design doc (G, H, I, J, K) gets a "Status" section appended as work progresses.
- `docs/development-state.md` gets a date-stamped update at end of each week reflecting current state.
- `docs/future-research.md` gets new dead-end / lesson entries when discovered.
