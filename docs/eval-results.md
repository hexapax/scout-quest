# Knowledge Layer Evaluation Results

Tracking progressive improvement as knowledge layers are added to the Scout Coach backend.

**Evaluation method:** 24 questions across 5 categories, scored 0-10 on 5 dimensions by Claude Sonnet evaluator. Each run tests a different knowledge layer configuration.

**Evaluator philosophy:** Direct answers on BSA policy/procedure = good coaching. Socratic method on life skills/MB work = good coaching. Troop-specific details score higher than generic advice.

---

## Run History

### Run 1: L0 vs L1-thin — Initial Baseline
**Date:** 2026-03-19 12:07 UTC
**Changes:** First run. Old evaluator prompt (penalized direct policy answers as "not Socratic").
**Persona:** Original (generic coaching instructions)

| Dimension | L0 | L1-thin |
|---|---|---|
| Accuracy | 6.6 | 7.2 |
| Specificity | 4.5 | 6.6 |
| Safety | 9.6 | 9.6 |
| Coaching | 7.7 | 6.3 |
| Troop Voice | 2.7 | 4.3 |

**Finding:** Coaching REGRESSED -1.4 with L1-thin because the evaluator penalized direct policy answers. Identified misalignment between persona goals and evaluator scoring.

---

### Run 2: L1-thin — Persona Fix Only
**Date:** 2026-03-19 12:31 UTC
**Changes:** Updated persona prompt — direct on policy, Socratic on life skills. Fixed troop number (489→2024). Same old evaluator.

| Dimension | L1-thin (run 1) | L1-thin (run 2) |
|---|---|---|
| Accuracy | 7.2 | 7.5 |
| Specificity | 6.6 | 6.5 |
| Safety | 9.6 | 9.6 |
| Coaching | 6.3 | 6.6 |
| Troop Voice | 4.3 | 5.1 |

**Finding:** Partial coaching recovery (+0.3). Troop Voice improved (+0.8) from explicit Troop 2024 identity. But evaluator still not aligned.

---

### Run 3: L0 vs L1-thin — Aligned Evaluator (DEFINITIVE BASELINE)
**Date:** 2026-03-19 14:04 UTC
**Changes:** Updated evaluator prompt to match coaching philosophy. Direct policy answers now scored correctly. Both persona AND evaluator aligned.
**Cached tokens:** L1-thin = 59,636 tokens

| Dimension | L0 (null) | L1-thin (52K) | Delta |
|---|---|---|---|
| Accuracy | 6.4 | **7.0** | +0.6 |
| Specificity | 5.0 | **7.2** | **+2.2** |
| Safety | 9.5 | 9.3 | -0.2 |
| Coaching | 6.1 | **7.7** | **+1.6** |
| Troop Voice | 2.3 | **5.6** | **+3.3** |

| Category | L0 | L1-thin | Delta |
|---|---|---|---|
| A: Policy nuance | 5.9 | **8.3** | +2.4 |
| B: Troop values | 6.4 | **8.3** | +1.9 |
| C: Requirement accuracy | 5.8 | 5.8 | 0 |
| D: Safety/YPT | 5.5 | **7.7** | +2.2 |
| E: Cross-reference | 5.8 | **6.8** | +1.0 |

**This is the definitive baseline.** L1-thin improves everything except Category C (requirements). The interim doc has partial requirement text — L1-full should close this gap.

---

### Run 4: L1-full — Production Knowledge Doc
**Date:** 2026-03-19 ~14:15 UTC
**Changes:** Swapped interim 52K knowledge doc for production 177K doc from corpus (bsa-knowledge-v1.md). Contains complete G2A, G2SS, all 141 MB requirements, TLG Vol 1+2, version history, program features.
**Cached tokens:** 165,749

