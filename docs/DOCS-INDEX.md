# Scout Quest Documentation Index

## How to Navigate This Documentation

Start with **strategy.md** for why this project exists, then **development-state.md** for what's built and what's next. The eval system has its own documentation tree rooted at **eval-methodology.md**.

## Document Map

### Project Vision & Status
| Document | Purpose | Read When |
|----------|---------|-----------|
| [strategy.md](strategy.md) | Project vision, goals, strategic direction | First time, or to understand "why" |
| [development-state.md](development-state.md) | Current state of every component, critical path to MVP | Starting a new session |
| [scout-quest-requirements.md](scout-quest-requirements.md) | Full product requirements | Planning features |
| [scout-quest-character.md](scout-quest-character.md) | Character system design (Woody archetype) | Tuning persona |

### Architecture & Infrastructure
| Document | Purpose | Read When |
|----------|---------|-----------|
| [architecture.md](architecture.md) | System architecture (Caddy, LibreChat, backend, MCP) | Understanding the stack |
| [future-research.md](future-research.md) | Evaluated options, constraints, dead ends | Before pursuing new integrations |
| [bsa-api-reference.md](bsa-api-reference.md) | BSA/Scoutbook API endpoints | Working on data sync |
| [scoutbook-data-refresh.md](scoutbook-data-refresh.md) | Manual data refresh procedure | Refreshing scout data |

### Evaluation System (read in this order)
| Document | Purpose | Read When |
|----------|---------|-----------|
| [eval-methodology.md](eval-methodology.md) | **Start here.** Triangulation approach, techniques, philosophy | Understanding the eval strategy |
| [eval-perspectives.md](eval-perspectives.md) | 7 evaluation perspectives with cross-validation strategy | Planning what to test next |
| [eval-changelog.md](eval-changelog.md) | Versioned history of eval system AND system under evaluation | Interpreting scores across runs |
| [eval-runner-design.md](eval-runner-design.md) | Eval runner UI, eval sets, bug tracking, shifting goalposts | Building eval tooling |
| [eval-version-chain.md](eval-version-chain.md) | Version provenance chain — how versions flow through the eval system | Before comparing eval results across runs, or investigating score changes |
| [eval-data-architecture.md](eval-data-architecture.md) | MongoDB schema, GCS assets, migration plan | Working on eval data pipeline |

### Reports (chronological findings)
| Document | Purpose | Date |
|----------|---------|------|
| [reports/2026-03-20-model-eval-results.md](reports/2026-03-20-model-eval-results.md) | 12-model comparison + adaptive thinking results | 2026-03-20 |
| [reports/2026-03-21-eval-framework-discovery.md](reports/2026-03-21-eval-framework-discovery.md) | "The Blind Evaluator" — how we found the scoring flaw | 2026-03-21 |
| [reports/2026-03-21-ranking-cross-validation.md](reports/2026-03-21-ranking-cross-validation.md) | Ranking vs scoring disagreement analysis | 2026-03-21 |
| [reports/2026-03-20-vector-search-findings.md](reports/2026-03-20-vector-search-findings.md) | Vector search experiment results | 2026-03-20 |
| [reports/2026-03-20-project-progression.md](reports/2026-03-20-project-progression.md) | Project progression narrative | 2026-03-20 |

### Plans (in docs/plans/)
Design specs and implementation plans for specific features. See directory listing.

## Key Concepts

### The Evaluation System

The eval system uses **multiple independent perspectives** to assess the Scout Coach AI:

```
Perspective 1: Knowledge & Coaching  — Can it answer questions correctly?
Perspective 2: Chain / Session       — Can it sustain a multi-turn conversation with tools?
Perspective 3: Safety / Adversarial  — Does it hold firm under pressure?
Perspective 4: Persona Stability     — Does it stay in character over time?
Perspective 5: Retrieval Quality     — Does RAG find the right information?
Perspective 6: User Simulation       — Can it handle realistic scout personas?
Perspective 7: Regression            — Does it maintain quality after changes?
```

