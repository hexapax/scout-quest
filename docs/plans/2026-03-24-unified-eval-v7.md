# Unified Eval System v7 — Implementation Plan

**Date:** 2026-03-24
**Status:** Plan
**Priority:** High — unifies two harnesses into one evaluation system
**Depends on:** FalkorDB pipeline (done), multi-turn engine (done), stateful tool handlers (done)

## Problem

Two separate evaluation paths exist:

1. **Python eval engine** (`scripts/eval_engine.py`) — 89 questions (v6 + graph-v1), multi-turn, tool dispatch for all providers (Anthropic, OpenAI, Gemini, DeepSeek, Grok, OpenRouter), per-question fixtures, panel evaluation, rebuttal mechanism, per-turn timing.
2. **TypeScript test harness** (`mcp-servers/scout-quest/test/`) — 22 scenarios + 4 chains (30 steps), richer scenario definitions (scoutSimPrompt, expectedTools, evaluationWeights, preStepMutations), but Anthropic-only, separate execution path.

**Goal:** One Python engine, one YAML eval set, all providers, all test types.

## Inventory

### Keep (Python)
- scout-eval-v6.yaml: 71 questions (knowledge, safety, coaching, values)
- scout-eval-graph-v1.yaml: 18 questions (graph-proactive, cross-ref, state-aware)

### Convert (TS → YAML)

**15 scenarios** (after dedup — 7 dropped as duplicates):

| New ID | Source | Tests | Tools |
|--------|--------|-------|-------|
| TW1 | daily-chore | Chore logging workflow | `log_chore` |
| TW2 | budget-entry | Budget data collection | `log_budget_entry` |
| TW3 | requirement-advancement | Requirement state machine | `advance_requirement` |
| TW4 | goal-change | Goal update + recalculation | `update_quest_goal` |
| TW5 | counselor-prep | Email + YPT + plan | `compose_email`, `update_quest_plan` |
| TW6 | cringe-recovery | Tone adjustment | `adjust_tone` |
| TW7 | off-topic | Scope adherence | none expected |
| TW8 | onboarding | First session protocol | `log_session_notes` |
| TW9 | sensitive-topic | Sensitivity + FL 6b | `adjust_tone`, `advance_requirement` |
| TW10 | S4 (ask-requirements) | Read-only info | none expected |
| TW11 | S6 (compose-email) | Email + YPT CC | `compose_email` |
| TW12 | S9 (time-mgmt) | Socratic schedule build | `setup_time_mgmt` |
| TW13 | S10 (diary) | Diary entry | `log_diary_entry` |
| TW14 | S12 (wrapup) | Session notes | `log_session_notes` |
| TW15 | S13 (multi-turn) | Extended multi-tool session | multiple |

**5 guide scenarios**:

| New ID | Source | Tests |
|--------|--------|-------|
| GE1 | G1 (view-progress) | Parent reads scout summary |
| GE2 | G2 (onboard-scout) | Full onboarding flow (6-7 tools) |
| GE3 | G3 (adjust-character) | Lower domain intensity |
| GE4 | G4 (flag-conversation) | Flag concern + reminder |
| GE5 | G5 (review-chores) | Honest chore reporting |

**4 chains** (25 steps, guide chain deferred to Phase 4):

| Chain | Steps | Key Test |
|-------|-------|----------|
| chore-streak | 4 | Cross-session savings accuracy ($120→$122→$129) |
| pm-req-2a-lifecycle | 6 | Full requirement lifecycle: check → log → submit → verify |
| one-month-sprint | 11 | Sustained accuracy over 11 sessions, external mutations |
| guide-progress-check | 4 | Parent-facing, cross-endpoint consistency |

### Dropped (duplicates)

| TS Test | Replaced By | Why |
|---------|-------------|-----|
| S1 (session-start) | TW8 (onboarding) | TW8 has richer sim prompt |
| S2 (log-chores) | TW1 (daily-chore) | TW1 has richer sim prompt |
| S3 (log-budget) | TW2 (budget-entry) | TW2 has richer sim prompt |
| S5 (advance-req) | TW3 (requirement-advancement) | TW3 has richer sim |
| S7 (off-topic) | TW7 (off-topic) | TW7 has richer sim |
| S8 (goal-update) | TW4 (goal-change) | TW4 has richer sim |
| S11 (tone-adjust) | TW6 (cringe-recovery) | TW6 has richer sim |
| X1 (model-comparison) | Runner `--config` flag | Meta-scenario, not a test |
| X2 (system-prompt-AB) | Runner `--layer` flag | Meta-scenario, not a test |

## Final Counts

| Category | Count |
|----------|-------|
| v6 knowledge/safety/values | 71 |
| graph-v1 proactive/cross-ref | 18 |
| Tool workflow (new) | 15 |
| Guide endpoint (new) | 5 |
| **Standalone questions** | **109** |
| Chain steps | 25 |
| **Total evaluable items** | **134** |

## New YAML Fields

