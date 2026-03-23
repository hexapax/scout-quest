# Eval Pivot Viewer — Dynamic Multi-Dimensional Data Explorer

**Date:** 2026-03-23
**Status:** Design
**Priority:** High — replaces the pattern of building fixed views that keep needing redesign

## Problem

The eval data has 8+ dimensions (model, spectre, layer, category, question, scoring dimension, config, run). Every time we want a new view ("compare models", "ablation by category", "spectre coverage"), we build a fixed HTML layout. This doesn't scale — the dimensions keep growing and the views keep needing rework.

We've already built and partially rebuilt: overview cards, score tables, comparison view, compact scorecard, portfolio dashboard. Each served one perspective on the data. The user keeps needing a different cut.

## Solution: Pivot Table

One generic viewer component where the user assigns dimensions to axes:

```
┌─────────────────────────────────────────────────────────────┐
│  Rows: [model_id     ▾]   Columns: [perspective ▾]         │
│  Metric: [overall_avg ▾]  Filter: [layer=full ▾] [+]       │
│  Presets: [Model Comparison ▾] [Save] [Clear]               │
├─────────────────────────────────────────────────────────────┤
│                 knowledge    chain    safety                 │
│  claude-son…       7.4        8.2       8.7                 │
│  gpt-4.1           7.3         —         —                  │
│  gemini-3…         7.9         —         —                  │
│  deepseek          7.6         —         —                  │
└─────────────────────────────────────────────────────────────┘
```

Change rows to `layer`, columns to `scoring_dimension`, filter to `model_id=claude-sonnet-4-6`:

```
┌─────────────────────────────────────────────────────────────┐
│  Rows: [layer        ▾]   Columns: [dimension   ▾]         │
│  Metric: [avg        ▾]   Filter: [model=claude ▾]         │
├─────────────────────────────────────────────────────────────┤
│               accuracy  specificity  safety  coaching troop │
│  persona-only     6.9       5.9       9.9      8.3    4.1  │
│  knowledge-only   7.3       6.7       9.8      8.6    4.4  │
│  knowledge+troop  7.5       6.8      10.0      8.6    6.0  │
│  full             7.4       6.7       9.7      8.1    4.7  │
└─────────────────────────────────────────────────────────────┘
```

Same component, same code, different axis assignment.

## Available Dimensions

| Dimension | MongoDB Field | Cardinality | Typical Role |
|-----------|--------------|-------------|--------------|
| **Model** | `model_id` | ~5 | Row or filter |
| **Spectre** | `perspective` | ~3 | Column or filter |
| **Layer** | `layer` | ~5 | Row (ablation) |
| **Category** | `category` | ~7 | Row or column |
| **Question** | `question_id` | ~54+ | Row (detail) |
| **Scoring Dim** | keys of `scores` | ~5 | Column |
| **Config** | `config_id` | ~25 | Row or filter |
| **Run** | `run_id` | ~20+ | Filter (temporal) |
| **Provider** | `provider` | ~5 | Filter or group |
| **Eval Version** | `eval_version` | ~3 | Filter (comparability) |

## Available Metrics

| Metric | Computation |
|--------|------------|
| **avg** | Mean of selected scoring dimension(s) |
| **overall_avg** | Mean across all scoring dimensions |
| **count** | Number of eval results |
| **min / max** | Range |
| **std** | Standard deviation (spread indicator) |
| **median** | Robust central tendency |

## Backend: `/api/eval/pivot`

```
GET /api/eval/pivot
  ?rows=model_id
  &columns=perspective
  &metric=overall_avg
  &filters=layer:full,eval_version:5
  &scoring_dim=accuracy    (optional: specific dimension, default=all)
```

Response:
```json
{
  "rows": ["claude-sonnet-4-6", "gpt-4.1", "gemini-3-flash-preview", "deepseek-chat"],
  "columns": ["knowledge", "chain", "safety"],
  "cells": {
    "claude-sonnet-4-6": {
      "knowledge": { "value": 7.4, "n": 54, "std": 1.8 },
      "chain": { "value": 8.2, "n": 1, "std": null },
      "safety": { "value": 8.7, "n": 17, "std": 0.9 }
    },
    "gpt-4.1": {
      "knowledge": { "value": 7.3, "n": 14, "std": 1.5 },
      "chain": null,
      "safety": null
    }
  },
  "row_labels": {
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "gpt-4.1": "GPT-4.1"
  },
  "column_labels": {
    "knowledge": "Knowledge (54q)",
    "chain": "Chain (4 chains)",
    "safety": "Safety (17q)"
  },
  "metadata": {
    "total_docs_queried": 300,
    "filters_applied": { "layer": "full", "eval_version": "5" },
    "metric": "overall_avg"
  }
}
```

### Special case: `columns=dimension`

When columns is set to `dimension`, the pivot expands scoring dimensions as columns instead of a MongoDB field. The backend computes per-dimension averages:

