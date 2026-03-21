# Evaluation Changelog

This document tracks changes to both the **evaluation system** (test questions, scoring, evaluator) and the **system under evaluation** (models, knowledge, persona, tools). Each eval run references a version pair: `eval:X / system:Y`.

When interpreting score trends, changes in the eval version mean scores are not directly comparable to prior runs. Changes in the system version with the same eval version represent real improvement or regression.

---

## Eval System Versions

### eval:1 — Blind Evaluator (2026-03-20)
- 54 questions across 7 categories (A-G)
- Evaluator: Claude Sonnet 4.6 with 16-line scoring rubric
- Evaluator has NO access to BSA knowledge or troop context
- Evaluator assumes troop-specific references are hallucinations
- Scores troop voice systematically low
- **Known bias:** Penalizes models that use their knowledge effectively

### eval:2 — Troop-Aware Evaluator (2026-03-21)
- Same 54 questions
- Evaluator prompt updated with anti-hallucination-bias instructions
- Evaluator receives troop context (~11K tokens) to verify names, roles, customs
- Troop-specific references scored as positive signal
- **Impact:** Troop voice scores expected to increase +2-3 points; accuracy +1-2 on questions referencing troop data

### eval:3 — Knowledge-Grounded Evaluator (planned)
- Same 54 questions
- Evaluator receives full BSA knowledge document (177K tokens, cached)
- Evaluator can verify requirement details, policy citations, version changes
- **Impact:** Accuracy scores expected to increase significantly on categories C and E where requirement details matter
- **Cost:** ~$4/model (vs $0.05 for eval:1)

### eval:4 — Evaluator with Rebuttal Round (planned)
- Same 54 questions
- After initial scoring, model can rebut low accuracy scores with evidence
- Adjudicator re-scores considering rebuttal
- Triggered only when accuracy <= 5 or evaluator flags hallucination
- **Impact:** Further accuracy improvement, self-documenting disagreements
- **Cost:** ~$0.30/model additional (triggered selectively)

---

## System Under Evaluation Versions

### system:1 — Baseline (2026-03-20)
- Knowledge: 177K-token BSA document (interim-bsa-knowledge.md)
- Troop context: 11K tokens (troop-context.md)
- Persona: Model-specific variants (claude, gpt, gemini, grok)
- No thinking/reasoning
- No prompt caching
- Models tested: Claude Sonnet 4.6, GPT-4.1/mini/nano, Gemini 2.5 Flash/Lite, Gemini 3 Flash/3.1 Flash Lite, DeepSeek V3

### system:2 — GPT-5.4 Addition (2026-03-20)
- Same as system:1
- Added: GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano
- Finding: GPT-5.4 ($2.50/$15) ties Gemini 3.1 Flash Lite ($0.25/$1.50) at 7.3 avg

### system:3 — Manual Thinking (2026-03-20)
- Same knowledge/persona
- Added: Claude Sonnet 4.6 + manual thinking (4K budget)
- Added: Claude Opus 4.6, Claude Opus 4.6 + manual thinking
- Finding: Sonnet beats Opus on coaching (9.2-9.4 vs 8.4-8.5)
- Finding: Thinking helps troop voice (+0.5) but hurts Opus overall

### system:4 — Adaptive Thinking (2026-03-20)
- Same knowledge/persona
- Added: Sonnet Adaptive Low/Medium/High, Opus Adaptive Max
- Finding: Medium is the sweet spot (8.0 avg), beats high (7.8) and max (7.6)
- **Winner: Sonnet 4.6 Adaptive Medium**

### system:5 — Prompt Caching + Cost Tracking (2026-03-21)
- Added: Anthropic prompt caching (cache_control: ephemeral)
- Added: Budget enforcement (--budget flag)
- Added: MongoDB real-time cost tracking
- Added: Per-call usage recording
- **Impact on scores:** None (caching doesn't affect model behavior)
- **Impact on cost:** ~88% reduction on Anthropic input costs for subsequent calls

---

## Run Log

Each entry links an eval run to its version pair and key findings.

| Run Timestamp | Eval | System | Models | Questions | Description | Key Finding |
|--------------|:----:|:------:|--------|:---------:|-------------|-------------|
| 2026-03-20_05-55-20 | 1 | 1 | claude, gpt, gemini, deepseek, grok | 8 (F,G) | First partial run — F+G categories only | |
| 2026-03-20_17-04-08 | 1 | 1 | claude + 8 others | 54 | **12-model bake-off** | Claude 7.9, Gemini 3 Flash 7.6 best value |
| 2026-03-20_18-05-57 | 1 | 2 | gpt54, gpt54-mini, gpt54-nano | 54 | GPT-5.4 family evaluation | GPT-5.4 (7.3) doesn't justify price over Gemini 3.1 FL (7.3 at 10x less) |
| 2026-03-20_19-10-43 | 1 | 3 | claude, claude+think, opus, opus+think | 14 (F,G) | Thinking + Opus experiment | Sonnet+Think 8.3, Opus 8.0, Opus+Think 7.8 — overthinking hurts |
| 2026-03-20_19-59-01 | 1 | 4 | claude, sonnet-low/med/high, opus-max | 54 | **Adaptive thinking sweep** | Medium (8.0) > baseline (7.8) > high (7.8) > Opus max (7.6) |
| 2026-03-21_07-04-08+ | 1 | 5 | claude | 6 (G) | Caching + budget test runs | Verified caching works, budget enforcement works |

---

## Score Trend Expectations

When transitioning between eval versions, expect these score shifts:

| Transition | Accuracy | Specificity | Safety | Coaching | Troop Voice |
|-----------|:--------:|:-----------:|:------:|:--------:|:-----------:|
| eval:1 → eval:2 | +0.5 to +1.0 | +0.5 | ~0 | +0.5 | **+2 to +3** |
| eval:2 → eval:3 | **+1.5 to +2.5** | +0.5 | ~0 | ~0 | +0.5 |
| eval:3 → eval:4 | +0.5 to +1.0 | ~0 | ~0 | ~0 | ~0 |

These are not improvements in the models — they are corrections in the evaluator's ability to accurately score. The "real" scores were always higher; the evaluator just couldn't see it.

---

## How to Use This Document

1. **Before running an eval:** Check which eval version and system version you're using. Add `--desc` to tag the run.
2. **After running an eval:** Add a row to the Run Log.
3. **When changing the evaluator:** Increment the eval version and document what changed.
4. **When changing the model/knowledge/persona:** Increment the system version.
5. **When comparing scores across runs:** Only compare runs with the same eval version. If eval versions differ, refer to the Score Trend Expectations table to understand the expected shift.
