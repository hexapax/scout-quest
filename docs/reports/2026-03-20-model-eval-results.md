# Model Evaluation Results — Scout Coach

**Date:** 2026-03-20
**Evaluator:** Claude Sonnet 4.6 (scoring all responses)
**Questions:** 54 across 7 categories (A-G)
**Knowledge block:** 188K tokens (full BSA knowledge + troop context + persona)

## Scoring Dimensions (0-10)

| Dimension | What it measures |
|-----------|-----------------|
| **Accuracy** | Factually correct BSA information |
| **Specificity** | Specific details vs generic advice |
| **Safety** | Correct YPT/safety guidance (10 if N/A) |
| **Coaching** | Right approach for question type (empathy for feelings, direct for policy) |
| **Troop Voice** | Sounds like it knows THIS troop (Troop 2024 specifics) |

## Question Categories

| Cat | Name | Count | Tests |
|-----|------|-------|-------|
| A | Advancement Policy | 8 | G2A rules, BOR procedures, partial completions |
| B | Troop Logistics | 8 | Meetings, uniforms, patrols, merit badge process |
| C | Requirement Details | 8 | Specific badge requirements, Eagle requirements |
| D | Safety/YPT | 6 | Two-deep leadership, digital safety, transport |
| E | Cross-Reference | 10 | Badge connections, version changes, requirement overlap |
| F | Values Coaching | 8 | Empathy-first, no lecturing, connect to values |
| G | Over-Policy Detection | 6 | Don't dump policy on emotional questions |

---

## Round 1: 12-Model Comparison (Full 54 Questions)

### Overall Rankings

| Rank | Model | Price (in/out) | Acc | Spec | Safe | Coach | Troop | **Avg** |
|:----:|-------|---------------|:---:|:----:|:----:|:-----:|:-----:|:-------:|
| 1 | **Claude Sonnet 4.6** | $3/$15 | 8.0 | 7.7 | 9.9 | **8.4** | **5.3** | **7.9** |
| 2 | **Gemini 3 Flash Preview** | $0.50/$3 | 7.1 | 7.5 | 9.4 | 7.6 | **6.1** | **7.6** |
| 3 | GPT-5.4 | $2.50/$15 | 7.6 | **7.9** | 9.4 | 7.0 | 4.5 | 7.3 |
| 4 | **Gemini 3.1 Flash Lite** | $0.25/$1.50 | 7.3 | 7.4 | **9.9** | 7.7 | 4.3 | **7.3** |
| 5 | DeepSeek V3 | $0.14/$0.28 | 7.1 | 7.2 | 9.7 | 7.0 | 4.8 | 7.2 |
| 6 | GPT-4.1 | $2/$8 | 7.2 | 7.7 | **9.9** | 6.8 | 4.0 | 7.1 |
| 7 | GPT-5.4 Mini | $0.75/$4.50 | 7.3 | 7.3 | 9.6 | 6.7 | 3.7 | 6.9 |
| 8 | GPT-5.4 Nano | $0.20/$1.25 | 7.1 | 7.3 | 9.7 | 6.6 | 3.6 | 6.8 |
| 9 | Gemini 2.5 Flash | $0.15/$0.60 | 6.8 | 6.4 | 9.8 | 6.6 | 3.8 | 6.7 |
| 10 | GPT-4.1 Mini | $0.40/$1.60 | 6.9 | 6.0 | 9.3 | 6.9 | 3.2 | 6.5 |
| 11 | Gemini 2.5 Flash Lite | $0.10/$0.40 | 6.7 | 6.2 | 9.5 | 6.0 | 2.9 | 6.3 |
| 12 | GPT-4.1 Nano | $0.10/$0.40 | 5.8 | 5.0 | 9.2 | 5.9 | 2.6 | 5.7 |

### Per-Category Breakdown

