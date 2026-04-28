# Observability, CI/CD & Budget Alerts — Design

**Created:** 2026-04-26
**Status:** Design (approved 2026-04-26)
**Related:** `docs/plans/2026-04-16-alpha-launch-plan.md` (Stream C cost logging, Stream F GCP alerts), `docs/plans/2026-04-26-alpha-evolution-roadmap.md`

## Problem

Stream C of the alpha-launch plan got per-message cost logging into MongoDB. Stream F sketched GCP alert policies. Neither is enough for alpha:

- We have data but no dashboards anyone looks at.
- We have no CI gates — a bad prompt change can ship without anyone noticing eval scores dropped.
- We have no per-user budget enforcement. A runaway tool loop on one user could burn the month's budget in an hour.
- We have no status page parents/leaders can check ("is the assistant working right now?").

Build a phased observability + CI/CD stack that's cheap to operate (single dev, tight budget), avoids vendor lock-in, and detects the LLM-specific failure modes (loops, token explosions, provider degradation, quality regressions).

## Design principles

- **One VM, no new infra**. Everything lives on the existing GCP VM unless the value is overwhelming.
- **MongoDB is already the source of usage truth** — Stream C wrote `message_usage`. Build dashboards on top of that, don't introduce a parallel store.
- **Hard cutoffs > soft cutoffs for alpha**. Better to interrupt a chat with "you've hit your daily limit" than to wake up to a $400 bill (we've been there — see CLAUDE.md note).
- **CI gates eval quality**. A prompt or model change that drops eval scores >5% doesn't merge.
- **Status page is for users**, not for me. Public uptime + recent incidents.

## Stack at a glance

| Layer | Tool | Why | Where |
|-------|------|-----|-------|
| Cost telemetry | existing `message_usage` collection (Stream C) | already there, MongoDB-native | per-message hook in chat.ts |
| Cost dashboard | new `backend/public/cost-viewer.html` extended from eval-viewer | reuse | in-repo |
| Per-user budget enforcement | new middleware on chat.ts | fail-fast | TS code |
| Loop detection | new monitor sidecar reading `message_usage` | catches token velocity | cron sidecar |
| Application metrics (rates, latency) | Prometheus + `prom-client` in TS | open, free, integrates with Grafana | sidecar |
| Dashboards | Grafana | self-hosted, $0 | sidecar |
| Alerting | Grafana alerting → email + ntfy | already in stack | configured |
| CI eval gate | GitHub Actions + `scripts/run-eval.py` | reuse existing | .github/workflows/ |
| Status page | self-hosted Cachet OR BetterStack free tier | public, parents can check | TBD |
| Uptime probe | UptimeRobot free tier | external | external |

Helicone-as-gateway was evaluated and **deferred**. Pros: rich features, semantic caching. Cons: another moving part, adds ~70ms latency per call, vendor dependency. Stream C's MongoDB-native logging covers the cost-telemetry need. Revisit when we need semantic cache or A/B test routing.

## Cost dashboards (week 1)

Extend `backend/public/eval-viewer.html` (or fork to `cost-viewer.html`) to show:

- **Spend over time**: daily total, last 30 days, line chart
- **Spend by user**: leaderboard, top 5 last 7 days
- **Spend by scout** (parent's view shows their kids only)
- **Spend by model**: pie + trend
- **Spend by provider** (anthropic / openai / gemini / openrouter)
- **Spend by source**: chat / voice / summary / safety / eval / cron
- **Cache hit rate**: prompt-caching savings — already captured in `cache_creation_input_tokens` / `cache_read_input_tokens` per Stream C
- **Per-conversation cost histogram**: helps spot outlier expensive conversations

All read from `message_usage` via aggregation pipelines. Admin-only via existing `/auth/me` role check.

## Per-user budget enforcement (week 2)

New collection `user_budgets`:
```ts
interface UserBudget {
  scoutEmail: string;
  daily_soft_limit_usd: number;        // default 0.50
  daily_hard_limit_usd: number;        // default 1.00
  monthly_soft_limit_usd: number;      // default 10.00
  monthly_hard_limit_usd: number;      // default 25.00
  notes?: string;                      // why this user has a custom limit
  set_by: string;                      // admin email
  updated_at: Date;
}
```

Middleware in `chat.ts` runs **before** the model call:

```ts
// Budget gate
const today_spend = await sumUserSpend(scoutEmail, "day");
const month_spend = await sumUserSpend(scoutEmail, "month");
const budget = await getBudget(scoutEmail);

if (today_spend >= budget.daily_hard_limit_usd) {
  return res.status(402).json({
    error: "daily_limit_reached",
    message: "Coach is taking a break for today — chat resumes tomorrow.",
    retry_after: tomorrowMidnight(),
  });
}

if (today_spend >= budget.daily_soft_limit_usd) {
  // Fire ntfy alert to admin (rate-limited 1x/user/day)
  notifySoftLimit(scoutEmail, today_spend, budget);
  // But still allow the request — soft is informational.
}
```

User-facing 402 message is gentle — alpha scouts shouldn't feel "blocked." The agent itself, on a 402, can say "let's pick this back up tomorrow!"

Defaults sized for alpha:
- $0.50 daily soft = roughly 10 turns of normal chat
- $1.00 daily hard = roughly 20 turns
- $25 monthly hard ≈ 250 turns/month — generous for an active scout, hard cap on disasters

## Loop detection (week 2)

Cron sidecar runs every 60s, reads recent `message_usage`:

```ts
// Triggers per research
const TOKEN_VELOCITY_PER_MIN = 20_000;     // tokens for any one user in 60s
const IDENTICAL_PROMPT_BURST = 5;          // same prompt hash 5x in 60s
const PER_CONV_COST_CEILING_USD = 5.00;    // single conversation cost

interface LoopAlert {
  scoutEmail: string;
  type: "token_velocity" | "prompt_repeat" | "conv_cost_ceiling";
  severity: "warning" | "critical";
  evidence: object;
}
```

`critical` triggers immediate ntfy + temporary user-level kill switch (writes to `user_budgets.daily_hard_limit_usd = 0`). Jeremy reviews and resets manually.

## Prometheus + Grafana (week 3)

Add `prom-client` to the backend. Expose `/metrics` (basic-auth protected) with:

- `chat_request_total{provider, model, status}` (counter)
- `chat_request_duration_seconds{provider, model}` (histogram)
- `chat_tokens_total{provider, model, kind=prompt|completion|cache_create|cache_read}` (counter)
- `chat_cost_usd_total{provider, model, source}` (counter)
- `safety_event_total{tier, category}` (counter)
- `tool_call_total{tool_name, success}` (counter)
- `tool_call_duration_seconds{tool_name}` (histogram)
- `mongodb_op_duration_seconds{collection, op}` (histogram)

Prometheus runs in Docker on the same VM, scrapes /metrics every 30s, retains 30 days.

Grafana on the same VM (Docker), reads Prometheus + MongoDB (via the official Mongo plugin or direct query through eval-viewer's existing aggregation endpoints). Dashboards:

1. **Operations**: request rate, p50/p95/p99 latency, error rate, all by provider+model
2. **Cost**: same chart set as cost-viewer but real-time
3. **Safety**: tier-1/2/3 counts, time-since-last, by category — Jeremy's morning glance
4. **Quality**: latest eval scores per config, trend over last 30 days
5. **Health**: VM cpu/mem, MongoDB ops/sec, voice signed-URL error rate, FalkorDB query latency

Caddy adds `grafana.troopquest.com` (admin-auth) routing to internal Grafana port.

## Alert rules (week 3)

Configured in Grafana, fires to ntfy + email:

| Rule | Window | Threshold | Severity | Action |
|------|--------|-----------|----------|--------|
| Backend 5xx rate | 5m | >2% | P1 | page Jeremy |
| MongoDB connection errors | 5m | >0 | P1 | page Jeremy |
| Voice signed-URL error rate | 10m | >10% | P2 | email |
| Provider error rate | 10m | >20% any provider | P2 | email |
| Daily cost per user | 1d | >150% of monthly avg | P2 | email + budget review queue |
| Token velocity | 1m | >20K tokens/user | P1 | page + auto-pause that user |
| Cache hit rate | 1h | <20% | P3 | email (might indicate prompt change) |
| Safety Tier 3 fired | — | any | P0 | page (already in safety design) |
| Eval CI regression | per-PR | quality drop >5% | block merge | GitHub status |

## Status page (week 3)

**Decision**: BetterStack free tier (10 monitors free). Self-hosted Cachet considered but the operational overhead doesn't pay back at our scale.

Public URL: `status.troopquest.com`. Components shown:
- Scout chat
- Voice chat (ElevenLabs)
- Scoutbook data freshness ("last synced: 6h ago")
- Email notifications
- Admin panel

Auto-update via BetterStack webhook → small Caddy-fronted endpoint that reads our `/api/health` (already exists, `2026-04-16` Stream F deliverable 4) and posts component status.

Manually-posted incidents when something breaks.

## CI/CD (week 4)

GitHub Actions workflow `.github/workflows/eval-gate.yml`:

```yaml
on:
  pull_request:
    paths:
      - 'backend/src/persona*'
      - 'backend/src/tools/**'
      - 'backend/src/providers/**'
      - 'backend/knowledge/**'
      - 'eval-sets/**'
      - 'scripts/eval_*'

jobs:
  eval-quick:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-python
      - install deps
      - run: python3 scripts/run-eval.py \
              --eval-set scout-eval-v7.yaml \
              --config claude \
              --sample 5 \
              --budget 2.00 \
              --output-format ci
      - check: latest_score >= main_baseline - 0.5
```

Hard rules:
- PR cannot merge if score drops >5%
- PR running >$2 in CI evals = something is wrong, abort
- Main branch ships only after a green eval-gate run on the PR

Weekly:
- Friday cron runs full v7 across 5 configs against main HEAD ($25 budget), posts to Grafana eval-quality dashboard
- Adds a row to `docs/eval-changelog.md`

Manual:
- "Promote to dev" = no eval requirement, dev users opt in to risk
- "Promote to stable" = full eval gate must pass

## Canary deployment (week 4)

For risky changes (new provider, new tool, big prompt rewrite):

1. Land in dev first → validate with consenting users
2. When ready: ship behind a feature flag (per-user toggle)
3. Roll to 10% of stable users for 24h, watch error rate + cost + safety events
4. Expand to 50% for 24h
5. Full rollout

Feature flag store: simple `feature_flags` collection, evaluated per-request.

## Cost of the observability stack itself

| Component | Monthly |
|-----------|---------|
| Helicone | $0 (deferred) |
| Prometheus + Grafana on existing VM | $0 |
| BetterStack free tier | $0 |
| UptimeRobot free | $0 |
| GitHub Actions for CI evals | ~$5/month CI compute + $3-5 in eval API spend |
| ntfy (existing) | $0 |
| **Total new spend** | **<$10/month** |

## Implementation plan

Phased per the research recommendation (week 1 → 4):

### Week 1: Cost visibility
- [ ] Extend eval-viewer aggregations for cost dimensions
- [ ] Build `cost-viewer.html` (or just add tabs to eval-viewer)
- [ ] Daily-spend-anomaly alert (one rule, MongoDB query, ntfy)
- [ ] Spot-check that Stream C wrote good data — fix gaps

### Week 2: Budget enforcement + loop detection
- [ ] `user_budgets` collection + admin UI to set per-scout budget
- [ ] Budget gate middleware in chat.ts (soft+hard)
- [ ] Loop detection cron sidecar
- [ ] User-level kill switch (write hard limit = 0)
- [ ] Soft-limit ntfy notifications

### Week 3: Metrics + dashboards + alerts + status page
- [ ] `prom-client` instrumentation in backend
- [ ] Prometheus + Grafana Docker compose stack
- [ ] Caddy routes for grafana.troopquest.com (admin)
- [ ] Build the 5 Grafana dashboards
- [ ] Wire alert rules (table above)
- [ ] BetterStack status page + webhook

### Week 4: CI/CD gates + canary
- [ ] `.github/workflows/eval-gate.yml`
- [ ] PR template asking "did you run an eval?"
- [ ] Friday-cron full eval suite + Grafana panel
- [ ] `feature_flags` collection + middleware
- [ ] Document the canary process in `docs/alpha-runbook.md`

**Total: ~12 agent-days across 4 weeks (calendar) or ~6 days of focused work.**

## Open questions

1. **Helicone revisit trigger?** When prompt-caching gets sophisticated enough that we'd benefit from semantic cache. Probably 6+ months out.
2. **Grafana auth**: oauth2-proxy already runs on the VM for `jeremy.hexapax.com`. Reuse vs. Grafana's built-in basic auth? Default: oauth2-proxy for consistency.
3. **Can we afford a managed status page?** BetterStack paid is $25/month. Free tier covers 10 monitors which is enough. Stay free until alpha is past 50 users.

## Decisions (2026-04-26)

1. **MongoDB-native cost telemetry, not Helicone** — defer.
2. **Hard limits at $1/day per user** during alpha — generous for normal use, fast-stop on loops.
3. **CI eval gate is mandatory** for PRs touching prompt/persona/tools/knowledge — no exceptions.
4. **Status page public** — parents can self-serve "is the system up."
5. **One observability stack, dev + stable share dashboards** — split by `env` tag, not separate Grafana instances.
