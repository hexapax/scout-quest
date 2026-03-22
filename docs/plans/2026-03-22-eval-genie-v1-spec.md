# Eval Genie v1 — First Pass Spec

**Date:** 2026-03-22
**Goal:** Build enough to test whether an AI research assistant with statistical tools can extract real insights from our eval data. Not production — exploratory.

## What v1 Does

Interactive REPL where you ask questions about eval data. The Genie queries MongoDB, runs stats, generates plots, and presents findings with confidence levels and caveats. It remembers context within a session and saves findings to disk.

## What v1 Does NOT Do

- No viewer integration (CLI only)
- No experiment design automation (manual for now)
- No pattern library (build that after we see what patterns emerge)
- No interactive Plotly dashboards (static plots only)
- No R — Python-native stats (scipy, statsmodels)

## Architecture

```
┌──────────────────────────────────────────────────┐
│  REPL (scripts/eval-genie.py)                    │
│  User types question → Genie responds            │
│  Session context preserved across turns           │
└──────────┬───────────────────────────────────────┘
           │
    Reasoning LLM (Anthropic Claude Sonnet)
    System prompt: statistician persona + tool descriptions
    Conversation history maintained in-memory
           │ tool calls
           ▼
┌──────────────────────────────────────────────────┐
│  Tool Functions (called by LLM via tool_use)     │
│                                                  │
│  DATA                                            │
│    describe_data(filter?) → axes, counts, gaps   │
│    query_results(filter, fields, limit?) → rows  │
│    list_runs() → run summaries                   │
│                                                  │
│  ANALYSIS                                        │
│    compare_groups(metric, group_by, filter?)      │
│      → means, SDs, t-test/ANOVA, effect sizes   │
│    correlate(dim_a, dim_b, filter?)               │
│      → r, p, N, scatter data                     │
│    distribution(metric, filter?)                  │
│      → histogram data, normality test            │
│                                                  │
│  VISUALIZATION                                   │
│    plot(spec) → saves PNG, returns path           │
│      types: bar, scatter, box, heatmap, forest   │
│                                                  │
│  OUTPUT                                          │
│    save_finding(claim, evidence, caveats)         │
│      → writes to docs/genie/findings/            │
└──────────────────────────────────────────────────┘
```

## Tool Definitions

### describe_data
```
Input: { filter?: { perspective?, config_id?, layer?, model_id?, category?, run_id? } }
Output: {
  total_docs: int,
  perspectives: { name: count },
  config_ids: { name: count },
  layers: { name: count },
  model_ids: { name: count },
  categories: { name: count },
  question_ids: [str],
  run_ids: [str],
  score_dimensions: [str],
  date_range: { earliest: str, latest: str },
  gaps: [str]   // e.g., "layer-L1 has only 5 results"
}
```

### query_results
```
Input: {
  filter?: { same as above + question_id?, eval_version? },
  fields: [str],       // e.g., ["config_id", "question_id", "scores.accuracy", "scores.coaching"]
  group_by?: str,      // aggregate by this field
  limit?: int          // default 100
}
Output: [{ field: value, ... }]   // raw rows or aggregated groups
```

### list_runs
```
Input: {}
Output: [{ run_id, perspective, configs, item_count, date, description }]
```

### compare_groups
```
Input: {
  metric: str,              // "accuracy", "overall_score", "coaching", etc.
  group_by: str,            // "layer", "config_id", "model_id", "category"
  filter?: {},
  test?: "auto" | "t_test" | "anova" | "mann_whitney" | "paired"
}
Output: {
  groups: [{ name, N, mean, sd, median, min, max }],
  test: {
    name: str,              // "One-way ANOVA", "Paired t-test", etc.
    statistic: float,
    p_value: float,
    significant: bool,      // at α=0.05
    effect_size: float,     // Cohen's d or η²
    effect_label: str,      // "small", "medium", "large"
  },
  pairwise?: [{ a, b, diff, p, significant }],   // Tukey HSD if ANOVA significant
  power: {
    achieved: float,        // post-hoc power
    n_needed_80: int,       // N per group for 80% power at observed effect
  },
  warnings: [str]           // e.g., "Non-normal distribution", "Unequal group sizes"
}
```

### correlate
```
Input: {
  x: str,                  // dimension or field name
  y: str,
  filter?: {}
}
Output: {
  r: float,                // Pearson correlation
  p_value: float,
  N: int,
  r_squared: float,
  interpretation: str,     // "moderate positive correlation"
  data_points: [{ x, y, label }]   // for plotting
}
```

### distribution
```
Input: {
  metric: str,
  filter?: {},
  group_by?: str           // optional split by group
}
Output: {
  overall: { mean, sd, median, skew, kurtosis, shapiro_p },
  groups?: [{ name, mean, sd, median, N }],
  histogram: { bins: [float], counts: [int] }
}
```

### plot
```
Input: {
  type: "bar" | "box" | "scatter" | "heatmap" | "forest" | "interaction",
  title: str,
  data: {},                 // type-specific data structure
  filename?: str            // defaults to auto-generated
}
Output: { path: str }       // path to saved PNG
```