| Dimension | L0 | L1-thin | L1-full | Delta (thin→full) |
|---|---|---|---|---|
| Accuracy | 6.4 | 7.0 | **7.1** | +0.1 |
| Specificity | 5.0 | 7.2 | 7.0 | -0.2 |
| Safety | 9.5 | 9.3 | **9.9** | +0.6 |
| Coaching | 6.1 | 7.7 | **7.8** | +0.1 |
| Troop Voice | 2.3 | 5.6 | **3.9** | **-1.7** |

| Category | L0 | L1-thin | L1-full | Delta |
|---|---|---|---|---|
| A: Policy | 5.9 | 8.3 | 8.0 | -0.3 |
| B: Troop values | 6.4 | 8.3 | **7.0** | **-1.3** |
| C: Requirements | 5.8 | 5.8 | **6.6** | **+0.8** |
| D: Safety/YPT | 5.5 | 7.7 | **7.8** | +0.1 |
| E: Cross-reference | 5.8 | 6.8 | 6.5 | -0.3 |

**Finding — Context dilution problem:** L1-full (177K tokens) improved Category C (requirements) as expected, but Troop Voice regressed -1.7 and Category B dropped -1.3. The Troop 2024-specific content (~5K tokens) is drowned out by 170K tokens of generic BSA policy. The model focuses on the dominant content and loses the troop-specific voice.

**Action needed:** Move troop-specific content to a prominent separate position (persona block or dedicated section at the start of knowledge doc) so it doesn't get diluted by the BSA corpus.

**NOTE on troop content placement across runs:**
- Run 3 (L0): No troop content anywhere
- Run 3 (L1-thin): Troop content was embedded IN the 52K knowledge doc (system[0])
- Run 4 (L1-full): Troop content was ABSENT — the corpus distillation didn't include it
- Run 5 (L1-full + troop): Troop content moved to persona block (system[1]), ~11K tokens
- To fairly compare L1-thin vs L1-full, Run 3 L1-thin should be re-run with troop content in system[1] instead of system[0]. This would isolate the BSA knowledge improvement from the troop context placement effect.

---

### Run 5: L1-full + Troop Context in Persona
**Date:** 2026-03-19 ~14:45 UTC
**Changes:** Troop 2024 content (~11K tokens, 8 files: overview, advancement, leadership, patrols, policies, eagle process, campouts, finances) moved from knowledge doc to persona block (system[1]). BSA knowledge (system[0]) stays at 165K tokens. Troop content now always prominent regardless of knowledge corpus size.
**Cached tokens:** 165,749 (BSA) + ~11,438 (troop in persona) = ~177K total

| Dimension | L0 | L1-thin | L1-full | **L1-full+troop** | Delta (full→+troop) |
|---|---|---|---|---|---|
| Accuracy | 6.4 | 7.0 | 7.1 | **7.3** | +0.2 |
| Specificity | 5.0 | 7.2 | 7.0 | **7.4** | +0.4 |
| Safety | 9.5 | 9.3 | 9.9 | 9.4 | -0.5 |
| Coaching | 6.1 | 7.7 | 7.8 | 7.7 | -0.1 |
| Troop Voice | 2.3 | 5.6 | 3.9 | **5.7** | **+1.8** |

| Category | L0 | L1-thin | L1-full | **L1-full+troop** | Delta |
|---|---|---|---|---|---|
| A: Policy | 5.9 | 8.3 | 8.0 | **8.8** | +0.8 |
| B: Troop values | 6.4 | 8.3 | 7.0 | **8.0** | +1.0 |
| C: Requirements | 5.8 | 5.8 | 6.6 | 5.7 | -0.9 |
| D: Safety/YPT | 5.5 | 7.7 | 7.8 | **8.3** | +0.5 |
| E: Cross-reference | 5.8 | 6.8 | 6.5 | **6.9** | +0.4 |

**Finding:** Troop Voice recovered from 3.9→5.7 (+1.8), confirming the persona placement works. Best scores on Policy (8.8) and Safety (8.3). Category C regressed 6.6→5.7 — possibly eval noise or attention competition from the larger persona block. Overall this is the best configuration so far.

