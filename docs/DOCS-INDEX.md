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

## What's Not Built Yet

| Component | Priority | Blocked By |
|-----------|----------|-----------|
| Viewer runner tab (launch evals from browser) | High | Nothing — ready to build |
| Chain test integration with new eval framework | High | Porting TypeScript harness |
| Safety/adversarial test questions | High | Nothing — need to write questions |
| Bug tracking system | Medium | Nothing — design exists |
| Layer ablation (L0-L5) | Medium | FalkorDB not on devbox for L4 |
| Bradley-Terry with confidence intervals | Low | Borda count is sufficient for now |
| TTS audio caching in GCS | Low | Nothing — nice to have |
| Response embedding for all historical results | Low | Running but not critical |
