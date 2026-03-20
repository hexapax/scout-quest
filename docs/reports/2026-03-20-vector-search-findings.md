# Vector Search & Retrieval — Experiment Findings

**Date:** 2026-03-20
**Author:** Jeremy Bramwell (with Claude Code)
**Context:** Scout Quest v2 backend — BSA knowledge retrieval for AI coaching

---

## Executive Summary

We evaluated 2 embedding models, 4 chunking strategies, and 5 search methods against a test suite of 20 BSA-specific retrieval queries. The goal: find the best configuration for retrieving accurate BSA policy, requirement, and safety content to augment the AI coach's responses.

**Winner: Gemini-embedding-001 + source-boosted RRF hybrid search.**

Key findings:
- Gemini-embedding-001 significantly outperforms Voyage-3 on retrieval quality (MRR 0.875 vs 0.597)
- Hybrid search (vector + BM25) outperforms vector-only across all configurations
- Source-type boosting for authoritative documents (G2SS, G2A) closes the safety query gap
- BM25 alone is weak for this corpus due to shared scouting terminology across documents
- Heading-aware chunking at ~500 tokens is the optimal chunk size

---

## Experiment Design

### Corpus
- **Source:** BSA official documents — Guide to Advancement (G2A), Guide to Safe Scouting (G2SS), Youth Protection Training (YPT), 141 merit badge requirement sets, Troop Leader Guidebooks (Vol 1 & 2), Program Features (3 volumes), rank requirements (2019-2025)
- **Total extracted text:** 15MB across 968 files
- **Distilled knowledge document:** 176,724 tokens (Layer 1, cached in every request)
- **Chunks for retrieval:** varies by strategy (191 to 3,990 chunks)

### Test Queries (20)
Categorized by type to identify per-domain strengths:

| Category | Count | Example |
|---|---|---|
| requirement_lookup | 9 | "How many camping nights for Camping MB?" |
| policy_lookup | 4 | "Can partial merit badge completions expire?" |
| safety_lookup | 4 | "Two deep leadership transportation requirements" |
| concept_lookup | 3 | "What is the patrol method?" |

Each query has expected source file patterns (e.g., q1 expects `merit-badges/camping/`).

### Metrics
- **Recall@K:** Does the correct source appear in the top K results? (K=5, K=10)
- **MRR (Mean Reciprocal Rank):** How high does the correct result rank? MRR=1.0 means correct result is always #1.

---

## Experiment 1: Chunking Strategies (Voyage-3 embeddings)

Holding the embedding model constant (Voyage-3, 1024 dimensions), we tested 4 chunking strategies:

| Strategy | Chunks | Avg Tokens | R@5 | R@10 | MRR@5 |
|---|---|---|---|---|---|
| **contextual-prefix** | 3,990 | 627 | **0.700** | 0.850 | 0.517 |
| **heading-aware-500** | 2,136 | 550 | 0.650 | **0.950** | **0.537** |
| line-break | 1,444 | 707 | 0.650 | 0.850 | 0.467 |
| heading-aware-1000 | 1,026 | 1,061 | 0.550 | 0.950 | 0.442 |

**Findings:**
- **Heading-aware-500 is the best balance** — highest MRR (correct results ranked highest) and best R@10 (0.950), with half the chunks of contextual-prefix. Best efficiency.
- **Contextual prefix helps R@5** — the Haiku-generated context summaries improve top-5 recall. But the 2x chunk count and embedding cost may not justify the modest improvement.
- **Larger chunks (1000) hurt R@5** — too much noise per chunk dilutes the embedding signal. The content is there (R@10=0.950) but buried deeper in results.
- **Line-break chunking** is surprisingly competitive — simple paragraph splitting performs nearly as well as heading-aware, suggesting the heading structure isn't as important as chunk size.

**Recommendation:** Use heading-aware-500 as the default chunking strategy.

---

## Experiment 2: Embedding Models (heading-aware-500 chunks)

Holding chunking constant, we compared Voyage-3 vs Gemini-embedding-001:

| Model | Dimensions | R@5 | R@10 | MRR@5 | Misses@5 |
|---|---|---|---|---|---|
| **gemini-embedding-001** | 1024 (MRL truncated) | **0.900** | **0.950** | **0.875** | q3, q20 |
| voyage-3 | 1024 | 0.800 | 0.900 | 0.597 | q1, q3, q6, q9 |

