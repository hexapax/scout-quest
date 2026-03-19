#!/usr/bin/env python3
"""Evaluate retrieval quality across embedding/chunking combinations.

Runs test queries against embeddings loaded in a local FalkorDB instance
and measures Recall@K and MRR.

Usage:
  python3 eval-retrieval.py --embeddings output/embeddings-voyage-3-heading-aware-500.jsonl
  python3 eval-retrieval.py --embeddings output/embeddings-gemini-embedding-001-heading-aware-500.jsonl
  python3 eval-retrieval.py --compare  # Run all available embedding files and compare

Requires: local FalkorDB on port 6380, VOYAGE_API_KEY or GEMINI_KEY for query embedding.
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import redis

OUTPUT_DIR = Path(__file__).parent / "output"
GRAPH_NAME = "retrieval_test"
FALKORDB_PORT = int(os.environ.get("FALKORDB_PORT", "6380"))

# ---------------------------------------------------------------
# Test queries with expected relevant sources
# Each query has a list of source file patterns that should match
# ---------------------------------------------------------------

TEST_QUERIES = [
    {
        "id": "q1",
        "query": "How many camping nights do I need for Camping merit badge?",
        "relevant_sources": ["merit-badges/camping"],
        "category": "requirement_lookup",
    },
    {
        "id": "q2",
        "query": "What are the requirements for the board of review?",
        "relevant_sources": ["guide-to-advancement"],
        "category": "policy_lookup",
    },
    {
        "id": "q3",
        "query": "two deep leadership transportation requirements",
        "relevant_sources": ["guide-to-safe-scouting"],
        "category": "safety_lookup",
    },
    {
        "id": "q4",
        "query": "Can partial merit badge completions expire?",
        "relevant_sources": ["guide-to-advancement"],
        "category": "policy_lookup",
    },
    {
        "id": "q5",
        "query": "Personal Fitness 12 week exercise plan requirements",
        "relevant_sources": ["merit-badges/personal-fitness"],
        "category": "requirement_lookup",
    },
    {
        "id": "q6",
        "query": "youth protection one on one digital communication",
        "relevant_sources": ["youth-protection", "guide-to-safe-scouting"],
        "category": "safety_lookup",
    },
    {
        "id": "q7",
        "query": "Eagle Scout project planning and approval process",
        "relevant_sources": ["guide-to-advancement", "rank-requirements"],
        "category": "policy_lookup",
    },
    {
        "id": "q8",
        "query": "cooking merit badge outdoor cooking requirements",
        "relevant_sources": ["merit-badges/cooking"],
        "category": "requirement_lookup",
    },
    {
        "id": "q9",
        "query": "first aid merit badge CPR and rescue breathing",
        "relevant_sources": ["merit-badges/first-aid"],
        "category": "requirement_lookup",
    },
    {
        "id": "q10",
        "query": "what is the patrol method and how does it work",
        "relevant_sources": ["troop-leader-guidebook"],
        "category": "concept_lookup",
    },
    {
        "id": "q11",
        "query": "environmental science ecology experiments",
        "relevant_sources": ["merit-badges/environmental-science"],
        "category": "requirement_lookup",
    },
    {
        "id": "q12",
        "query": "Star Scout leadership position requirements",
        "relevant_sources": ["rank-requirements"],
        "category": "requirement_lookup",
    },
    {
        "id": "q13",
        "query": "Safe Swim Defense eight points of safety",
        "relevant_sources": ["guide-to-safe-scouting"],
        "category": "safety_lookup",
    },
    {
        "id": "q14",
        "query": "citizenship in society diversity equity requirements",
        "relevant_sources": ["merit-badges/citizenship-in-society"],
        "category": "requirement_lookup",
    },
    {
        "id": "q15",
        "query": "maximum driving time for scout troop travel",
        "relevant_sources": ["guide-to-safe-scouting"],
        "category": "safety_lookup",
    },
    {
        "id": "q16",
        "query": "swimming merit badge distance requirements",
        "relevant_sources": ["merit-badges/swimming"],
        "category": "requirement_lookup",
    },
    {
        "id": "q17",
        "query": "how to appeal a board of review decision",
        "relevant_sources": ["guide-to-advancement"],
        "category": "policy_lookup",
    },
    {
        "id": "q18",
        "query": "Tenderfoot knot tying and first aid requirements",
        "relevant_sources": ["rank-requirements"],
        "category": "requirement_lookup",
    },
    {
        "id": "q19",
        "query": "scoutmaster conference what to expect",
        "relevant_sources": ["guide-to-advancement", "troop-leader-guidebook"],
        "category": "concept_lookup",
    },
    {
        "id": "q20",
        "query": "service hours community service project ideas",
        "relevant_sources": ["program-features", "rank-requirements"],
        "category": "concept_lookup",
    },
]


def embed_query_voyage(query, model="voyage-3"):
    import voyageai
    vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    resp = vo.embed([query], model=model, input_type="query")
    return resp.embeddings[0]


def embed_query_gemini(query, model="gemini-embedding-001"):
    from google import genai
    api_key = os.environ.get("GEMINI_KEY") or os.environ.get("GOOGLE_KEY")
    client = genai.Client(api_key=api_key)
    resp = client.models.embed_content(
        model=model, contents=[query],
        config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": 1024},
    )
    return resp.embeddings[0].values


def load_embeddings_to_falkordb(client, embeddings_file):
    """Load embeddings into a local FalkorDB graph for testing."""
    # Clear existing graph
    try:
        client.sendCommand(["GRAPH.DELETE", GRAPH_NAME])
    except:
        pass

    with open(embeddings_file) as f:
        records = [json.loads(line) for line in f if line.strip()]

    print(f"Loading {len(records)} embeddings into FalkorDB...")
    for i, rec in enumerate(records):
        text = rec.get("text", "")[:500].replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
        source = rec.get("source", "").replace("'", "\\'")
        title = rec.get("title", "").replace("'", "\\'")
        vec_str = f"vecf32([{','.join(str(v) for v in rec['embedding'])}])"

        cypher = (
            f"CREATE (:Chunk {{"
            f"chunkId: '{rec['id']}', "
            f"source: '{source}', "
            f"title: '{title}', "
            f"text: '{text}', "
            f"embedding: {vec_str}"
            f"}})"
        )
        client.sendCommand(["GRAPH.QUERY", GRAPH_NAME, cypher])
        if (i + 1) % 200 == 0:
            print(f"  {i+1}/{len(records)}")

    # Create vector index
    try:
        dim = records[0]["dimensions"]
        client.sendCommand(["GRAPH.QUERY", GRAPH_NAME,
            f"CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {{dimension: {dim}, similarityFunction: 'cosine'}}"])
        print("  Vector index created")
    except Exception as e:
        print(f"  Index: {str(e)[:60]}")

    print(f"  Loaded {len(records)} chunks")
    return len(records)


def run_query(client, query_vec, k=10):
    """Run a KNN query and return results."""
    vec_str = f"vecf32([{','.join(str(v) for v in query_vec)}])"
    cypher = (
        f"CALL db.idx.vector.queryNodes('Chunk', 'embedding', {k}, {vec_str}) "
        f"YIELD node, score "
        f"RETURN node.chunkId AS id, node.source AS source, node.title AS title, "
        f"node.text AS text, score "
        f"ORDER BY score DESC LIMIT {k}"
    )
    raw = client.sendCommand(["GRAPH.QUERY", GRAPH_NAME, cypher])
    # Parse response
    if not isinstance(raw, list) or len(raw) < 2:
        return []
    headers = raw[0]
    rows = raw[1] if isinstance(raw[1], list) else []
    results = []
    for row in rows:
        if isinstance(row, list):
            record = {}
            for i, h in enumerate(headers):
                val = row[i] if i < len(row) else None
                record[h] = val
            results.append(record)
    return results


def is_relevant(result_source, expected_sources):
    """Check if a result matches any expected source pattern."""
    if not result_source:
        return False
    for pattern in expected_sources:
        if pattern in str(result_source):
            return True
    return False


def evaluate(client, embed_fn, queries=TEST_QUERIES, k_values=[5, 10]):
    """Run all queries and compute metrics."""
    results = []

    for q in queries:
        query_vec = embed_fn(q["query"])
        search_results = run_query(client, query_vec, k=max(k_values))

        # Compute metrics
        for k in k_values:
            top_k = search_results[:k]
            hits = [r for r in top_k if is_relevant(r.get("source"), q["relevant_sources"])]
            recall = 1.0 if len(hits) > 0 else 0.0

            # MRR: reciprocal rank of first relevant result
            mrr = 0.0
            for rank, r in enumerate(top_k, 1):
                if is_relevant(r.get("source"), q["relevant_sources"]):
                    mrr = 1.0 / rank
                    break

            results.append({
                "query_id": q["id"],
                "query": q["query"],
                "category": q["category"],
                "k": k,
                "recall": recall,
                "mrr": mrr,
                "num_hits": len(hits),
                "top_sources": [r.get("source", "?")[:40] for r in top_k[:3]],
            })

    return results


def print_summary(results, label):
    """Print summary metrics."""
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}\n")

    for k in [5, 10]:
        k_results = [r for r in results if r["k"] == k]
        recalls = [r["recall"] for r in k_results]
        mrrs = [r["mrr"] for r in k_results]
        avg_recall = sum(recalls) / len(recalls) if recalls else 0
        avg_mrr = sum(mrrs) / len(mrrs) if mrrs else 0
        print(f"  Recall@{k}: {avg_recall:.3f}  ({sum(1 for r in recalls if r > 0)}/{len(recalls)} queries hit)")
        print(f"  MRR@{k}:    {avg_mrr:.3f}")

    # Per-category
    print(f"\n  Per-category Recall@5:")
    categories = sorted(set(r["category"] for r in results))
    for cat in categories:
        cat_results = [r for r in results if r["category"] == cat and r["k"] == 5]
        recall = sum(r["recall"] for r in cat_results) / len(cat_results) if cat_results else 0
        print(f"    {cat}: {recall:.3f} ({len(cat_results)} queries)")

    # Failed queries
    failures = [r for r in results if r["k"] == 5 and r["recall"] == 0]
    if failures:
        print(f"\n  Failed queries (Recall@5 = 0):")
        for f in failures:
            print(f"    {f['query_id']}: {f['query'][:50]}...")
            print(f"      Got: {', '.join(f['top_sources'])}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", help="Path to embeddings JSONL file")
    parser.add_argument("--compare", action="store_true", help="Compare all available embedding files")
    parser.add_argument("--port", type=int, default=6380, help="FalkorDB port (default: 6380)")
    args = parser.parse_args()

    global FALKORDB_PORT
    FALKORDB_PORT = args.port

    client = redis.Redis(host="localhost", port=FALKORDB_PORT, decode_responses=True)
    client.ping()
    print(f"Connected to FalkorDB on port {FALKORDB_PORT}")

    if args.compare:
        # Find all embedding files
        emb_files = sorted(OUTPUT_DIR.glob("embeddings-*.jsonl"))
        if not emb_files:
            print("No embedding files found in output/. Run embed.py first.")
            sys.exit(1)

        all_summaries = []
        for emb_file in emb_files:
            label = emb_file.stem.replace("embeddings-", "")
            print(f"\n--- Testing {label} ---")
            load_embeddings_to_falkordb(client, emb_file)

            # Determine embed function from filename
            if "voyage" in label:
                embed_fn = embed_query_voyage
            elif "gemini" in label:
                embed_fn = embed_query_gemini
            else:
                print(f"  Unknown model in filename: {label}")
                continue

            results = evaluate(client, embed_fn)
            print_summary(results, label)

            # Save results
            outfile = OUTPUT_DIR / f"retrieval-eval-{label}.json"
            with open(outfile, "w") as f:
                json.dump(results, f, indent=2)
            all_summaries.append((label, results))

        # Final comparison table
        print(f"\n{'='*70}")
        print(f"  COMPARISON MATRIX")
        print(f"{'='*70}\n")
        print(f"  {'Config':<40} {'R@5':>6} {'R@10':>6} {'MRR@5':>7}")
        print(f"  {'-'*40} {'-'*6} {'-'*6} {'-'*7}")
        for label, results in all_summaries:
            r5 = [r for r in results if r["k"] == 5]
            r10 = [r for r in results if r["k"] == 10]
            recall5 = sum(r["recall"] for r in r5) / len(r5) if r5 else 0
            recall10 = sum(r["recall"] for r in r10) / len(r10) if r10 else 0
            mrr5 = sum(r["mrr"] for r in r5) / len(r5) if r5 else 0
            print(f"  {label:<40} {recall5:>6.3f} {recall10:>6.3f} {mrr5:>7.3f}")

    elif args.embeddings:
        label = Path(args.embeddings).stem.replace("embeddings-", "")
        load_embeddings_to_falkordb(client, args.embeddings)

        if "voyage" in label:
            embed_fn = embed_query_voyage
        elif "gemini" in label:
            embed_fn = embed_query_gemini
        else:
            print(f"Unknown model. Set manually.")
            sys.exit(1)

        results = evaluate(client, embed_fn)
        print_summary(results, label)

        outfile = OUTPUT_DIR / f"retrieval-eval-{label}.json"
        with open(outfile, "w") as f:
            json.dump(results, f, indent=2)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
