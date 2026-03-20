#!/usr/bin/env python3
"""Run all retrieval experiments: Gemini embeddings + hybrid search methods.

Usage:
  VOYAGE_API_KEY=... GEMINI_KEY=... python3 run-all-experiments.py

Requires: local FalkorDB on port 6380.
"""

import json
import math
import os
import re
import sys
import time
from pathlib import Path

import redis
import voyageai

OUTPUT_DIR = Path(__file__).parent / "output"
GRAPH_NAME = "retrieval_test"
PORT = int(os.environ.get("FALKORDB_PORT", "6380"))

# ---------------------------------------------------------------
# Test queries (same as eval-retrieval.py)
# ---------------------------------------------------------------

TEST_QUERIES = [
    {"id": "q1", "query": "How many camping nights do I need for Camping merit badge?", "relevant_sources": ["merit-badges/camping"], "category": "requirement_lookup"},
    {"id": "q2", "query": "What are the requirements for the board of review?", "relevant_sources": ["guide-to-advancement"], "category": "policy_lookup"},
    {"id": "q3", "query": "two deep leadership transportation requirements", "relevant_sources": ["guide-to-safe-scouting"], "category": "safety_lookup"},
    {"id": "q4", "query": "Can partial merit badge completions expire?", "relevant_sources": ["guide-to-advancement"], "category": "policy_lookup"},
    {"id": "q5", "query": "Personal Fitness 12 week exercise plan requirements", "relevant_sources": ["merit-badges/personal-fitness"], "category": "requirement_lookup"},
    {"id": "q6", "query": "youth protection one on one digital communication", "relevant_sources": ["youth-protection", "guide-to-safe-scouting"], "category": "safety_lookup"},
    {"id": "q7", "query": "Eagle Scout project planning and approval process", "relevant_sources": ["guide-to-advancement", "rank-requirements"], "category": "policy_lookup"},
    {"id": "q8", "query": "cooking merit badge outdoor cooking requirements", "relevant_sources": ["merit-badges/cooking"], "category": "requirement_lookup"},
    {"id": "q9", "query": "first aid merit badge CPR and rescue breathing", "relevant_sources": ["merit-badges/first-aid"], "category": "requirement_lookup"},
    {"id": "q10", "query": "what is the patrol method and how does it work", "relevant_sources": ["troop-leader-guidebook"], "category": "concept_lookup"},
    {"id": "q11", "query": "environmental science ecology experiments", "relevant_sources": ["merit-badges/environmental-science"], "category": "requirement_lookup"},
    {"id": "q12", "query": "Star Scout leadership position requirements", "relevant_sources": ["rank-requirements"], "category": "requirement_lookup"},
    {"id": "q13", "query": "Safe Swim Defense eight points of safety", "relevant_sources": ["guide-to-safe-scouting"], "category": "safety_lookup"},
    {"id": "q14", "query": "citizenship in society diversity equity requirements", "relevant_sources": ["merit-badges/citizenship-in-society"], "category": "requirement_lookup"},
    {"id": "q15", "query": "maximum driving time for scout troop travel", "relevant_sources": ["guide-to-safe-scouting"], "category": "safety_lookup"},
    {"id": "q16", "query": "swimming merit badge distance requirements", "relevant_sources": ["merit-badges/swimming"], "category": "requirement_lookup"},
    {"id": "q17", "query": "how to appeal a board of review decision", "relevant_sources": ["guide-to-advancement"], "category": "policy_lookup"},
    {"id": "q18", "query": "Tenderfoot knot tying and first aid requirements", "relevant_sources": ["rank-requirements"], "category": "requirement_lookup"},
    {"id": "q19", "query": "scoutmaster conference what to expect", "relevant_sources": ["guide-to-advancement", "troop-leader-guidebook"], "category": "concept_lookup"},
    {"id": "q20", "query": "service hours community service project ideas", "relevant_sources": ["program-features", "rank-requirements"], "category": "concept_lookup"},
]

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------

client = redis.Redis(host="localhost", port=PORT, decode_responses=True)

def clear_graph():
    try:
        client.execute_command("GRAPH.DELETE", GRAPH_NAME)
    except:
        pass