**Category C note:** The C regression may be noise (single-run variance). With only 5 questions per category, a single answer scoring differently swings the average by 0.4. L2 (vector retrieval) should definitively improve C by enabling exact requirement text lookup.

---

### Run 6: L2 — Vector Retrieval
**Date:** 2026-03-19 16:38 UTC
**Changes:** 3,990 voyage-3 embeddings (1024 dim) loaded into FalkorDB with cosine vector index. search_bsa_reference now uses hybrid: semantic vector search → full-text → knowledge doc scan. VOYAGE_API_KEY for query-time embedding.
**Cached tokens:** 165,749 (BSA knowledge) + ~11,438 (troop persona)

| Dimension | L0 | L1-thin | L1-full | L1-full+troop | **L2** | Delta (troop→L2) |
|---|---|---|---|---|---|---|
| Accuracy | 6.4 | 7.0 | 7.1 | 7.3 | **7.6** | +0.3 |
| Specificity | 5.0 | 7.2 | 7.0 | 7.4 | **7.7** | +0.3 |
| Safety | 9.5 | 9.3 | 9.9 | 9.4 | 9.4 | 0 |
| Coaching | 6.1 | 7.7 | 7.8 | 7.7 | **7.9** | +0.2 |
| Troop Voice | 2.3 | 5.6 | 3.9 | 5.7 | **5.8** | +0.1 |

| Category | L0 | L1-thin | L1-full | L1-full+troop | **L2** | Delta |
|---|---|---|---|---|---|---|
| A: Policy | 5.9 | 8.3 | 8.0 | 8.8 | **8.6** | -0.2 |
| B: Troop values | 6.4 | 8.3 | 7.0 | 8.0 | **8.3** | +0.3 |
| C: Requirements | 5.8 | 5.8 | 6.6 | 5.7 | **7.0** | **+1.3** |
| D: Safety/YPT | 5.5 | 7.7 | 7.8 | 8.3 | **8.1** | -0.2 |
| E: Cross-reference | 5.8 | 6.8 | 6.5 | 6.9 | 6.4 | -0.5 |

**Finding:** Category C (requirements) improved +1.3, confirming vector search retrieves specific requirement text effectively. All dimensions at or near peak scores. Category E did NOT improve — vector search finds individual chunks but doesn't help connect info across badges/ranks. That's L3's job.

---

### Run 7: L3 — Enriched Graph (planned)
**Changes:** Load Layer 3 graph nodes (skills, topics, version changes, cross-badge relationships). Add graph-powered cross-reference queries.
**Expected improvement:** Category E (relationship queries, version-aware answers).

---

## Dimension Definitions

| Dimension | What It Measures | Scoring Philosophy |
|---|---|---|
| **Accuracy** | Factually correct BSA information matching expected answer | Higher = more correct |
| **Specificity** | Concrete details vs generic advice (policy refs, requirement numbers, troop info) | Higher = more specific |
| **Safety** | Correct YPT/safety guidance with specific rules | 10 if N/A; penalize vague "be careful" |
| **Coaching** | Right approach for question type: direct on policy, Socratic on life skills, practical on logistics | Context-dependent — see evaluator prompt |
| **Troop Voice** | Sounds like it knows THIS troop's specific values, people, processes | Generic "ask your scoutmaster" = low |

## Question Categories

| Cat | Focus | Count | What Tests It |
|---|---|---|---|
| A | Policy nuance | 5 | G2A depth — counter-intuitive BSA policies |
| B | Troop values | 5 | Troop 2024 specifics — uniform, process, culture |
| C | Requirement accuracy | 5 | Exact requirement text, version currency |
| D | Safety/YPT | 4 | G2SS rules, YPT digital contact, transport |
| E | Cross-reference | 5 | Connecting info across badges/ranks/policies |
