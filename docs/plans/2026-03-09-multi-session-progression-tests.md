# Multi-Session Progression Tests

**Date:** 2026-03-09
**Status:** Planning
**Depends on:** Test capture format (implement first)

## Problem

All existing test scenarios are single-session snapshots. None verify that the system tracks a scout's progress correctly across multiple sessions or that advancement reporting is accurate over time.

Specific gaps:
- No test chains session 1 state into session 2 (state persistence across sessions)
- No test verifies the coach reads prior-session mutations correctly
- No test measures advancement reporting accuracy ("where am I?" across a journey)
- No test validates the requirement state machine over its full lifecycle (not_started → in_progress → ready_for_review → signed_off)
- No test checks that progress summaries are accurate after multiple state changes

## Design

### Core concept: Session chains

A **session chain** is an ordered list of scenario steps where each step runs against the DB state left by the previous step. Unlike current scenarios (which reset between runs), chains preserve mutations.

```
Chain: "PM Req 2a Full Lifecycle"
  Step 1: Scout asks about requirements → coach reads state, reports not_started
  Step 2: Scout says "I started my budget" → coach calls advance_requirement(pm_2a, in_progress)
  Step 3: Scout logs 3 weeks of budget entries → coach tracks progress
  Step 4: Scout says "I finished my budget plan" → coach calls advance_requirement(pm_2a, ready_for_review)
  Step 5: Scout asks "where do I stand?" → coach reports accurate progress summary
  Step 6: (Guide session) Parent asks "how is he doing?" → guide reports accurate progress
```

Between steps, the harness:
1. Does NOT reset test data (preserves DB mutations from prior step)
2. Does NOT carry over conversation history (new session = new conversation)
3. Does record what the DB state looks like before and after each step

### What to evaluate per step

- **State accuracy:** Does the coach's verbal description match actual DB state?
- **Transition correctness:** Did the coach call the right tool with the right status?
- **Progress reporting:** When asked "where am I?", does the response match reality?
- **Continuity awareness:** Does the coach reference prior work appropriately?
- **No regressions:** Does the coach avoid re-advancing already-advanced requirements?

### Proposed chains

#### Chain 1: PM Req 2a — Budget Lifecycle (6 steps)
Tests the full requirement lifecycle from not_started through ready_for_review, including budget logging along the way.

#### Chain 2: Chore Streak + Savings Growth (4 steps)
Tests daily chore logging across sessions with accumulating savings. Verifies the coach reports correct streak count and savings total each session.

#### Chain 3: Multi-Requirement Progress Report (5 steps)
Starts with mixed requirement states (some not_started, some in_progress, one ready_for_review). Scout advances two requirements across sessions, then asks for a full progress report. Tests accuracy of the "where am I?" summary.

#### Chain 4: Goal Change Mid-Journey (4 steps)
Scout changes quest goal partway through. Verifies the coach adjusts budget projections and doesn't reference the old goal in later sessions.

#### Chain 5: Guide View After Scout Progress (3 steps)
Two scout sessions that make progress, then a guide session asking for a summary. Tests cross-role state consistency.

## Harness changes required

### 1. Session chain runner

New function `runChain(config, db, chain)` that:
- Seeds data once at chain start
- Runs each step as a separate `runScenario` call
- Skips `resetTestData` between steps (key difference)
- Records DB snapshots before/after each step
- Produces a chain-level report with per-step results

### 2. DB snapshot diffing

Before and after each step, snapshot relevant collections:
- `scouts` (quest_state, character)
- `requirements` (statuses)
- `chore_logs` (count)
- `budget_entries` (count, totals)

The diff becomes part of the evaluation context — the evaluator can verify the coach's claims match actual DB changes.

### 3. Chain-aware evaluator criteria

New or modified criteria for chain steps:
- **state_reporting_accuracy** — does the coach's text match the DB snapshot?
- **continuity_awareness** — does the coach acknowledge prior session context?
- **transition_correctness** — was the right state transition made?

### 4. ScenarioDefinition extension

```typescript
interface ChainStep {
  scenario: ScenarioDefinition;
  /** Override initial message for this step */
  initialMessage?: string;
  /** Expected DB state before this step runs */
  expectedStateBefore?: Partial<DBSnapshot>;
  /** Expected DB mutations after this step */
  expectedMutations?: string[];
  /** Additional evaluator context for this step */
  evaluatorContext?: string;
}

interface SessionChain {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
}
```

## Implementation order

1. **Test capture format** (separate task — do first)
2. DB snapshot utility (read collections, produce JSON diff)
3. Chain runner (extends harness, skips reset between steps)
4. Chain 1 scenario definition (PM Req 2a lifecycle)
5. Chain-aware evaluator additions
6. Remaining chains (2-5)

## Open questions

- Should the evaluator see prior steps' transcripts for continuity scoring, or only the DB snapshot? (Transcript would be more thorough but expensive.)
- Should we seed specific "mid-journey" states for chains 3-5, or always start from scratch?
- Do we need a separate evaluator prompt for chain steps, or can the existing one handle it with extra context?
