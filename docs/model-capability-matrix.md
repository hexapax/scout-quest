# Model capability matrix

Canonical reference for which models Scout Quest can use in production and evals,
what they support, and where they're known to fall short. Maintained by Stream D
of the 2026-04-16 alpha launch plan.

**Scope**: the models that already have a `configs.yaml` entry. New models
added to `eval-sets/configs.yaml` should be appended here after a minimum
smoke test (see "Verification method").

## Summary table

| Model | Provider | Native tools | Streaming | Prompt cache | Reasoning / thinking | Cost tier | Known issues |
|-------|----------|:------------:|:---------:|:------------:|:--------------------:|-----------|--------------|
| Claude Sonnet 4.6 | anthropic | yes | yes | ephemeral | optional (`thinking`) | mid ($3/$15) | — |
| Claude Opus 4.6 | anthropic | yes | yes | ephemeral | optional | premium ($5/$25) | Expensive. One TW1 tool loop burned $1.54. |
| GPT-4.1 | openai | yes | yes | automatic (OpenAI server-side) | no | mid ($2/$8) | — |
| GPT-4.1 Mini | openai | yes | yes | automatic | no | cheap ($0.40/$1.60) | — |
| GPT-5.4 | openai | yes | yes | automatic | implicit | mid ($2.50/$15) | — |
| Gemini 2.5 Flash | google | yes | yes | implicit / context-cache | `thinkingConfig` | cheap ($0.15/$0.60) | — |
| Gemini 3 Flash Preview | google | yes | yes | implicit | `thinkingConfig` | mid ($0.50/$3) | Preview tier; quota ceilings. |
| Gemini 3.1 Flash Lite Preview | google | yes | yes | implicit | `thinkingConfig` | cheap ($0.25/$1.50) | Preview tier. |
| DeepSeek V3 | deepseek | yes | yes | automatic (prompt cache surfaced in response) | no | cheap ($0.14/$0.28) | Tends to hallucinate tool args (logged chores scout didn't mention in TW1 smoke). |
| DeepSeek V3.2 | openrouter | yes (OR passthrough) | yes | depends on OR routing | no | cheap ($0.26/$0.38) | Behind OR; caching varies by upstream. |
| Grok 4.1 Fast | openrouter (xAI) | yes | yes | OR-level; xAI has `x-grok-conv-id` sticky cache | no | cheap ($0.20/$0.50) | 131K context — `COMPACT_KNOWLEDGE_PATTERNS` gates knowledge doc. |
| Grok 4.2 | openrouter (xAI) | yes | yes | same as Grok 4.1 Fast | no | mid ($2/$6) | 131K context (compact knowledge). |
| Qwen 3.5 Max / Qwen 3 235B | openrouter | yes (OR passthrough) | yes | OR-level | no | cheap–mid | Not yet smoke-tested on TW1. |
| GLM-5 Turbo | openrouter | yes (OR passthrough) | yes | OR-level | no | mid ($1.20/$4) | Not yet smoke-tested on TW1. |
| Llama 4 Scout / Maverick | openrouter | yes (OR passthrough) | yes | OR-level | no | cheap | Not yet smoke-tested on TW1. |

### Legend

- **Native tools**: the provider accepts tool declarations and emits structured
  tool-call requests (Anthropic `tool_use`, OpenAI `tool_calls`, Gemini
  `functionCall`). All entries above are wired in `scripts/eval_engine.py`
  via the unified provider routing added in Stream D.
- **Prompt cache**: whether the backend (or the eval engine) exercises a
  first-class cache path. Anthropic uses explicit `cache_control`; OpenAI
  and DeepSeek cache automatically; Gemini uses implicit short-context
  caching plus the context-cache API.
- **Cost tier**: rough bucket. Authoritative prices in
  [`config/pricing.yaml`](../config/pricing.yaml).

## Verification method

Smoke tests run against `TW1` (`tool_workflow` domain) on
`eval-sets/scout-eval-v7.yaml`. TW1 is a multi-turn chore-logging scenario
with an expected tool call to `log_chore` plus optional `read_chore_streak`
for state awareness. If a provider can successfully loop `user → tool → user`
through the eval engine and produce a final text turn, tool calling is
considered working.

Command for one model:

```bash
python3 scripts/run-eval.py --config <config> --questions TW1 --budget 1.50
```

Tool calls are surfaced in `results.json` under `response` (formatted
transcript) and in `raw_data.tool_calls` (structured). `tool_accuracy`
scores in the matrix are informational — a low score typically means the
model chose the wrong arguments, not that tool calling failed.

## Last-verified smoke run

Per-model TW1 smoke runs on 2026-04-16:

| Config | tool_accuracy | Total tool calls | Notes |
|--------|:-------------:|:----------------:|-------|
| `claude` (Sonnet 4.6) | 8 | 3 | `read_chore_streak`, `log_chore`, `log_session_notes` |
| `opus` (Opus 4.6) | — | 2 | `read_chore_streak`, `log_chore`; run hit $1.50 cap |
| `gpt41` (GPT-4.1) | 7 | 2 | `read_chore_streak`, `log_chore` |
| `gpt54` (GPT-5.4) | 7 | — | turn ≥ 3 tool-enabled, final avg 8.1 |
| `gemini25flash` (2.5 Flash) | 4 | 3 | `read_chore_streak`, `log_chore`, `log_session_notes` |
| `deepseek` (V3) | 2 | 9 | Tool calling works, but hallucinated `room_clean` chore |
| `grok` (4.1 Fast via OR) | 3 | 11 | `read_chore_streak` repeated, then `log_chore(['dishes','trash'])` |

All seven smoke configs completed without harness errors — the capability
matrix's "yes" entries for the corresponding providers are empirical, not
assumed.

---

*Verified: 2026-04-16 (worktree `agent-af33c30f`), Claude commit `6a77663`.*
*Total smoke-run spend: ~$4.29.*
