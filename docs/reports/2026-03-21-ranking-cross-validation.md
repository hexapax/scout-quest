# Ranking vs Scoring Cross-Validation Report

**Date:** 2026-03-21
**Method:** Listwise ranking (6 response clusters, 3 judges: GPT-nano, DeepSeek, Grok)
**Aggregation:** Borda count


---

## G1: I failed my board of review. I feel terrible.
**Type:** over_policy

| Rank | Label | Borda | Model | Cluster | Overall | Acc | Spec | Safe | Coach | Troop |
|:----:|:-----:|:-----:|-------|:-------:|:-------:|:---:|:----:|:----:|:-----:|:-----:|
| 1 | [C] | 10 | Gemini 3.1 Flash Lite | 4 | 8.4 | 9 | 7 | 10 | 10 | 6 |
| 2 | [F] | 9 | Sonnet 4.6 Adaptive High | 4 | 8.4 | 9 | 7 | 10 | 10 | 6 |
| 3 | [B] | 8 | Gemini 2.5 Flash | 4 | 8.2 | 9 | 6 | 10 | 10 | 6 |
| 4 | [A] | 7 | Claude Sonnet 4.6 | 5 | 8.6 | 10 | 7 | 10 | 10 | 6 |
| 5 | [D] | 6 | Claude Sonnet 4.6 | 4 | 8.6 | 10 | 7 | 10 | 10 | 6 |
| 6 | [E] | 5 | Sonnet 4.6 Adaptive Low | 4 | 8.6 | 10 | 7 | 10 | 10 | 6 |

### Dimension-Rank Correlation

Which scoring dimensions best predict the ranking? (Spearman-like: does sorting by dimension match the rank order?)

- **Accuracy**: top=DIFFER, order agreement=40%, displacement=18
- **Specificity**: top=MATCH, order agreement=80%, displacement=6
- **Safety**: top=MATCH, order agreement=100%, displacement=0
- **Coaching**: top=MATCH, order agreement=100%, displacement=0
- **Troop Voice**: top=MATCH, order agreement=100%, displacement=0
- **Overall**: top=DIFFER, order agreement=40%, displacement=18

### Judge Agreement
- **gpt-nano**: C > F > B > E > D > A
- **deepseek**: A > D > E > F > B > C
- **grok**: C > B > F > A > D > E

Judges **split**: top picks were ['C', 'A', 'C']

### Judge Reasoning (excerpts)

**gpt-nano:**
> **Reasons:**
> - **C** is the best because it offers empathetic, specific support, normalizes the experience, and encourages a constructive conversation without imme
> - **F** is very similar to C in empathy and specificity, but slightly more focused on the feedback and next steps, which is helpful; however, it’s a b

**deepseek:**
> **Ranking:** A > D > E > F > B > C
> **Reasons:**
> 1. **A:** Best — Opens with perfect empathy, immediately asks for the scout's story without any procedural pivot or filler.