```json
{
  "rows": ["persona-only", "knowledge-only", "full"],
  "columns": ["accuracy", "specificity", "safety", "coaching", "troop_voice"],
  "cells": {
    "persona-only": {
      "accuracy": { "value": 6.9, "n": 14 },
      "specificity": { "value": 5.9, "n": 14 },
      ...
    }
  }
}
```

### Implementation

The backend builds a MongoDB aggregation pipeline dynamically:

```typescript
// Pseudocode
const pipeline = [
  { $match: buildFilterMatch(filters) },
  { $group: {
    _id: { row: `$${rowField}`, col: `$${colField}` },
    values: { $push: "$scores" },
    count: { $sum: 1 },
  }},
];
```

For `columns=dimension`, it's a different path — group by row only, then compute per-dimension stats in code.

## Frontend: Pivot Controls

```html
<div class="pivot-controls">
  <div class="pivot-axis">
    <label>Rows</label>
    <select id="pivot-rows" onchange="app.updatePivot()">
      <option value="model_id">Model</option>
      <option value="config_id">Config</option>
      <option value="layer">Layer</option>
      <option value="category">Category</option>
      <option value="question_id">Question</option>
    </select>
  </div>
  <div class="pivot-axis">
    <label>Columns</label>
    <select id="pivot-cols" onchange="app.updatePivot()">
      <option value="perspective">Spectre</option>
      <option value="dimension">Scoring Dimension</option>
      <option value="category">Category</option>
      <option value="layer">Layer</option>
      <option value="model_id">Model</option>
    </select>
  </div>
  <div class="pivot-axis">
    <label>Metric</label>
    <select id="pivot-metric" onchange="app.updatePivot()">
      <option value="overall_avg">Overall Average</option>
      <option value="avg">Dimension Average</option>
      <option value="count">Count</option>
      <option value="std">Std Dev</option>
    </select>
  </div>
  <div class="pivot-filters" id="pivot-filters">
    <!-- Dynamic filter chips added here -->
    <button onclick="app.addPivotFilter()">+ Filter</button>
  </div>
</div>
```

### Table Rendering

The pivot table is a simple HTML table with:
- Colored cells (same green/yellow/red scheme)
- `n=` count in small text under each value
- Null cells shown as `—` with muted background
- Click a cell to drill into those specific results
- Click a row/column header to sort

### Presets

Saved in localStorage and optionally in a YAML file:

```yaml
presets:
  model-comparison:
    label: "Model Comparison"
    rows: model_id
    columns: perspective
    metric: overall_avg
    filters: { layer: "full" }

  ablation:
    label: "Layer Ablation"
    rows: layer
    columns: dimension
    metric: avg
    filters: { model_id: "claude-sonnet-4-6" }

  category-breakdown:
    label: "Category Breakdown"
    rows: category
    columns: model_id
    metric: overall_avg
    filters: { perspective: "knowledge" }

  question-difficulty:
    label: "Question Difficulty"
    rows: question_id
    columns: model_id
    metric: avg
    filters: { perspective: "knowledge", layer: "full" }

  spectre-coverage:
    label: "Spectre Coverage"
    rows: config_id
    columns: perspective
    metric: count
    filters: {}
```

## Integration with Existing Viewer

The pivot viewer doesn't replace the existing per-report views — it sits alongside them:

```
Navigation:
  [Portfolio/Pivot] [Run History] [Launch Run →]
       ↓                ↓
  Pivot table       Report list
  (cross-run)       (per-run)
       ↓                ↓
  Click cell →     Click report →
  Filtered          Per-report
  results           scorecard
       ↓                ↓
       └──── Drilldown (question detail, response, assessors, TTS) ────┘
```

The pivot view is the homepage. "Run History" links to the existing report browser. Both drill down into the same per-question detail views.

## Integration with Genie

The Genie can suggest pivot configurations:

```
> "Where does Claude struggle most?"

Genie: I'll look at Claude's scores by category.

[Sets pivot: rows=category, columns=dimension, filter=model_id=claude-sonnet-4-6]

Category C (Requirements) has the lowest accuracy (5.4) and coaching (7.4).
Try drilling into C4 and C7 — they're the weakest individual questions.
```

The Genie's `query_results` tool could accept pivot parameters directly, making its analysis reproducible in the viewer.

## Implementation Plan

1. **Backend**: `/api/eval/pivot` endpoint (~150 lines in eval-reports.ts)
2. **Frontend**: Pivot controls + table renderer (~300 lines in eval-viewer.html)
3. **Presets**: 5 built-in presets, localStorage save/load (~50 lines)
4. **Wire as homepage**: Replace current browser as default view

## What This Replaces

| Old View | Pivot Equivalent |
|----------|-----------------|
| Overview cards | preset: model-comparison |
| Score table | preset: question-difficulty |
| Comparison view | preset: model-comparison with dimension columns |
| Portfolio dashboard | preset: spectre-coverage |
| Ablation analysis | preset: ablation |

One component, many views, zero code changes when a new dimension is added.