Within each perspective, we use **triangulation** — multiple independent validation approaches:
- **Panel evaluation**: Cheap models observe (claims, coaching, troop), Claude judges
- **Listwise ranking**: 3 judges rank responses, Borda count aggregation
- **Score-rank cross-validation**: Do scores and rankings agree?
- **Eval notes / rubrics**: Ground truth facts prevent evaluator hallucination

### Version Tracking

Two independent version axes track changes:
- **Eval version** (eval:1-5): How we evaluate (evaluator config, questions, rubrics)
- **System version** (system:1-5): What we evaluate (model, knowledge, tools, thinking)

Only compare scores from the same eval version. See [eval-changelog.md](eval-changelog.md).

### Cost Awareness

API costs are tracked per-call in MongoDB. Key guidelines:
- Use `--budget` flag on all eval runs
- Use `--sample N` for iterative testing (2/category = 14 questions)
- Panel evaluator is cheaper AND more accurate than single-model
- Prompt caching reduces Anthropic costs by ~88% when working correctly
- Ranking costs ~$0.01/question (3 cheap judges)

## Architecture Decisions

| Decision | Choice | Why | Revisit If |
|----------|--------|-----|-----------|
| Primary model | Claude Sonnet 4.6 | Best coaching (8.4), best character | A cheaper model matches coaching quality |
| Thinking mode | Adaptive Medium | 8.0 avg, beats High (7.8) and Max (7.6) | New thinking modes released |
| Budget model | Gemini 3 Flash Preview | 7.6-8.0 at $0.50/$3 | Gemini GA with stable pricing |
| Evaluator | Panel (multi-model) | More accurate, cheaper, catches blind spots | Single model proves equally reliable |
| Ranking | Listwise Borda (3 judges) | Rich signal, $0.01/question | Need confidence intervals (switch to BT) |
| TTS | ElevenLabs v3 | Best emotion/intonation, custom voices | Cost becomes prohibitive |
| Data store | MongoDB | Already running, fits eval documents | Need SQL joins or pgvector |
| Eval viewer | Single HTML file | Matches codebase pattern, no build step | Needs React-level interactivity |

## What's Not Built Yet — Prioritized Backlog

| # | Component | Priority | Status | Blocked By |
|---|-----------|----------|--------|-----------|
| 1 | **ElevenLabs voices in viewer** — wire as primary TTS, browser as fallback | High | Ready | Nothing |
| 2 | **Viewer chain display** — transcript viewer, tool call log, DB diff, hallucination badges | High | Ready | Nothing |
| 3 | **Safety/adversarial spectre** — red-team questions as a new eval spectre | High | Ready | Need to write questions |
| 4 | **Eval Genie** — AI-powered multivariate analysis of eval data via R | Medium | [Planned](plans/2026-03-22-eval-genie-design.md) | Nothing |
| 5 | **Viewer runner tab** — configure + launch evals from browser | Medium | Ready | Nothing |
| 6 | **Rankings for chains** — extend run-ranking.py with `--perspective chain` | Medium | Ready | Nothing |
| 7 | **Layer ablation with chains** — run chains with L0-L3 layer configs | Medium | Ready | Nothing |
| 8 | **Bug tracking system** — auto-detect failures, triage workflow | Medium | Design exists | Nothing |
| 9 | **Bradley-Terry with confidence intervals** | Low | Borda sufficient for now | Nothing |
| 10 | **TTS audio caching in GCS** | Low | Nice to have | Nothing |

### Recently Completed (2026-03-22)

| Component | Status |
|-----------|--------|
| **Chain spectre integration** — unified multi-perspective eval framework | Done |
| **Perspective interface (EvalPerspective protocol)** — extensible plugin system | Done |
| **RunConfig multi-axis system** — model/layer/knowledge/params as independent axes | Done |
| **Unified eval runner** (`scripts/run-eval.py`) with `--spectre`, `--config` | Done |
| **Panel evaluator extraction** — config-driven, perspective-agnostic | Done |
| **MongoDB migration** — 1,387 docs backfilled with perspective + config axes | Done |
| **Viewer dynamic dimensions** — auto-detect score dimensions from data | Done |
| **Spectre badges in viewer** — [CHAIN] labels on non-knowledge runs | Done |