**grok:**
> Below is my ranking of the 6 responses for the Boy Scout assistant "Scout Coach" based on the provided evaluation criteria (prioritzing COACHING, then
> ### RANKING:
> ### REASONS FOR EACH RESPONSE:

---

## F2: This kid in my patrol is really annoying and nobody likes hi
**Type:** coaching_values

| Rank | Label | Borda | Model | Cluster | Overall | Acc | Spec | Safe | Coach | Troop |
|:----:|:-----:|:-----:|-------|:-------:|:-------:|:---:|:----:|:----:|:-----:|:-----:|
| 1 | [B] | 13 | Opus 4.6 Adaptive Max | 4 | 8.2 | 9 | 8 | 10 | 9 | 5 |
| 2 | [A] | 11 | Claude Opus 4.6 +Think | 4 | 8.0 | 8 | 7 | 10 | 9 | 6 |
| 3 | [D] | 8 | Claude Sonnet 4.6 +Think | 2 | 8.6 | 9 | 8 | 10 | 10 | 6 |
| 4 | [F] | 7 | DeepSeek V3 | 2 | 7.8 | 8 | 8 | 9 | 9 | 5 |
| 5 | [C] | 6 | Gemini 2.5 Flash | 3 | 9.6 | 10 | 9 | 10 | 10 | 9 |
| 6 | [E] | 0 | GPT-5.4 Mini | 2 | 6.8 | 8 | 8 | 9 | 5 | 4 |

### Dimension-Rank Correlation

Which scoring dimensions best predict the ranking? (Spearman-like: does sorting by dimension match the rank order?)

- **Accuracy**: top=DIFFER, order agreement=73%, displacement=8
- **Specificity**: top=DIFFER, order agreement=67%, displacement=10
- **Safety**: top=MATCH, order agreement=93%, displacement=2
- **Coaching**: top=DIFFER, order agreement=67%, displacement=10
- **Troop Voice**: top=DIFFER, order agreement=73%, displacement=8
- **Overall**: top=DIFFER, order agreement=67%, displacement=10

### Judge Agreement
- **gpt-nano**: B > D > C > F > A > E
- **deepseek**: A > B > D > F > C > E
- **grok**: A > B > F > C > D > E

Judges **split**: top picks were ['B', 'A', 'A']

### Judge Reasoning (excerpts)

**gpt-nano:**
> Reasons:
> 1. **B** is the best because it opens with empathy, invites the scout to share specifics, and encourages understanding of underlying issues, aligning 
> 2. **D** is next because it asks for specifics of the behaviors, highlights the importance of understanding what “annoying” truly means, and suggests 

**deepseek:**
> **Ranking:** A > B > D > F > C > E
> **Reasons:**
> 1. **A:** Best—opens with empathy, asks specific diagnostic questions, frames inclusion as leadership, and offers practical, troop-aware steps.

**grok:**
> ### RANKING:
> ### REASONS FOR EACH POSITION (1-sentence reason per response):
> - **A**: Best for its strong coaching approach that starts with empathy and genuine curiosity, asks targeted questions to distinguish behavior from pe

---

## E4: I completed Swimming MB. Does that help with any rank requir
**Type:** 

| Rank | Label | Borda | Model | Cluster | Overall | Acc | Spec | Safe | Coach | Troop |
|:----:|:-----:|:-----:|-------|:-------:|:-------:|:---:|:----:|:----:|:-----:|:-----:|
| 1 | [F] | 14 | DeepSeek V3 | 2 | 6.8 | 4 | 7 | 10 | 7 | 6 |
| 2 | [C] | 9 | Sonnet 4.6 Adaptive Med | 2 | 7.8 | 9 | 8 | 10 | 8 | 4 |
| 3 | [A] | 9 | L1: + Web Search | 2 | 6.8 | 8 | 6 | 10 | 8 | 2 |
| 4 | [B] | 9 | Claude Sonnet 4.6 | 2 | 8.4 | 8 | 7 | 10 | 9 | 8 |
| 5 | [D] | 4 | Claude Sonnet 4.6 | 2 | 6.6 | 6 | 7 | 10 | 7 | 3 |
| 6 | [E] | 0 | GPT-5.4 Nano | 2 | 5.8 | 4 | 6 | 10 | 7 | 2 |

### Dimension-Rank Correlation

Which scoring dimensions best predict the ranking? (Spearman-like: does sorting by dimension match the rank order?)

- **Accuracy**: top=DIFFER, order agreement=73%, displacement=8
- **Specificity**: top=DIFFER, order agreement=80%, displacement=6
- **Safety**: top=MATCH, order agreement=100%, displacement=0
- **Coaching**: top=DIFFER, order agreement=80%, displacement=6
- **Troop Voice**: top=DIFFER, order agreement=73%, displacement=8
- **Overall**: top=DIFFER, order agreement=80%, displacement=6

### Judge Agreement
- **gpt-nano**: C > F > A > D > B > E
- **deepseek**: F > B > A > C > D > E
- **grok**: F > B > A > C > D > E

Judges **split**: top picks were ['C', 'F', 'F']

### Judge Reasoning (excerpts)

**gpt-nano:**
> **Reasons:**
> 1. **[C]** is the best because it provides a clear, accurate, troop-specific explanation connecting Swimming MB directly to Eagle, Star, and Life rank
> 2. **[F]** is very strong — it correctly states that Swimming MB counts toward Eagle and rank totals, ties into First and Second Class requirements ex

**deepseek:**
> **Ranking:** F > B > A > C > D > E
> **Reasons:**
> 1. **F:** Best — Highly specific, accurate on Eagle, Star, Life, *and* rank requirements (First Class 6a, Second Class 5b), includes troop voice (Nico

**grok:**
> Below is my ranking of the 6 responses ([A] through [F]) for the question: "I completed Swimming MB. Does that help with any rank requirements?" I've 
> ### Reasons for Each Response's Position (1 sentence each):
> - **F**: First because it excels in coaching with high empathy and encouragement, is fully accurate on BSA requirements (e.g., covering multiple ranks

---

## Summary: Score-Rank Agreement by Dimension

Across all 3 questions, which scoring dimension best predicts what the ranking judges value?

Key insight: If a dimension consistently agrees with rankings, our scoring for that dimension is well-calibrated.
If it consistently disagrees, either the scoring or the ranking is measuring the wrong thing.

### Observations

1. **All 3 questions showed rank-score disagreement** on the overall average. This is expected — the ranking judges see the full response and make a holistic judgment, while our scoring averages 5 dimensions mechanically.
2. **Coaching questions (G1, F2)** should have coaching as the strongest predictor. If accuracy or specificity better predicts the ranking, our dimension weighting is wrong for these question types.
3. **Cross-reference questions (E4)** should have accuracy as the strongest predictor. If coaching better predicts the ranking, the judges may be responding to tone over substance.
4. **The ranking cost was negligible** (~$0.01 per question, 3 cheap judge calls). This is sustainable for regular cross-validation.
5. **Inter-judge agreement was moderate** (2-1 splits on all 3 questions). Adding more judges or using larger chunks could improve consensus.