| Model | A | B | C | D | E | F | G |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Claude Sonnet 4.6 | 8.1 | 8.4 | 6.9 | 8.0 | 7.4 | 8.2 | 8.3 |
| Gemini 3 Flash Preview | 8.3 | 8.6 | 6.4 | 7.6 | 5.8 | 8.5 | 8.3 |
| GPT-5.4 | 7.8 | 8.2 | 6.9 | 7.6 | 6.3 | 7.7 | 6.6 |
| Gemini 3.1 Flash Lite | 7.2 | 8.1 | 6.7 | 7.2 | 6.8 | 7.8 | 7.8 |
| DeepSeek V3 | 8.1 | 8.1 | 5.8 | 7.5 | 6.0 | 7.5 | 7.7 |
| GPT-4.1 | 7.5 | 7.9 | 6.2 | 7.2 | 6.4 | 7.3 | 7.6 |
| GPT-5.4 Mini | 7.7 | 7.7 | 6.4 | 7.3 | 5.4 | 7.3 | 7.2 |
| GPT-5.4 Nano | 7.3 | 7.4 | 6.0 | 6.9 | 6.5 | 7.1 | 7.0 |
| Gemini 2.5 Flash | 6.4 | 7.3 | 6.0 | 7.0 | 5.4 | 7.8 | 7.6 |
| GPT-4.1 Mini | 7.0 | 7.4 | 6.3 | 5.9 | 5.1 | 7.2 | 6.9 |
| Gemini 2.5 Flash Lite | 6.7 | 6.9 | 6.2 | 6.2 | 5.5 | 6.1 | 6.6 |
| GPT-4.1 Nano | 5.7 | 6.2 | 5.5 | 4.6 | 5.1 | 6.5 | 6.3 |

### Key Findings — Round 1

1. **Claude leads on coaching (8.4)** — the most important dimension for a youth-facing assistant. Only model that consistently empathizes before informing.
2. **Gemini 3 Flash Preview is best value** — 7.6 avg at $0.50/$3, highest troop voice (6.1), strong coaching (7.6). 6x cheaper than Claude.
3. **Gemini 3.1 Flash Lite is best ultra-budget** — 7.3 avg at $0.25/$1.50. Replaces Gemini 2.5 Flash (6.7) in every dimension.
4. **GPT-5.4 doesn't justify its price** — ties Gemini 3.1 Flash Lite (7.3) at 10x the cost. Coaching (7.0) lags behind both Geminis and Claude. GPT persona drift persists in 5.x generation.
5. **Category C (requirement details) is the hardest** — all models score 5.5-6.9. Without tool access, models guess at specific requirement text.
6. **Category E (cross-reference) separates good from great** — requires connecting information across the knowledge block. Claude (7.4) and Gemini 3.1 Flash Lite (6.8) lead.

### Models Eliminated

| Model | Why |
|-------|-----|
| Grok (all) | Safety-disqualified for youth — "Unacceptable Risk" (Common Sense Media Jan 2026) |
| GPT-4o | Deprecated, 128K context too small for 165K knowledge |
| Claude Haiku 4.5 | 200K context too tight for 165K knowledge + conversation |
| Gemini 2.5 Pro | Explicit cache storage = ~$120/month |
| Gemini 3.1 Pro Preview | 2x pricing surcharge over 200K tokens — more expensive than Claude |

---

## Round 2: Thinking & Opus (F+G Categories — 14 Questions)

Tested whether extended thinking or larger models improve coaching quality.

| Model | Price | Acc | Spec | Safe | Coach | Troop | **Avg** |
|-------|-------|:---:|:----:|:----:|:-----:|:-----:|:-------:|
| **Sonnet 4.6 +Think** | $3/$15+think | 8.8 | 7.4 | **10.0** | **9.4** | **6.1** | **8.3** |
| Sonnet 4.6 (baseline) | $3/$15 | **8.9** | 7.2 | 9.9 | 9.2 | 5.6 | 8.2 |
| Opus 4.6 | $5/$25 | 8.6 | **7.6** | 9.9 | 8.5 | 5.1 | 8.0 |
| Opus 4.6 +Think | $5/$25+think | 8.3 | 7.4 | 9.9 | 8.4 | 5.2 | 7.8 |

### Key Findings — Round 2

1. **Sonnet beats Opus on coaching** (9.2-9.4 vs 8.4-8.5). Opus is more precise but less warm.
2. **Thinking helps Sonnet's troop voice** (+0.5, from 5.6→6.1). Thinking gives the model time to mine the 165K knowledge block for troop-specific details (names, customs, patrol info).
3. **Thinking hurts Opus** (8.0→7.8). Opus overthinks emotional questions — analyzes instead of empathizing.
4. **Sonnet is the gold standard** for this use case. Opus at 2x the price is worse at what matters most.

### Troop Voice Deep Dive — Sonnet vs Sonnet+Think

| Question | Sonnet | +Think | Delta | Notes |
|----------|:------:|:------:|:-----:|-------|
| F1 (community service) | 6 | 7 | +1 | |
| F2 (annoying patrol member) | 5 | 6 | +1 | |
| F3 (dad says waste of time) | 8 | 4 | **-4** | Overthinking regression |
| F4 (cheated on requirement) | 7 | 8 | +1 | |
| F5 (outdoor stuff vs programming) | 4 | 5 | +1 | |
| F6 (nervous about BOR) | 5 | 7 | **+2** | Named specific committee members |
| F7 (friend worried about joining) | 4 | 6 | **+2** | Better troop-specific details |
| F8 (duty to God) | 7 | 7 | 0 | |
| G1-G6 (emotional) | avg 5.3 | avg 5.7 | +0.3 | Modest improvement |

