# Archived eval sets

Superseded YAML eval sets, kept for historical re-runs and provenance. New
work should target `eval-sets/scout-eval-v7.yaml` (the canonical set) unless
you are intentionally reproducing an older eval result.

Archived on 2026-04-16 as part of the alpha launch plan (Stream D).

| File | Replaced by | Notes |
|------|-------------|-------|
| `scout-coach-v4.yaml` | `scout-eval-v7.yaml` | Early knowledge set; used `category` field. Structure pre-domain. |
| `scout-coach-v5.yaml` | `scout-eval-v7.yaml` | Added `domain`, capability tagging, assessor role prompts; still only knowledge. Was the default for `knowledge` perspective. |
| `scout-eval-v6.yaml` | `scout-eval-v7.yaml` | 71 questions (knowledge + safety + coaching + values); merged into v7. |
| `scout-eval-graph-v1.yaml` | `scout-eval-v7.yaml` | 18 graph-flavored questions (graph-proactive, cross-ref, state-aware); merged into v7 as dedicated domain. |

## Why archive instead of delete?

The eval-results MongoDB collection stores `eval_set` + `version` fingerprints.
Historical runs reference these files; deleting would break
`compute_version_fingerprint` and `diff_version_fingerprints` audits.

## Re-running an archived set

`scripts/run-eval.py` will print a deprecation warning but continue if you
explicitly pass an archived path. Example:

```bash
python3 scripts/run-eval.py --eval-set archived/scout-coach-v5.yaml \
  --config claude --sample 2 --budget 2.00
```

## Non-archived active sets

These remain in `eval-sets/` root and are the supported entry points:

- `scout-eval-v7.yaml` — canonical knowledge + chain set
- `scout-eval-backend-v1.yaml` — backend-specific eval
- `scout-eval-scoutmaster-v1.yaml` — leader/scoutmaster eval
- `chain-eval-v1.yaml` — chain-only eval (shared with v7 via chain imports)
- `safety-v1.yaml` — standalone safety eval