def load_embeddings(filepath):
    clear_graph()
    with open(filepath) as f:
        records = [json.loads(line) for line in f if line.strip()]
    print(f"  Loading {len(records)} embeddings...")
    for i, rec in enumerate(records):
        text = rec.get("text", "")[:500].replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
        source = rec.get("source", "").replace("'", "\\'")
        title = rec.get("title", "").replace("'", "\\'")
        vec = f"vecf32([{','.join(str(v) for v in rec['embedding'])}])"
        cypher = (f"CREATE (:Chunk {{chunkId: '{rec['id']}', source: '{source}', "
                  f"title: '{title}', text: '{text}', embedding: {vec}}})")
        client.execute_command("GRAPH.QUERY", GRAPH_NAME, cypher)
        if (i + 1) % 500 == 0:
            print(f"    {i+1}/{len(records)}")
    # Vector index
    dim = records[0]["dimensions"]
    try:
        client.execute_command("GRAPH.QUERY", GRAPH_NAME,
            f"CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {{dimension: {dim}, similarityFunction: 'cosine'}}")
    except:
        pass
    # Full-text index for BM25
    try:
        client.execute_command("GRAPH.QUERY", GRAPH_NAME,
            "CALL db.idx.fulltext.createNodeIndex('Chunk', 'text', 'title', 'source')")
    except:
        pass
    time.sleep(1)
    print(f"  Loaded {len(records)} chunks with vector + full-text indexes")
    return records

def is_relevant(source, expected):
    if not source:
        return False
    return any(p in str(source) for p in expected)

# ---------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------

vo_client = voyageai.Client(api_key=os.environ.get("VOYAGE_API_KEY", ""))

def embed_voyage(text):
    return vo_client.embed([text], model="voyage-3", input_type="query").embeddings[0]

