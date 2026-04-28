# Stable + Dev Environments — Design

**Created:** 2026-04-26
**Status:** Design (approved 2026-04-26)
**Related:** `docs/plans/2026-04-26-alpha-evolution-roadmap.md`, `terraform/`, `devbox/`

## Problem

Once alpha users depend on Scout Quest, every change to chat logic, prompts, models, or tools risks breaking their experience or losing their data. We need a way to:

1. Test bleeding-edge changes (new models, new prompts, new tools, new Scoutbook write paths) on consenting users
2. Without ever putting alpha users' canonical state at risk
3. While letting opted-in dev users still benefit from validated improvements landed back in stable

We already have a **devbox VM** (`devbox/`) — but it's a single-developer playground, not a user-facing dev tier. This design extends that to a real "early access" channel.

## Anti-pattern: dual-write

The naive approach — every write goes to both stable and dev DBs — is a documented anti-pattern (see future-research notes). Two failure modes:
- Stable write succeeds, dev write fails (or vice versa) → silent inconsistency
- Cannot wrap in a single transaction (different DBs) → no atomicity

We avoid this entirely.

## Pattern: database branching with summary writeback

Inspired by Xata's database-branching pattern + event-sourced reconciliation (see research notes). Three rules:

1. **Stable is canonical.** Stable's logic is the only thing that ever writes to the canonical state.
2. **Dev forks at opt-in time.** Per-scout copy-on-write of relevant collections into a `dev_*` collection prefix. Dev never reads stable directly during a session.
3. **Dev → stable communicates via summaries, not raw writes.** Daily reconciliation: dev generates a summary of what changed in its sandbox, stable's logic decides what (if anything) to apply.

## Architecture

```
                          ┌─────────────────────────┐
                          │   STABLE INSTANCE       │
                          │   scout-quest.hexapax   │
   alpha users ─────────► │   (port 3090, prod)     │
                          │   DB: scoutquest        │
                          └────────────┬────────────┘
                                       │
                              opt-in fork (one-time)
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │   DEV INSTANCE          │
                          │   dev.troopquest.com    │ ◄──── opted-in users
                          │   (port 3091)           │
                          │   DB: scoutquest_dev    │
                          └────────────┬────────────┘
                                       │
                            daily summary writeback
                            (via stable's reconciler)
                                       │
                                       ▼
                          stable updates canonical state
```

### Single-VM, two-stack deployment

Reuse the existing dual-instance pattern (LibreChat ai-chat + scout-quest already share a VM). Add a third Docker Compose stack:

- `scout-quest-dev` on port 3091
- Subdomain `dev.troopquest.com` (Caddy reverse proxy)
- MongoDB: same VM, separate database `scoutquest_dev`
- Same Caddy auto-HTTPS

`config/scout-quest-dev/` directory with its own `librechat.yaml`, `docker-compose.override.yml`, `.env`. Diverges freely from `config/scout-quest/` — different model presets, different system prompts, different tool definitions.

## Data lifecycle

### Opt-in → fork

User signs into `dev.troopquest.com`. If they've never been there before:

