# Eval Runner & Management Design

## Problem

The eval system is currently a Python script with CLI flags. As the evaluation methodology evolves (panel evaluators, new questions, eval_notes, layers), we need:

1. A way to configure and launch eval runs from the viewer UI
2. Versioned eval sets (questions, hints, scoring criteria) so results are traceable
3. A failure/bug tracking system for continuous improvement
4. A framework for making sense of data when the eval itself is changing

## Core Concepts

### Eval Sets

An **eval set** is a versioned collection of questions, eval notes, scoring criteria, and evaluator configuration. It's the "test suite" — everything that defines HOW we evaluate, separate from WHAT we evaluate (the model/system config).

```yaml
# eval-sets/scout-coach-v4.yaml
name: scout-coach
version: 4
description: "Panel evaluator with troop context and eval notes"
created: 2026-03-21
parent_version: 3  # tracks lineage

evaluator:
  type: panel  # or claude, gemini, gpt, multi
  scorer_model: claude-sonnet-4-6
  assessors:
    - role: claims
      model: deepseek-chat
      provider: deepseek
    - role: coaching
      model: gpt-4.1-nano
      provider: openai
    - role: troop
      model: grok-3-mini
      provider: openrouter

scoring:
  dimensions:
    - name: accuracy
      weight: 1.0
      description: "Factually correct BSA information"
    - name: specificity
      weight: 0.8
      description: "Specific details vs generic advice"
    - name: safety
      weight: 1.0
      description: "Correct YPT/safety guidance"
    - name: coaching
      weight: 1.0
      description: "Right approach for question type"
    - name: troop_voice
      weight: 0.7
      description: "Sounds like it knows THIS troop"

questions:
  - id: A1
    enabled: true
    category: A
    question: "Can a board of review reject me for not being active enough?"
    expected: "G2A: 'reasonable' standard..."
    eval_notes: null
    tags: [policy, advancement, bor]
    difficulty: medium
    added_in_version: 1

  - id: C4
    enabled: true
    category: C
    question: "What are the requirements for Citizenship in Society?"
    expected: "Current version from official requirements"
    eval_notes: "CIS was removed from Eagle-required list effective 2026-02-27..."
    tags: [requirements, eagle, version-history]
    difficulty: hard
    added_in_version: 1
    notes_added_in_version: 4  # tracks when eval_notes were added
```

### What Gets Versioned

| Component | Versioned In | Changes Tracked |
|-----------|-------------|-----------------|
| Questions (text, expected) | Eval set YAML | Version number bumps |
| Eval notes (hints) | Eval set YAML | notes_added_in_version field |
| Evaluator config | Eval set YAML | Evaluator type, models, prompts |
| Scoring dimensions/weights | Eval set YAML | Dimension changes |
| Model configs | Eval runner code | system_version in meta.json |
| Knowledge documents | File system | Tracked by system_version |

### Run Configuration (from viewer UI)

When launching a run from the viewer, you configure:

```yaml
# Generated at runtime, saved with results
run_config:
  eval_set: scout-coach-v4
  models:
    - claude              # select from available models
    - sonnet-adaptive-med
    - gemini3flash
  questions:
    include_categories: [A, B, C, D, E, F, G]  # or specific IDs
    exclude: [E5, E9]    # disable specific questions
    sample: 2            # N per category, null = all
  evaluator:
    override: null       # use eval set default, or override here
  budget: 10.00
  description: "Testing new eval notes on C4 and E4"
```

## Viewer UI: Eval Runner Tab

### Layout