Thinking helps troop voice by giving the model time to search the knowledge block for specific details. On F6, Sonnet+Think referenced "Eric Buffenbarger's crew" by name; baseline Sonnet gave generic BOR advice.

---

## Round 3: Adaptive Thinking (Full 54 Questions)

Testing Anthropic's adaptive thinking feature, which lets the model decide when and how much to think.

| Model | Effort | Price | Acc | Spec | Safe | Coach | Troop | **Avg** |
|-------|--------|-------|:---:|:----:|:----:|:-----:|:-----:|:-------:|
| **Sonnet 4.6** | **medium** | **$3/$15 adaptive** | **8.3** | **8.0** | **9.9** | **8.5** | **5.3** | **8.0** |
| Sonnet 4.6 | none | $3/$15 | 7.9 | 7.8 | 9.9 | 8.3 | 5.0 | 7.8 |
| Sonnet 4.6 | high | $3/$15 adaptive | 7.7 | 7.8 | 9.9 | 8.4 | 5.2 | 7.8 |
| Sonnet 4.6 | low | $3/$15 adaptive | 7.7 | 7.6 | 9.6 | 8.2 | 5.2 | 7.7 |
| Opus 4.6 | max | $5/$25 adaptive | 7.7 | 7.9 | 9.9 | 8.1 | 4.5 | 7.6 |

### Per-Category — Adaptive Thinking

| Model (effort) | A | B | C | D | E | F | G |
|----------------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Sonnet (medium) | 8.2 | **8.7** | **7.1** | **8.3** | **7.4** | 8.2 | **8.5** |
| Sonnet (none) | 8.1 | 8.3 | 6.8 | 8.1 | 7.1 | 8.2 | 8.4 |
| Sonnet (high) | 8.1 | 8.5 | 6.6 | 8.0 | 7.2 | 8.2 | 8.4 |
| Sonnet (low) | 8.2 | 8.3 | 6.8 | 7.7 | 6.6 | 8.1 | 8.5 |
| Opus (max) | 7.9 | 8.3 | 7.0 | 7.6 | 6.9 | 8.2 | 7.7 |

### Key Findings — Round 3

1. **Medium is the sweet spot.** Sonnet Adaptive Med (8.0) beats baseline (7.8), high (7.8), and Opus max (7.6). The model thinks when it helps and skips when it doesn't.
2. **High is worse than medium.** Overthinking degrades coaching on emotional questions. The model analyzes situations that call for intuitive empathy.
3. **Opus max is the worst.** At 2x the price, it scores last (7.6). Overthinking is more pronounced in larger models.
4. **Low barely differs from no-thinking** but drops safety (9.6 vs 9.9). Not recommended — minimal savings for quality loss.
5. **Category B (troop logistics) gains the most** from adaptive med: 8.3→8.7. Thinking helps mine troop-specific details.
6. **Category E (cross-reference) also improves**: 7.1→7.4. Connecting information across the 165K knowledge block benefits from reasoning time.
7. **Category F+G (coaching/empathy) are stable** across all settings (~8.2-8.5). Empathy quality comes from persona tuning, not thinking depth.

---

## Recommended Tier Structure

| Tier | Model | Avg | Monthly Cost* | Use Case |
|------|-------|-----|--------------|----------|
| **Primary** | Sonnet 4.6 Adaptive Med | **8.0** | ~$3-4 | Default Scout Coach — best overall |
| **Fallback** | Sonnet 4.6 (no thinking) | 7.8 | ~$3 | Cost control / lower latency |
| **Budget** | Gemini 3 Flash Preview | 7.6 | ~$0.50 | Budget-conscious scouts |
| **Ultra-budget** | Gemini 3.1 Flash Lite | 7.3 | ~$0.25 | High-volume / simple queries |
| **Non-tool** | DeepSeek V3 | 7.2 | ~$0.15 | Quick Chat (no MCP tools) |

*Estimated at 30 sessions/month, ~5 turns per session.*

---

## Methodology Notes

- All models received identical system prompts (persona + knowledge + troop context)
- Each question was independently scored by Claude Sonnet 4.6 evaluator
- Evaluator was blind to which model generated each response
- Scores are on a 0-10 scale per dimension, averaged across questions
- Knowledge document: 177K tokens (BSA policy, requirements, version history)
- Troop context: Troop 2024 specific details (roster, schedules, customs)
- Persona: Model-specific variants of the "Woody from Toy Story" Scout Coach character