1. Verify they have role + valid stable user doc (`scoutquest.users`).
2. Run `scripts/dev/fork-user.ts <email>`:
   - Copy user's `users` doc → `scoutquest_dev.users`
   - Copy user's `conversations` (last 30 days only) → `scoutquest_dev.conversations`
   - Copy user's `scout_state` doc → `scoutquest_dev.scout_state`
   - Copy user's `scout_episodes` (last 30 days) → `scoutquest_dev.scout_episodes`
   - Copy user's `conversation_summaries` (last 30 days) → `scoutquest_dev.conversation_summaries`
   - **NOT copied**: `scoutbook_*` collections (always read live from stable's mirror via cross-DB query — Scoutbook is one-source-of-truth)
   - **NOT copied**: `safety_events` (dev surfaces fresh, doesn't inherit history)
3. Stamp each copied doc with `forked_from_version: <stable_doc_version>` for drift detection.
4. Write a `dev_fork_records` doc tracking `(scoutEmail, forkedAt, forkedFromVersionMap)`.

### During dev usage

Dev session writes only to `scoutquest_dev.*`. Same code as stable, just different connection string. No dual-write. No live sync.

Reads of Scoutbook data (advancement, events, roster) go cross-DB to `scoutquest.scoutbook_*` — this is *read-only* on the stable side, safe to share.

### Daily reconciliation (dev → stable)

Cron job at 04:00 UTC:

```
For each user with a dev fork:
  1. Diff dev_*.scout_state.events against stable.scout_state.events
     since fork timestamp.
  2. Generate a "session summary" for each new dev conversation
     using stable's summarizer (Haiku w/ stable's prompt).
  3. Append-only: write summary entries to stable.conversation_summaries
     with provenance flag `source: "dev_reconciled"`.
  4. Append safe state events to stable.scout_state.events:
     - Allowlist of event types: `requirement_reported_complete`,
       `interest_expressed`, `goal_set` — observations only
     - DENIED on dev→stable: anything that triggered Tool calls
       writing to Scoutbook. Dev tool calls that wrote to Scoutbook
       happened on a sandboxed BSA token (see Scoutbook section);
       stable doesn't replay them.
  5. Re-run rolling_summary regeneration on stable using the
     unified event list.
  6. NEVER copy safety events from dev — re-run stable's safety
     classifier on dev conversations to produce fresh stable-side
     events. (Different prompts may flag differently; trust stable.)
```

What flows back: **summaries and observation events**. What never flows back: raw conversations, dev's safety judgments, dev tool-call side effects, dev model outputs.

### Drift detection

When reconciler runs on a dev fork:
- For each doc that was forked, compare stable's current `version` to `forked_from_version`.
- If stable changed in the meantime, flag the case for manual review (pause auto-reconcile, surface in admin UI).
- Manual review = Jeremy looks at "stable says X, dev observed Y" and decides which wins.

This is rare in alpha but inevitable. Better to pause and review than auto-merge bad data.

### Re-fork

If user has been on dev for >14 days, prompt them to re-fork: "Your dev workspace was forked 18 days ago. Stable has updated since. Re-fork to get current state? (Your dev-only conversations stay archived, won't be lost.)"

Re-fork = soft-delete current dev docs, run the opt-in fork again with current stable state.

### Promotion to stable

When a dev feature is validated:
1. Code change ships to stable via normal CI/CD.
2. `scout-quest-dev` config flag for that feature flips to "in-stable" (no longer dev-only).
3. Dev users automatically get the feature on stable on their next login (no data migration — schemas are additive).
4. The dev branch of the feature can be removed from `config/scout-quest-dev/`.

## Scoutbook integration in dev

**Critical**: dev cannot share a BSA write token with stable. If dev's prompt is buggy and tells Liam he completed Star req 5b, we can't have that auto-write to BSA.

Two options evaluated:

1. **Read-only dev** — dev cannot call any Scoutbook write tools. Tool definitions for `advance_requirement`, `rsvp_event`, `log_activity` etc. are removed from dev's `tools/definitions.ts`. Dev users see "this is dev — write-back disabled, observations only" banner.

2. **Sandboxed write token** — separate BSA test account or dry-run mode. BSA doesn't offer a sandbox, so this is not realistic.

**Decision**: option 1. Dev is read-only against Scoutbook. Stable is the only path that writes to BSA.

This is a feature, not a limitation — it lets us test risky tool changes (new prompts, new tool definitions, agent loop modifications) without any chance of corrupting actual Scoutbook records.

## Schema discipline

For dev → stable to work without migrations, schemas must be **additive-only across the dev/stable boundary**:

- Dev may *add* fields to documents.
- Dev may *not* rename, remove, or change the type of fields stable knows about.
- New fields default to optional; stable code reads with `?? defaultValue`.
- When dev features land in stable, the schema is already there because stable already accepted those fields as optional.

Enforce via:
- Document schemas in `backend/src/types.ts` use TypeScript optional properties for all dev-introduced fields.
- A pre-commit hook checks that no dev-side schema change touches `required` properties shared with stable.
- A weekly Jeremy-reviewed report compares dev's effective schemas vs. stable's.

## User experience

Banner on `dev.troopquest.com`:

> **You're using the experimental dev environment.** Features here are in testing — they may break or change. Your data here is a copy of your main account; daily summaries flow back to your main account, but raw dev conversations stay isolated. Switch to [scout-quest.hexapax.com] anytime.

User can opt out anytime. Opting out:
- Pauses dev access (returns to stable at next login).
- Dev fork stays on disk for 30 days in case they want to come back, then is purged.
- Last reconciliation happens at opt-out so summaries make it back to stable.

## Observability

Dev gets the same observability stack as stable (see `2026-04-26-observability-cicd.md`) but:
- Tagged `env: dev` in all metrics so dashboards can split.
- A "dev divergence" panel: which features are currently dev-only, who's opted in, last reconciliation success/fail.
- Dev cost is its own line on the budget dashboard. Hard cap: dev spend never exceeds 25% of stable spend per user.

## Implementation plan

| Step | Deliverable | Est |
|------|-------------|-----|
| 1 | Terraform: subdomain `dev.troopquest.com` → VM IP, Caddyfile entry | 0.25d |
| 2 | `config/scout-quest-dev/` skeleton — copy of scout-quest config | 0.25d |
| 3 | `scoutquest_dev` MongoDB DB initialization + Mongo connection setting in backend | 0.25d |
| 4 | Schema versioning: add `version` and `forked_from_version` to all forkable doc types | 0.5d |
| 5 | `scripts/dev/fork-user.ts` — one-shot fork command, idempotent | 1d |
| 6 | Dev-mode banner + opt-in/opt-out UI on auth flow | 0.5d |
| 7 | Tool definitions filter for dev: strip Scoutbook writes | 0.25d |
| 8 | Daily reconciliation cron in `mcp-servers/scout-quest/src/cron.ts` | 1.5d |
| 9 | Drift detection + manual-review admin queue | 1d |
| 10 | Re-fork + opt-out flows | 0.5d |
| 11 | Schema additivity pre-commit hook in `scripts/hooks/` | 0.5d |
| 12 | Dev observability: tags, divergence panel | 0.5d |
| 13 | Dry-run with one consenting user (Jeremy himself, then Jeremy's son) | — |

**Total: ~7 agent-days.**

## Risks

1. **Reconciliation drift**: dev observations fundamentally inconsistent with what later happens on stable. Mitigation: pause auto-reconcile + manual review.
2. **Dev stays diverged forever**: someone forks once, never re-forks, plays in a stale snapshot for months. Mitigation: 14-day re-fork prompt; 30-day stale lockout.
3. **Dev drains resources**: every fork is a copy. At 15 users × 30-day rolling forks, MongoDB usage ~doubles. At alpha scale negligible (~50MB), revisit at scale-up.
4. **Confusion about which env you're in**: visual distinction matters. Different background color or "DEV" header band, plus banner.

## Open questions

1. Should leaders/parents be able to see their scout's dev conversations? Default: yes for safety/visibility, but flag as `source: "dev"` clearly.
2. Should evals (eval-runner) be able to run against dev? Yes — that's actually the main thing dev is for. Eval suite gains an `env: stable | dev` config knob.
3. Voice: ElevenLabs agent IDs are per-instance. Dev needs its own agent or a shared agent with env-aware system prompt? Default: shared agent with dev-prefixed system prompt.

## Decisions (2026-04-26)

1. **One dev tier, not multi**: A and B in the user's framing collapses to "stable + dev." If we ever need a third (e.g., red-team), spin up a worktree, don't expose to users.
2. **Dev is opt-in, not opt-out**: alpha users default to stable. Power users + Jeremy's son sign into dev voluntarily.
3. **Daily reconciliation, not realtime**: 24h batch is enough resolution for alpha. Per-session option deferred until needed.
4. **Read-only Scoutbook from dev**: above.
5. **Stable's safety classifier is authoritative**: dev classifier output never reaches stable.