def embed_gemini(text):
    from google import genai
    gc = genai.Client(api_key=os.environ["GEMINI_KEY"])
    resp = gc.models.embed_content(
        model="gemini-embedding-001", contents=[text],
        config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": 1024})
    return resp.embeddings[0].values

def vector_search(qvec, k=10):
    vec_str = f"vecf32([{','.join(str(v) for v in qvec)}])"
    cypher = (f"CALL db.idx.vector.queryNodes('Chunk', 'embedding', {k}, {vec_str}) "
              f"YIELD node, score RETURN node.chunkId AS id, node.source AS source, score ORDER BY score ASC LIMIT {k}")
    try:
        raw = client.execute_command("GRAPH.QUERY", GRAPH_NAME, cypher)
        if not isinstance(raw, list) or len(raw) < 2:
            return []
        results = []
        rows = raw[1] if isinstance(raw[1], list) else []
        for row in rows:
            if isinstance(row, list) and len(row) >= 3:
                try:
                    results.append({"id": row[0], "source": row[1], "score": float(row[2]) if str(row[2]) != "-nan" else 999})
                except (ValueError, TypeError):
                    pass
        return results
    except Exception as e:
        print(f"    Vector search error: {str(e)[:100]}")
        return []

def bm25_search(query, k=10):
    # Extract meaningful keywords (drop short words, special chars)
    words = re.findall(r'[a-zA-Z]{3,}', query.lower())
    # Take top keywords, join with spaces for FalkorDB full-text
    safe_q = " ".join(words[:8])
    cypher = (f"CALL db.idx.fulltext.queryNodes('Chunk', '{safe_q}') "
              f"YIELD node, score RETURN node.chunkId AS id, node.source AS source, score ORDER BY score DESC LIMIT {k}")
    try:
        raw = client.execute_command("GRAPH.QUERY", GRAPH_NAME, cypher)
        if not isinstance(raw, list) or len(raw) < 2:
            return []
        results = []
        rows = raw[1] if isinstance(raw[1], list) else []
        for row in rows:
            if isinstance(row, list) and len(row) >= 3:
                try:
                    results.append({"id": row[0], "source": row[1], "score": float(row[2])})
                except (ValueError, TypeError):
                    pass
        return results
    except Exception as e:
        print(f"    BM25 error: {str(e)[:80]}")
        return []

def rrf_hybrid(qvec, query, k=10, rrf_k=60):
    """Reciprocal Rank Fusion: merge vector + BM25 results."""
    vec_results = vector_search(qvec, k=k*2)
    bm25_results = bm25_search(query, k=k*2)

    scores = {}
    for rank, r in enumerate(vec_results):
        scores[r["id"]] = scores.get(r["id"], {"id": r["id"], "source": r["source"], "rrf": 0})
        scores[r["id"]]["rrf"] += 1.0 / (rrf_k + rank + 1)
        scores[r["id"]]["source"] = r["source"]

    for rank, r in enumerate(bm25_results):
        scores[r["id"]] = scores.get(r["id"], {"id": r["id"], "source": r["source"], "rrf": 0})
        scores[r["id"]]["rrf"] += 1.0 / (rrf_k + rank + 1)
        scores[r["id"]]["source"] = r["source"]

    merged = sorted(scores.values(), key=lambda x: x["rrf"], reverse=True)
    return [{"id": r["id"], "source": r["source"], "score": r["rrf"]} for r in merged[:k]]

def weighted_hybrid(qvec, query, k=10, vec_weight=0.5, bm25_weight=0.5):
    """Weighted combination of vector + BM25 scores."""
    vec_results = vector_search(qvec, k=k*2)
    bm25_results = bm25_search(query, k=k*2)

    # Normalize scores to 0-1 range
    if vec_results:
        vec_min = min(r["score"] for r in vec_results)
        vec_max = max(r["score"] for r in vec_results)
        vec_range = vec_max - vec_min if vec_max > vec_min else 1
        for r in vec_results:
            r["norm_score"] = 1.0 - (r["score"] - vec_min) / vec_range  # cosine distance → similarity
    if bm25_results:
        bm25_max = max(r["score"] for r in bm25_results)
        for r in bm25_results:
            r["norm_score"] = r["score"] / bm25_max if bm25_max > 0 else 0

    scores = {}
    for r in vec_results:
        scores[r["id"]] = {"id": r["id"], "source": r["source"], "combined": r["norm_score"] * vec_weight}
    for r in bm25_results:
        if r["id"] in scores:
            scores[r["id"]]["combined"] += r["norm_score"] * bm25_weight
        else:
            scores[r["id"]] = {"id": r["id"], "source": r["source"], "combined": r["norm_score"] * bm25_weight}

    merged = sorted(scores.values(), key=lambda x: x["combined"], reverse=True)
    return [{"id": r["id"], "source": r["source"], "score": r["combined"]} for r in merged[:k]]

def source_boosted(qvec, query, k=10):
    """Boost authoritative sources for safety/policy queries."""
    base = rrf_hybrid(qvec, query, k=k*2)

    # Detect query type by keywords
    safety_kw = ["safety", "protection", "ypt", "two-deep", "driving", "swim", "transport"]
    policy_kw = ["board of review", "bor", "partial", "appeal", "g2a", "advancement", "expire"]
    is_safety = any(kw in query.lower() for kw in safety_kw)
    is_policy = any(kw in query.lower() for kw in policy_kw)

    for r in base:
        src = str(r.get("source", "")).lower()
        if is_safety and ("guide-to-safe-scouting" in src or "youth-protection" in src):
            r["score"] *= 1.5
        elif is_policy and "guide-to-advancement" in src:
            r["score"] *= 1.3
        # Always slightly boost specific MB matches
        if "merit-badges/" in src:
            r["score"] *= 1.1

    return sorted(base, key=lambda x: x["score"], reverse=True)[:k]

# ---------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------

def evaluate_method(search_fn, queries=TEST_QUERIES, k_values=[5, 10]):
    results = []
    for q in queries:
        search_results = search_fn(q["query"])
        for k in k_values:
            top_k = search_results[:k]
            hits = [r for r in top_k if is_relevant(r.get("source"), q["relevant_sources"])]
            mrr = 0.0
            for rank, r in enumerate(top_k, 1):
                if is_relevant(r.get("source"), q["relevant_sources"]):
                    mrr = 1.0 / rank
                    break
            results.append({
                "query_id": q["id"], "query": q["query"], "category": q["category"],
                "k": k, "recall": 1.0 if hits else 0.0, "mrr": mrr, "num_hits": len(hits),
                "top_sources": [r.get("source", "?")[:50] for r in top_k[:3]],
            })
    return results

def summarize(results, label):
    for k in [5, 10]:
        kr = [r for r in results if r["k"] == k]
        recall = sum(r["recall"] for r in kr) / len(kr) if kr else 0
        mrr = sum(r["mrr"] for r in kr) / len(kr) if kr else 0
        print(f"    R@{k}={recall:.3f} MRR@{k}={mrr:.3f} ({sum(1 for r in kr if r['recall']>0)}/{len(kr)})")

    # Failures
    failures = [r for r in results if r["k"] == 5 and r["recall"] == 0]
    if failures:
        print(f"    Misses: {', '.join(r['query_id'] for r in failures)}")

# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------

print("=" * 70)
print("  RETRIEVAL EXPERIMENTS — Embeddings + Hybrid Search")
print("=" * 70)
print()

all_results = []

# ===== PART 1: Gemini embeddings =====
print("=" * 50)
print("PART 1: Gemini Embeddings vs Voyage")
print("=" * 50)

gemini_file = OUTPUT_DIR / "embeddings-gemini-embedding-001-heading-aware-500.jsonl"
voyage_file = OUTPUT_DIR / "embeddings-voyage-3-heading-aware-500.jsonl"

if gemini_file.exists():
    print("\n--- gemini-embedding-001 + heading-aware-500 (vector only) ---")
    load_embeddings(gemini_file)
    r = evaluate_method(lambda q: vector_search(embed_gemini(q)))
    summarize(r, "gemini-vector")
    all_results.append(("gemini-ha500-vector", r))
else:
    print(f"  Skipping Gemini — {gemini_file} not found")

if voyage_file.exists():
    print("\n--- voyage-3 + heading-aware-500 (vector only, baseline) ---")
    load_embeddings(voyage_file)
    r = evaluate_method(lambda q: vector_search(embed_voyage(q)))
    summarize(r, "voyage-vector")
    all_results.append(("voyage-ha500-vector", r))

# ===== PART 2: Hybrid search methods (using voyage-3 heading-aware-500) =====
print("\n" + "=" * 50)
print("PART 2: Hybrid Search Methods (Voyage + heading-aware-500)")
print("=" * 50)

# Reload voyage embeddings (may have been overwritten by gemini test)
if voyage_file.exists():
    load_embeddings(voyage_file)

    print("\n--- BM25 only ---")
    r = evaluate_method(lambda q: bm25_search(q))
    summarize(r, "bm25-only")
    all_results.append(("bm25-only", r))

    print("\n--- RRF Hybrid (vector + BM25) ---")
    r = evaluate_method(lambda q: rrf_hybrid(embed_voyage(q), q))
    summarize(r, "rrf-hybrid")
    all_results.append(("rrf-hybrid", r))

    print("\n--- Weighted Hybrid (0.4 vec + 0.6 bm25) ---")
    r = evaluate_method(lambda q: weighted_hybrid(embed_voyage(q), q, vec_weight=0.4, bm25_weight=0.6))
    summarize(r, "weighted-0.4v-0.6b")
    all_results.append(("weighted-0.4v-0.6b", r))

    print("\n--- Weighted Hybrid (0.6 vec + 0.4 bm25) ---")
    r = evaluate_method(lambda q: weighted_hybrid(embed_voyage(q), q, vec_weight=0.6, bm25_weight=0.4))
    summarize(r, "weighted-0.6v-0.4b")
    all_results.append(("weighted-0.6v-0.4b", r))

    print("\n--- Source-Boosted RRF Hybrid ---")
    r = evaluate_method(lambda q: source_boosted(embed_voyage(q), q))
    summarize(r, "source-boosted")
    all_results.append(("source-boosted", r))

# ===== FINAL COMPARISON =====
print("\n" + "=" * 70)
print("  FINAL COMPARISON MATRIX")
print("=" * 70 + "\n")
print(f"  {'Config':<35} {'R@5':>6} {'R@10':>6} {'MRR@5':>7} {'Misses@5'}")
print(f"  {'-'*35} {'-'*6} {'-'*6} {'-'*7} {'-'*20}")

for label, results in all_results:
    r5 = [r for r in results if r["k"] == 5]
    r10 = [r for r in results if r["k"] == 10]
    recall5 = sum(r["recall"] for r in r5) / len(r5) if r5 else 0
    recall10 = sum(r["recall"] for r in r10) / len(r10) if r10 else 0
    mrr5 = sum(r["mrr"] for r in r5) / len(r5) if r5 else 0
    misses = ", ".join(r["query_id"] for r in r5 if r["recall"] == 0)
    print(f"  {label:<35} {recall5:>6.3f} {recall10:>6.3f} {mrr5:>7.3f} {misses}")

# Save all results
outfile = OUTPUT_DIR / "all-experiments-results.json"
with open(outfile, "w") as f:
    json.dump({label: results for label, results in all_results}, f, indent=2)
print(f"\nResults saved to {outfile}")