**Findings:**
- **Gemini is substantially better** — R@5 +0.100, MRR +0.278. The MRR gap is the most significant: Gemini puts the correct chunk at rank 1 or 2 much more often.
- **Gemini has fewer misses** — only 2 queries fail at R@5 (vs 4 for Voyage).
- **Both miss q3** ("two deep leadership transportation") — this is a hard query where the safety concept spans multiple G2SS sections.
- **Unexpected result** given Voyage's 32K context window vs Gemini's 2K. For pre-chunked content at ~500 tokens per chunk, the longer context window doesn't help. Gemini's higher MTEB score (68.32 #1) translates to real retrieval quality.

**Recommendation:** Switch to Gemini-embedding-001 for production retrieval.

**Cost comparison:**
| Model | Price/MTok | Corpus embed cost | Free tier |
|---|---|---|---|
| Gemini-embedding-001 | $0.15 | ~$0.17 | 1,500 req/day |
| Voyage-3 | $0.06 | ~$0.06 | 200M tokens |

Both are negligible at this scale. Gemini is 2.5x more expensive per token but still under $1 total.

---

## Experiment 3: Search Methods (Voyage-3 + heading-aware-500)

Holding embeddings and chunking constant, we compared 5 search methods:

| Method | R@5 | R@10 | MRR@5 | Misses@5 |
|---|---|---|---|---|
| **source-boosted RRF** | **0.950** | **1.000** | **0.852** | q16 |
| weighted-0.4v/0.6b | 0.900 | 1.000 | 0.691 | q3, q9 |
| weighted-0.6v/0.4b | 0.900 | 1.000 | 0.660 | q3, q9 |
| rrf-hybrid | 0.850 | 0.950 | 0.581 | q1, q3, q9 |
| vector-only | 0.800 | 0.900 | 0.597 | q1, q3, q6, q9 |
| BM25-only | 0.375* | — | — | most queries |

*BM25 tested separately with fixed keyword extraction.

**Findings:**
- **Source-boosted RRF is the clear winner** — R@5=0.950 (19/20), R@10=1.000 (perfect). Only misses q16 (swimming MB distance) which it finds at R@10.
- **All hybrid methods beat vector-only** — even basic RRF (0.850) outperforms vector-only (0.800). The BM25 signal adds meaningful discriminative power.
- **Source-type boosting is highly effective** — a simple 1.5x multiplier on G2SS/G2A chunks for safety/policy queries resolves the safety retrieval weakness that plagued vector-only search.
- **BM25 alone is weak (0.375)** — scouting terminology is shared across the entire corpus. "Swimming", "safety", "leadership" appear in dozens of documents. BM25 can't distinguish the authoritative source from tangentially related content. But it still helps in hybrid mode by boosting exact keyword matches.
- **Weight balance matters less than expected** — 0.4v/0.6b and 0.6v/0.4b both hit 0.900 R@5. The fusion itself is more important than the exact weights.

**How source boosting works:**
```
1. Run RRF hybrid (merge vector + BM25 results)
2. Detect query type by keywords:
   - Safety keywords (protection, ypt, driving, swim) → boost G2SS/YPT chunks 1.5x
   - Policy keywords (board, review, partial, appeal) → boost G2A chunks 1.3x
   - Merit badge name detected → boost that MB's chunks 1.1x
3. Re-rank by boosted scores
```

This is simple, interpretable, and effective. No ML model needed — just keyword detection + source metadata.

---

## Experiment 4: Gemini + Hybrid Search

Testing Gemini-embedding-001 with hybrid methods, plus fixed BM25 baseline:

| Config | R@5 | R@10 | MRR@5 | Misses@5 |
|---|---|---|---|---|
| **gemini-rrf** | **0.950** | **1.000** | 0.718 | q20 only |
| gemini-vector | 0.900 | 0.950 | **0.875** | q3, q20 |
| gemini-source-boosted | 0.900 | 1.000 | 0.693 | q16, q18 |
| voyage-source-boosted | 0.900 | 1.000 | 0.724 | q15, q16 |
| bm25-fixed (OR keywords) | 0.650 | 0.900 | 0.558 | 7 misses |

**Findings:**
- **Gemini RRF hybrid is the best R@5 (0.950) with perfect R@10** — only misses q20 ("service hours community project ideas") which is the vaguest query in the set.
- **Gemini vector-only has the best MRR (0.875)** — when it finds the right document, it ranks it #1 more often than any hybrid method. The hybrid methods trade MRR for recall (they find more documents but rank them slightly lower).
- **Source boosting actually hurts Gemini slightly** (0.900 vs 0.950 for basic RRF) — Gemini's embeddings are already good enough that the source boost introduces false positives (boosting a G2SS chunk when the actual answer is in a MB).
- **BM25 alone at 0.650 R@5** — the fixed keyword extraction (OR logic, stopword removal) gets reasonable results. 7 misses but R@10=0.900 shows the content is findable.

**Key insight:** Source boosting helps Voyage (0.800 → 0.900) more than Gemini (0.900 → no improvement). Gemini's stronger embeddings already handle the source disambiguation that Voyage needs help with.

## Grand Comparison: All Configurations

| Config | R@5 | R@10 | MRR@5 | Notes |
|---|---|---|---|---|
| **gemini-rrf** | **0.950** | **1.000** | 0.718 | Best recall |
| **gemini-vector** | 0.900 | 0.950 | **0.875** | Best MRR |
| voyage-source-boosted (prev run) | 0.950 | 1.000 | 0.852 | Best Voyage config |
| gemini-source-boosted | 0.900 | 1.000 | 0.693 | Source boost hurts Gemini |
| voyage-source-boosted (this run) | 0.900 | 1.000 | 0.724 | |
| weighted-0.4v/0.6b | 0.900 | 1.000 | 0.691 | |
| rrf-hybrid (Voyage) | 0.850 | 0.950 | 0.581 | |
| voyage-vector | 0.800 | 0.900 | 0.597 | Baseline |
| bm25-only | 0.650 | 0.900 | 0.558 | Fixed keyword extraction |

**The recommendation depends on the priority:**
- **Maximize recall (find the right doc):** Gemini RRF hybrid (R@5=0.950, R@10=1.000)
- **Maximize ranking (right doc at #1):** Gemini vector-only (MRR=0.875)
- **Production balance:** Gemini RRF hybrid — the MRR gap (0.718 vs 0.875) is acceptable because the top-5 results are all passed to the LLM anyway, and R@5=0.950 means the right content is almost always included.

---

## BM25 Analysis

BM25 (keyword/full-text search) was investigated as both a standalone method and a hybrid component.

**Why BM25 alone fails for this corpus:**
1. **Shared terminology:** "Merit badge", "requirement", "scout", "camping" appear in hundreds of chunks across different documents
2. **Multi-word query dilution:** FalkorDB's full-text search uses AND semantics by default. A 6-word query matches nothing because no single chunk contains all words.
3. **OR semantics too broad:** Using OR (`word1 | word2 | word3`) returns results but with poor precision — common words match everywhere

**Why BM25 still helps in hybrid mode:**
1. **Exact phrase boosting:** When a chunk contains "Safe Swim Defense" and the query contains those exact words, BM25 gives a strong signal that vector similarity might miss
2. **Proper noun matching:** "Personal Fitness", "Citizenship in Society", "Guide to Advancement" — BM25 excels at matching specific badge/document names
3. **Complementary errors:** Vector search and BM25 tend to fail on different queries. Fusing them covers more ground than either alone.

**Optimization applied:** Extract 3-4 distinctive keywords (after removing stopwords + common scouting terms), use OR logic for multi-keyword queries.

---

## Recommendations for Production

### Immediate Changes
1. **Switch to Gemini-embedding-001** for new embeddings ($0.15/MTok, best quality)
2. **Implement source-boosted RRF hybrid** in `search_bsa_reference` tool
3. **Keep heading-aware-500 chunking** — best efficiency, competitive quality

### Architecture
```
Query → [Gemini embed] → FalkorDB vector KNN (top 20)
Query → [keyword extract] → FalkorDB full-text (top 20)
                                    ↓
                           RRF merge + source boost
                                    ↓
                              Top 5 results → LLM
```

### Future Experiments
- **Gemini-embedding-2-preview** when it reaches GA (8K context, multimodal)
- **voyage-context-3** if it becomes available on the Voyage API (contextual embeddings without LLM enrichment)
- **Learned sparse embeddings** (SPLADE-style) for better BM25 alternative
- **Query-type classifier** — use an LLM to detect query intent and dynamically adjust vector/BM25 weights and source boosting
- **Larger test set** — 20 queries gives useful signal but more would reduce variance

---

## Cost Summary

| Item | Cost |
|---|---|
| Voyage-3 embeddings (6 configs × ~2K-4K chunks) | ~$0.80 |
| Gemini embeddings (2 configs × ~2K-4K chunks) | ~$0.40 |
| Voyage query embeddings (~200 queries) | ~$0.01 |
| Gemini query embeddings (~100 queries) | Free tier |
| FalkorDB (local Docker) | $0 |
| **Total experiment cost** | **~$1.25** |

---

## Appendix: Per-Query Results

### Consistently Hard Queries (fail across multiple configs)
- **q3:** "two deep leadership transportation requirements" — G2SS content, concept spans multiple sections
- **q15:** "maximum driving time for scout troop travel" — specific rule buried in G2SS (fixed by source boosting)
- **q16:** "swimming merit badge distance requirements" — similar content in multiple MBs (lifesaving, swimming, multisport)

### Queries Most Improved by Hybrid Search
- **q1:** "camping merit badge" — vector found program features, BM25 found the actual MB
- **q6:** "youth protection digital communication" — vector found communication MB, source boost found YPT
- **q9:** "first aid CPR" — vector found rank requirements, BM25 found the actual first aid MB