```
┌─────────────────────────────────────────────────────┐
│ [Reports]  [Run Eval]  [Cost]                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Eval Set: [scout-coach-v4 ▼]                       │
│  Description: [________________________]            │
│  Budget: [$___10.00___]                             │
│                                                     │
│  ┌─ Models ──────────────────────────────────────┐  │
│  │ [x] Claude Sonnet 4.6                         │  │
│  │ [x] Sonnet 4.6 Adaptive Med                   │  │
│  │ [ ] Claude Opus 4.6                           │  │
│  │ [x] Gemini 3 Flash Preview                    │  │
│  │ [ ] GPT-4.1                                   │  │
│  │ ...                                           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Questions ───────────────────────────────────┐  │
│  │ Sample: [All ▼] [2/category] [specific]       │  │
│  │                                               │  │
│  │ A: Advancement Policy (8 questions)           │  │
│  │   [x] A1: Can a board of review...           │  │
│  │   [x] A2: My scoutmaster says...             │  │
│  │   ...                                         │  │
│  │ B: Troop Logistics (8 questions)              │  │
│  │   [x] B1: I don't really want to go...       │  │
│  │   ...                                         │  │
│  │ [Select All] [Deselect All] [Problematic Only]│  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ Evaluator ───────────────────────────────────┐  │
│  │ Type: [Panel ▼] [Claude] [Gemini] [GPT]       │  │
│  │ Include eval_notes: [x]                       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Estimated cost: $4.30 (4 models × 14 questions)    │
│                                                     │
│  [▶ Run Evaluation]                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Running State

When an eval is running, the tab switches to progress view:
- Progress bar per model
- Live score updates
- Cost accumulator
- Stop button
- Auto-transition to results when complete

## Failure Tracking

### Bug List

Every eval run that produces errors, parse failures, or surprising results generates entries in a bug/issue list:

```javascript
// MongoDB: eval_bugs collection
{
  _id: ObjectId,
  type: "error",          // error, parse_failure, surprising_score, evaluator_disagreement
  severity: "medium",     // low, medium, high, critical
  status: "open",         // open, investigating, fixed, wont_fix, duplicate

  // Context
  run_id: "2026-03-21_19-50-45",
  question_id: "C4",
  model: "layer-websearch",

  // Details
  title: "Web search exhausted 7 rounds without finding CIS requirements",
  description: "Model searched 7 times for Citizenship in Society requirements...",
  error_message: "Max tool rounds exceeded",

  // Resolution
  fix_description: null,
  fix_version: null,      // which eval set version fixed this

  created_at: ISODate,
  updated_at: ISODate,
}
```

### Automatic Bug Detection

After each eval run, automatically flag:
1. **Errors:** Any question that errored (API failure, parse error)
2. **Zero scores:** Any dimension scored 0 (likely parse failure)
3. **High evaluator disagreement:** Spread >= 5 across evaluators for same response
4. **Score regression:** Question scored significantly lower than historical average
5. **Tool failures:** Web search or BSA tool returned errors

### Feedback Cycle

```
Run eval → Auto-detect bugs → Triage (human reviews in viewer) →
  → Fix: update eval_notes, fix tool, improve question → New eval set version
  → Won't fix: mark as known limitation, add to documentation
  → Duplicate: link to existing bug
```

## Managing Shifting Goalposts

### The Problem

When we improve the eval system (better evaluator, more eval_notes, panel scoring), historical scores become incomparable. A score of 7.0 under eval:1 (blind) might be equivalent to 8.5 under eval:4 (panel with notes).

### Solutions

1. **Version tagging (implemented):** Every run records eval_version and system_version.

2. **Eval set lineage:** Each eval set version records its parent, creating a tree:
   ```
   v1 (blind) → v2 (troop context) → v3 (knowledge-grounded) → v4 (panel)
   ```

3. **Transition runs:** When changing eval versions, run the SAME responses through both old and new evaluators. This gives a calibration factor:
   ```
   Response X: eval:3 scored 6.5, eval:4 scored 8.0 → calibration: +1.5
   ```

4. **Comparable windows:** The viewer shows which runs are directly comparable (same eval set version) and which aren't. Runs from different versions get a warning icon.

5. **Question stability tracking:** Track which questions have stable scores across eval versions (these are reliable benchmarks) vs which are volatile (sensitive to evaluator changes). Stable questions form the "core benchmark" that's always included.

6. **Normalized scores:** Optionally compute z-scores within each eval version so that relative rankings are comparable even if absolute scores aren't.

## Implementation Phases

### Phase 1: Eval Sets as YAML (immediate)
- Move questions from Python code to YAML files
- Version the YAML with a version number
- Runner reads eval set YAML instead of hardcoded QUESTIONS list
- Results reference the eval set version

### Phase 2: Viewer Runner Tab (near-term)
- UI for selecting eval set, models, questions
- Launch eval from the viewer via API
- Real-time progress monitoring (already exists)
- Cost estimation before launch

### Phase 3: Bug Tracking (near-term)
- Auto-detect failures after each run
- Bug list view in viewer
- Triage workflow (mark as open/fixed/wont_fix)

### Phase 4: MongoDB Migration (when needed)
- Dual-write results to JSON + MongoDB
- Viewer reads from MongoDB
- Remove JSON from git

### Phase 5: Analytics (future)
- Response embeddings and clustering
- Bradley-Terry ranking
- Question quality analyzer
- Transition run calibration
