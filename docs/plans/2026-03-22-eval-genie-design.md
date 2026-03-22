# Eval Genie — AI-Powered Multivariate Analysis of Eval Data

**Date:** 2026-03-22
**Status:** Planned
**Priority:** Medium
**Blocked by:** Nothing — data and infrastructure are ready

## Problem

The eval system now produces rich multi-axis data: 5+ scoring dimensions, across models, layers, knowledge configs, thinking parameters, and two spectres (knowledge, chain). Manually comparing results in the viewer works for simple "which model is best?" but can't answer deeper questions:

- Which config axis contributes most to coaching quality?
- Is there a statistically significant difference between layer-L2 and layer-L3?
- Do chain scores correlate with knowledge scores for the same model?
- What's the interaction effect between adaptive thinking and layer config?
- Which questions are the most discriminating (high variance across models)?

These require multivariate statistics — ANOVA, effect sizes, correlation matrices, regression, clustering — not just averages.

## Design: The Eval Genie

An AI reasoning assistant that translates natural language questions into statistical analysis of the eval data, using R for computation and an LLM for interpretation.

```
User question (natural language)
        ↓
  Reasoning LLM (cheap: GPT-nano or DeepSeek)
  - Understands the data schema
  - Translates question → R code
  - Knows available statistical tests
        ↓
  R Engine (via rpy2 or subprocess)
  - Executes the analysis
  - Returns tables, p-values, plots
        ↓
  Reasoning LLM (interprets results)
  - Summarizes findings in plain English
  - Flags caveats (small N, multiple comparisons)
  - Suggests follow-up analyses
        ↓
  Output: text summary + optional plots/tables
```

### Data Source

MongoDB `eval_results` collection (1,400+ docs, growing). The genie connects directly and queries by any axis combination.

**Available fields for analysis:**
- **Response variables:** per-dimension scores (accuracy, coaching, tool_accuracy, etc.), overall score
- **Factor variables:** model_id, provider, layer, knowledge, adaptive_effort, thinking_budget, config_id, perspective/spectre
- **Item variables:** question_id, category, question_type
- **Meta:** run_id, eval_version, timestamp

### Example Queries → R Analysis

| Question | Statistical Technique | R Function |
|----------|----------------------|------------|
| "Which model scores highest on coaching?" | One-way ANOVA + Tukey HSD | `aov()`, `TukeyHSD()` |
| "Does layer affect tool accuracy?" | Factorial ANOVA | `aov(score ~ layer * model)` |
| "Which questions discriminate best?" | Item discrimination (variance, point-biserial) | `var()`, `cor()` |
| "Do knowledge and chain spectres agree?" | Cross-spectre correlation | `cor.test()` |
| "What's the effect size of adding troop context?" | Cohen's d (L2 vs L3) | `effsize::cohen.d()` |
| "Cluster the models by scoring pattern" | Hierarchical clustering | `hclust()`, `dist()` |
| "Show me dimension correlations" | Correlation matrix + heatmap | `corrplot::corrplot()` |
| "Predict overall score from dimensions" | Multiple regression | `lm()`, `summary()` |

### Implementation

**File:** `scripts/eval_genie.py` (~400 lines)

```python
class EvalGenie:
    """AI-powered statistical analysis of eval data."""

    def __init__(self, mongo_uri, llm_provider="deepseek"):
        self.db = MongoClient(mongo_uri)["scoutquest"]["eval_results"]
        self.llm = CheapLLM(provider=llm_provider)
        self.r = REngine()  # rpy2 or subprocess

    def ask(self, question: str) -> str:
        """Answer a natural language question about eval data."""
        # 1. Describe available data to LLM
        schema = self._describe_data()
        # 2. LLM generates R code
        r_code = self.llm.generate_r_code(question, schema)
        # 3. Execute R
        result = self.r.execute(r_code)
        # 4. LLM interprets
        return self.llm.interpret(question, r_code, result)

    def _describe_data(self) -> str:
        """Describe available data for LLM context."""
        # Count docs, list distinct values per axis, sample scores
        ...
```

**CLI:**
```bash
# Interactive mode
python3 scripts/eval_genie.py

# Single question
python3 scripts/eval_genie.py "Which model is best at coaching?"

# Export analysis
python3 scripts/eval_genie.py --export report.html "Full model comparison"
```

**Dependencies:**
- `rpy2` (Python ↔ R bridge) or R subprocess
- R packages: `ggplot2`, `corrplot`, `effsize`, `lme4` (for mixed-effects)
- Cheap LLM API (DeepSeek or GPT-nano for code generation)

### Integration Points

- **Viewer:** "Ask Genie" button that opens a chat panel, sends question to `/api/eval/genie`, displays result
- **CLI:** Standalone script for terminal analysis
- **Reports:** Generate analysis summaries as markdown for docs/reports/

### Phased Approach

1. **Phase 1: R engine + schema description** — Connect to MongoDB, export to R data frame, describe schema
2. **Phase 2: LLM code generation** — Prompt engineering for R code from natural language
3. **Phase 3: Execution + interpretation** — Run R, capture output, LLM summarizes
4. **Phase 4: Viewer integration** — Chat panel in eval viewer
5. **Phase 5: Canned analyses** — Pre-built analyses that run automatically after each eval

### Cost

- R execution: free (local)
- LLM calls: ~$0.001 per question (DeepSeek or GPT-nano)
- One-time: R + rpy2 installation on devbox

### Risks

- R code generation hallucination — mitigate with schema constraints and validation
- Small sample sizes — many config combinations have < 10 observations. Genie should flag this.
- Plot rendering in viewer — may need to save as PNG and serve statically
