# DEPRECATED — TypeScript Test Harness

**Deprecated as of 2026-03-24.**

All scenarios and chains have been converted to YAML in `eval-sets/scout-eval-v7.yaml` and run through the unified Python eval engine (`scripts/eval_engine.py`).

## What replaced this

- **Scenarios** (22 TS files) → 15 YAML questions (TW1-TW15) + 5 guide questions (GE1-GE5)
- **Chains** (4 TS files, 30 steps) → 4 YAML chains (25 steps) in the `chains:` section of v7
- **Scout simulator** (`scout-simulator.ts`) → `_scout_sim_respond()` + `_auto_respond()` in `eval_engine.py`
- **TypeScript harness** (`harness.ts`) → `EvalEngine` class in `eval_engine.py` (supports Anthropic, OpenAI, Gemini, DeepSeek, Grok, OpenRouter)

## Do NOT

- Add new test scenarios here — add them to `eval-sets/scout-eval-v7.yaml`
- Use `chain.py` perspective — use `--chain <id>` with the knowledge perspective
- Create new TypeScript test harnesses — extend the Python eval engine

## Migration reference

See `docs/plans/2026-03-24-unified-eval-v7.md` for the full migration plan.

This directory is preserved for reference only.