```yaml
- id: TW1
  question: "hey I did my chores today"
  domain: tool_workflow
  endpoint: scout                    # NEW: "scout" (default) or "guide"
  max_turns: 10

  follow_ups:                        # NEW: scout simulator config
    scout_sim_prompt: |              # LLM persona for generating replies
      You are Will, 14, just did dishes and trash...
    initial_message: "hey I did my chores today"

  expected_tools: [log_chore]        # NEW: tools model SHOULD call
  expected_not_tools: [advance_requirement]  # NEW: tools model should NOT call

  expected_state:                    # NEW: DB assertions after execution
    - "chore_logs: +1"
    - "savings: $120 -> $122"

  eval_context: |                    # NEW: extra context for scorer
    Coach should call log_chore with chores_completed=['dishes','trash'].
    Should report streak count and earnings.

  eval_weights:                      # NEW: per-question dimension weights
    tool_accuracy: 1.5
    state_awareness: 1.2

  fixtures:                          # Existing, expanded
    scout:
      chore_list: [...]
```

**Chain format:**
```yaml
chains:
  - id: chore-streak
    name: "Chore Streak + Savings Growth"
    endpoint: scout
    fixtures: { ... }               # Shared across all steps
    steps:
      - id: log-chores-day-1
        initial_message: "hey I did my chores today"
        scout_sim_prompt: |
          You are Will...
        max_turns: 8
        expected_tools: [log_chore, log_session_notes]
        expected_state: ["chore_logs: +1", "savings: $120 -> $122"]
        pre_mutations: []           # DB changes before this step
      - id: check-savings
        initial_message: "how much have I saved so far?"
        pre_mutations:              # Simulate time passing
          - collection: chore_logs
            update: { ... }
```

## New Scoring Dimension

```yaml
- name: character_consistency
  weight: 0.8
  description: >-
    Stays in character across turns. Maintains persona, adapts tone when asked.
    For chains: consistent across steps.
```

## Engine Changes

### eval_engine.py

1. **Scout simulator**: When `follow_ups.scout_sim_prompt` exists, use it as system prompt for GPT-4.1-nano instead of generic `_auto_respond()`. Gives scenario-specific, deterministic-ish scout behavior.

2. **Expected tools assertion**: Post-execution, compare `tool_call_log` against `expected_tools`. Store pass/fail in `raw_data["expected_tools_check"]`.

3. **Expected state verification**: For chain steps, snapshot DB before/after, compare against `expected_state` assertions.

### perspectives/knowledge.py

4. **Chain execution**: `resolve_items()` parses YAML `chains` section. `execute()` detects chain items and runs steps sequentially with shared `TestState`. Pre-mutations applied between steps.

5. **Guide endpoint routing**: When `endpoint: guide`, load guide persona and guide tool set.

### eval_tools.py

6. **Pre-mutations**: `TestState.apply_mutation(mutation)` for chain pre-step DB changes.

7. **Snapshot diff**: `TestState.diff_snapshots(before, after)` for state verification.

8. **Guide tools**: 12 new tool definitions for guide endpoint (read_linked_scouts, flag_conversation, adjust_character, 6 onboarding tools, etc.)

## Viewer Updates

### New home screen
- Running evals (poll progress endpoint)
- Last 5 completed runs (model, score, cost, timestamp)
- Quick-launch buttons

### Chain visualization
- Connected step cards in sequence
- Per-step: score, expected tools pass/fail, DB diff summary
- Click to expand full transcript

### Question row enhancements
- Expected tools: green check / red X / yellow warning badges
- Endpoint: `[SCOUT]` / `[GUIDE]` badge
- Chain membership indicator

### Timing improvements
- Per-turn breakdown (stacked bar: model + tools)
- Already captured in `turn_timings`, just needs rendering

## Cleanup & Deprecation

1. Add `DEPRECATED.md` to `mcp-servers/scout-quest/test/`
2. Remove `scripts/perspectives/chain.py` (absorbed into knowledge.py)
3. Replace `--perspective chain` with `--chain <id>` flag
4. Update `CLAUDE.md` eval section
5. Update `docs/DOCS-INDEX.md`

## Implementation Phases

| Phase | What | Effort | Depends On |
|-------|------|--------|------------|
| **1** | YAML schema + engine (follow_ups, expected_tools, chains) | 4-6h | — |
| **2** | Convert 15 TS scenarios to YAML | 3-4h | Phase 1 |
| **3** | Convert 3 scout chains to YAML (21 steps) | 6-8h | Phase 1 |
| **4** | Guide endpoint (tools + 5 questions + 1 chain) | 4-6h | Phase 2, 3 |
| **5** | Viewer (home screen, chains, badges, timing) | 6-8h | Phase 3, 4 |
| **6** | Cleanup + deprecation | 2-3h | Phase 4 |
| **Total** | | **25-35h** | |

Phases 1-3 are the critical path. 4-6 can run in parallel after 3.

## Cost Estimates (per model, full v7)

| Tier | Items | Claude | DeepSeek | Gemini Flash |
|------|-------|--------|----------|--------------|
| 109 standalone questions | 109 | ~$5.50 | ~$0.70 | ~$1.50 |
| Panel eval overhead | 109 | ~$1.70 | ~$1.70 | ~$1.70 |
| Rebuttal | 109 | ~$0.50 | ~$0.10 | ~$0.10 |
| 25 chain steps | 25 | ~$3.00 | ~$0.40 | ~$0.80 |
| **Total per model** | **134** | **~$11** | **~$3** | **~$4** |

Use `--sample N` to reduce: `--sample 2` runs ~30 items instead of 134 (~25% cost).