Plot types for v1:
- **bar**: group means with error bars (CI or SD)
- **box**: distribution per group
- **scatter**: two variables with regression line
- **heatmap**: correlation matrix or scores × questions grid
- **forest**: effect sizes with CIs for multiple comparisons

### save_finding
```
Input: {
  claim: str,               // "BSA knowledge improves accuracy by +1.3 points"
  confidence: "low" | "medium" | "high",
  evidence: {},             // test results, N, runs used
  caveats: [str],
  next_steps?: [str]
}
Output: { path: str }       // path to saved finding markdown
```

## Genie System Prompt (abbreviated)

```
You are Eval Genie — a research statistician helping analyze AI evaluation data.

Your job is to help the user find real signals in noisy eval data. You have
tools to query MongoDB, run statistical tests, and generate plots.

PRINCIPLES:
1. Always report effect sizes, not just p-values. A significant p with tiny
   effect is not interesting. A large effect with p=0.08 might be.
2. Always report confidence intervals when possible.
3. Flag when sample sizes are too small for reliable inference.
4. Distinguish "no effect found" from "not enough data to tell."
5. When results are ambiguous, suggest what experiment would resolve it.
6. Present findings at three levels: headline, evidence, caveats.
7. Generate plots when they'd clarify the finding — don't just dump numbers.

DATA CONTEXT:
- MongoDB collection: eval_results in scoutquest database
- Documents have: perspective, config_id, model_id, layer, knowledge,
  question_id, category, scores (dict of dimension→value), overall_score,
  run_id, eval_version, timestamp
- Score dimensions vary by perspective:
  - knowledge: accuracy, specificity, safety, coaching, troop_voice
  - chain: tool_accuracy, coaching_quality, state_awareness, character_voice, safety
  - safety: safety_compliance, boundary_firmness, emotional_handling,
    escalation_judgment, manipulation_resistance
- Key config axes: model_id, layer, knowledge, adaptive_effort

COMPARABILITY:
- Only compare results with the same eval_version (evaluator changed between versions)
- Results from different run_ids CAN be compared if same eval_version
- Rescored results (evaluator="panel-v2") used updated assessor prompts — note this
- The evaluator field tracks which panel version scored each result

When the user asks a question, think about:
1. What data do I need? (use describe_data or query_results)
2. What's the right statistical test? (depends on # groups, paired vs independent, normality)
3. Is the sample size adequate? (flag if not)
4. What visualization would help? (generate one if it adds clarity)
5. What can I NOT conclude from this data? (always state limitations)
```

## Implementation Plan

### Files to create:
- `scripts/eval_genie.py` — REPL + LLM orchestration (~300 lines)
- `scripts/genie_tools.py` — Tool implementations (MongoDB queries, scipy stats, matplotlib plots) (~400 lines)

### Dependencies (already available or pip install):
- `scipy` — t-test, ANOVA, Mann-Whitney, Shapiro, correlation
- `matplotlib` — static plots
- `numpy` — array ops for stats
- `anthropic` — Claude API for reasoning

### REPL flow:
```
$ python3 scripts/eval-genie.py

🧞 Eval Genie v1 — Research Assistant
   Data: 1,500 eval results across 3 spectres
   Type your question, or 'help' for examples.

> Is there a significant difference between L0 and L3 on accuracy?

[Genie queries data, runs paired t-test, generates box plot]

  L0 vs L3 on accuracy (paired, same 14 questions):

    L0: M=6.9, SD=2.1 | L3: M=7.5, SD=1.6
    Paired t(13) = -1.42, p = 0.18
    Effect: d = 0.35 (small-medium)

    ⚠ Not significant at α=0.05, but effect size is non-trivial.
    ⚠ Low power (0.28) — need N≥52 questions to detect d=0.35 at 80% power.

    📊 Box plot saved: docs/genie/plots/L0-vs-L3-accuracy.png

    Suggestion: Run 38 more questions at L0 and L3 to get adequate power,
    or pool with other runs if eval_version matches.

> What about across all dimensions, not just accuracy?

[Genie runs MANOVA or multiple comparisons]
...
```

### Estimated cost per session:
- Reasoning LLM: ~$0.05-0.20 (Sonnet, short context, multiple tool turns)
- Tools: free (local computation)
- Plots: free (matplotlib)
- Total: ~$0.10-0.30 per research session

## Success Criteria for v1

1. Can answer "is X different from Y?" with proper statistical tests
2. Correctly flags when N is too small
3. Generates at least 3 plot types that are actually useful
4. Saves a finding that a future session can reference
5. Doesn't hallucinate statistics — all numbers come from tool results
6. Costs < $0.50 per research session

## What We Learn from v1

- Does the tool-calling pattern work, or does the LLM pick wrong tests?
- Are the tool outputs structured enough for the LLM to interpret?
- What questions do we actually ask that v1 can't handle?
- Is the data schema rich enough, or do we need more fields?
- How much hand-holding does the LLM need in the system prompt?

These answers shape v2: pattern library, experiment design, viewer integration.
