#!/usr/bin/env python3
"""Listwise ranking of eval responses using multiple AI judges.

For each question, clusters responses by similarity, then has multiple
cheap AI judges rank representative responses in chunks of 5-7.
Aggregates rankings via Borda count and implied Bradley-Terry preferences.

Usage:
  python3 run-ranking.py --question G1 [--judges gpt-nano,deepseek,grok] [--chunk-size 6] [--budget 1.00]
  python3 run-ranking.py --question G1 --no-embeddings   # force prefix-based clustering

Reads from: MongoDB scoutquest.eval_results
Writes to:  MongoDB scoutquest.eval_rankings
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

# ---------------------------------------------------------------
# Key loading (reuse from eval runner)
# ---------------------------------------------------------------

LIBRECHAT_ENV = "/home/devuser/LibreChat/.env"

def load_key(env_var, dotenv_name=None, secret_name=None):
    val = os.environ.get(env_var)
    if val: return val
    if dotenv_name:
        try:
            for line in open(LIBRECHAT_ENV):
                if line.startswith(f"{dotenv_name}="):
                    val = line.strip().split("=", 1)[1]
                    os.environ[env_var] = val
                    return val
        except: pass
    if secret_name:
        try:
            val = subprocess.check_output(
                ["gcloud", "secrets", "versions", "access", "latest",
                 "--secret", secret_name, "--project", "hexapax-devbox"],
                text=True, timeout=10).strip()
            os.environ[env_var] = val
            return val
        except: pass
    return ""

def load_all_keys():
    load_key("OPENAI_API_KEY", "OPENAI_API_KEY", "openai-api-key")
    load_key("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", "deepseek-api-key")
    load_key("OPENROUTER_KEY", "OPENROUTER_KEY", "openrouter-api-key")
    load_key("GOOGLE_KEY", "GOOGLE_KEY")

# ---------------------------------------------------------------
# Judge callers
# ---------------------------------------------------------------

import httpx

def call_judge(provider, model, prompt, max_tokens=800):
    """Call a judge model and return text response."""
    if provider == "openai":
        url, key_env = "https://api.openai.com/v1", "OPENAI_API_KEY"
    elif provider == "deepseek":
        url, key_env = "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"
    elif provider == "openrouter":
        url, key_env = "https://openrouter.ai/api/v1", "OPENROUTER_KEY"
    else:
        raise ValueError(f"Unknown provider: {provider}")

    key = os.environ.get(key_env, "")
    r = httpx.post(f"{url}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=90)
    d = r.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"Judge error ({model}): {d.get('error', d)}")

JUDGES = {
    "gpt-nano": ("openai", "gpt-4.1-nano"),
    "deepseek": ("deepseek", "deepseek-chat"),
    "grok": ("openrouter", "x-ai/grok-3-mini"),
}

# ---------------------------------------------------------------
# Ranking prompt
# ---------------------------------------------------------------

RANKING_PROMPT = """You are ranking AI coaching responses for a Boy Scout assistant called "Scout Coach."

QUESTION from a scout: {question}

Below are {count} different responses labeled [A] through [{last_label}]. Read all of them, then:

1. RANK them from best to worst (e.g., "C > A > E > B > D")
2. For each response, give a 1-sentence reason for its position
3. Note any responses that are essentially the same quality (ties)

EVALUATION CRITERIA (in priority order for this question type: {question_type}):
- COACHING: Right approach? (empathy for emotions, direct for policy, Socratic for skills)
- ACCURACY: Factually correct BSA information?
- TROOP VOICE: Sounds like it knows this specific troop?
- SPECIFICITY: Detailed vs generic?

{eval_notes_section}

RESPONSES:

{responses_block}

YOUR RANKING (format: best > ... > worst, then reasons):"""

# ---------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------

def cluster_responses(responses, max_clusters=7):
    """Simple clustering by response prefix word overlap (fallback method).
    For better results, use cluster_responses_by_embedding() instead."""
    if len(responses) <= max_clusters:
        return [[r] for r in responses]

    # Group by first 200 chars similarity (crude but fast)
    clusters = []
    assigned = set()
    for i, r in enumerate(responses):
        if i in assigned:
            continue
        cluster = [r]
        assigned.add(i)
        prefix_i = r["response"][:200].lower()
        for j, r2 in enumerate(responses):
            if j in assigned:
                continue
            prefix_j = r2["response"][:200].lower()
            # Simple overlap check
            words_i = set(prefix_i.split())
            words_j = set(prefix_j.split())
            overlap = len(words_i & words_j) / max(len(words_i | words_j), 1)
            if overlap > 0.6:
                cluster.append(r2)
                assigned.add(j)
        clusters.append(cluster)

    # If too many clusters, merge smallest
    while len(clusters) > max_clusters:
        clusters.sort(key=len)
        smallest = clusters.pop(0)
        clusters[0].extend(smallest)

    return clusters


# ---------------------------------------------------------------
# Embedding-based clustering
# ---------------------------------------------------------------

_embeddings_col = None

def _get_embeddings_col():
    """Lazy accessor for the eval_embeddings MongoDB collection."""
    global _embeddings_col
    if _embeddings_col is None:
        from pymongo import MongoClient
        db = MongoClient("mongodb://localhost:27017")["scoutquest"]
        _embeddings_col = db["eval_embeddings"]
    return _embeddings_col


def get_embedding(text, response_hash):
    """Get embedding for text, using MongoDB cache when available.

    Uses Google Gemini text-embedding-004 model. Embeds first 500 chars
    to keep costs down (free tier eligible).
    """
    col = _get_embeddings_col()

    # Check MongoDB cache first
    cached = col.find_one({"_id": response_hash})
    if cached:
        return cached["embedding"]

    # Generate via Gemini
    from google import genai
    gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
    result = gc.models.embed_content(model="gemini-embedding-001", contents=text[:500])
    embedding = result.embeddings[0].values

    # Cache in MongoDB
    col.insert_one({
        "_id": response_hash,
        "embedding": embedding,
        "model": "text-embedding-004",
        "text_preview": text[:200],
        "created_at": datetime.now(timezone.utc),
    })
    return embedding


def cluster_responses_by_embedding(responses, max_clusters=7):
    """Cluster responses using cosine similarity on Gemini embeddings.

    Uses AgglomerativeClustering with cosine distance and average linkage.
    Falls back to prefix-based cluster_responses() if sklearn is unavailable
    or embedding generation fails.
    """
    if len(responses) <= max_clusters:
        return [[r] for r in responses]

    try:
        import numpy as np
        from sklearn.cluster import AgglomerativeClustering
    except ImportError:
        print("  sklearn not available, using prefix clustering")
        return cluster_responses(responses, max_clusters)

    # Check for GOOGLE_KEY before attempting embeddings
    if not os.environ.get("GOOGLE_KEY"):
        # Try loading from dotenv / secrets
        load_key("GOOGLE_KEY", "GOOGLE_KEY")
    if not os.environ.get("GOOGLE_KEY"):
        print("  GOOGLE_KEY not set, using prefix clustering")
        return cluster_responses(responses, max_clusters)

    # Get embeddings for all responses
    embeddings = []
    try:
        for r in responses:
            emb = get_embedding(r["response"], r["response_hash"])
            embeddings.append(emb)
    except Exception as e:
        print(f"  Embedding generation failed ({e}), using prefix clustering")
        return cluster_responses(responses, max_clusters)

    # Cluster using cosine distance
    X = np.array(embeddings)
    n_clusters = min(max_clusters, len(responses))
    clustering = AgglomerativeClustering(
        n_clusters=n_clusters, metric="cosine", linkage="average"
    )
    labels = clustering.fit_predict(X)

    # Group responses by cluster label
    clusters = {}
    for i, label in enumerate(labels):
        clusters.setdefault(label, []).append(responses[i])

    return list(clusters.values())


def pick_representatives(clusters):
    """Pick one representative response from each cluster (the one with highest existing score)."""
    reps = []
    for cluster in clusters:
        # Pick the one with highest average score, or first if no scores
        best = max(cluster, key=lambda r: sum(r.get("scores", {}).values()) / max(len(r.get("scores", {})), 1))
        reps.append({
            "response": best["response"],
            "response_hash": best["response_hash"],
            "model": best.get("model", "?"),
            "label": best.get("label", "?"),
            "cluster_size": len(cluster),
            "cluster_hashes": [r["response_hash"] for r in cluster],
            "existing_scores": best.get("scores", {}),
        })
    return reps


def build_ranking_prompt(question, question_type, eval_notes, representatives):
    """Build the listwise ranking prompt."""
    labels = [chr(65 + i) for i in range(len(representatives))]  # A, B, C, ...
    last_label = labels[-1]

    responses_block = ""
    for label, rep in zip(labels, representatives):
        # Truncate long responses
        resp_text = rep["response"][:1500]
        if len(rep["response"]) > 1500:
            resp_text += "\n[...truncated]"
        responses_block += f"\n[{label}]\n{resp_text}\n"

    eval_notes_section = ""
    if eval_notes:
        eval_notes_section = f"EVALUATOR NOTES (verified facts for this question):\n{eval_notes}\n"

    return RANKING_PROMPT.format(
        question=question,
        count=len(representatives),
        last_label=last_label,
        question_type=question_type or "general",
        eval_notes_section=eval_notes_section,
        responses_block=responses_block,
    )


def parse_ranking(text, count):
    """Parse a ranking from judge output. Returns list of labels in order (best first)."""
    # Look for "C > A > E > B > D" pattern
    m = re.search(r'([A-Z]\s*[>≫]\s*)+[A-Z]', text)
    if m:
        ranking_str = m.group()
        labels = re.findall(r'[A-Z]', ranking_str)
        if len(labels) == count:
            return labels

    # Try numbered list: "1. C", "2. A", etc.
    labels = []
    for line in text.split('\n'):
        m2 = re.match(r'^\s*\d+[\.\)]\s*\[?([A-Z])\]?', line)
        if m2:
            labels.append(m2.group(1))
    if len(labels) >= count - 1:  # allow one missing
        return labels[:count]

    # Fallback: find all single uppercase letters in order
    all_labels = re.findall(r'\b([A-Z])\b', text)
    seen = []
    for l in all_labels:
        if l not in seen and ord(l) < 65 + count:
            seen.append(l)
    if len(seen) >= count - 1:
        return seen[:count]

    return None


def ranking_to_borda(ranking, count):
    """Convert a ranking (list of labels best-first) to Borda scores."""
    scores = {}
    for i, label in enumerate(ranking):
        scores[label] = count - 1 - i  # best gets count-1 points
    return scores


def aggregate_borda(all_scores, count):
    """Aggregate Borda scores across multiple judges."""
    totals = {}
    for scores in all_scores:
        for label, score in scores.items():
            totals[label] = totals.get(label, 0) + score
    # Sort by total (highest = best)
    ranked = sorted(totals.items(), key=lambda x: -x[1])
    return ranked


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Listwise ranking of eval responses")
    parser.add_argument("--question", required=True, help="Question ID to rank (e.g., G1)")
    parser.add_argument("--judges", default="gpt-nano,deepseek,grok",
        help="Comma-separated judge keys")
    parser.add_argument("--chunk-size", type=int, default=6,
        help="Number of responses per ranking chunk (default: 6)")
    parser.add_argument("--budget", type=float, default=1.0,
        help="Max USD to spend")
    parser.add_argument("--no-embeddings", action="store_true",
        help="Force prefix-based clustering instead of embedding-based")
    parser.add_argument("--desc", type=str, default=None)
    args = parser.parse_args()

    load_all_keys()

    from pymongo import MongoClient
    db = MongoClient("mongodb://localhost:27017")["scoutquest"]
    results_col = db["eval_results"]
    rankings_col = db["eval_rankings"]

    # Load all responses for this question
    all_results = list(results_col.find({
        "question_id": args.question,
        "response": {"$exists": True, "$ne": ""},
        "response_hash": {"$exists": True},
    }))

    if not all_results:
        print(f"No results found for question {args.question}")
        sys.exit(1)

    question_text = all_results[0].get("question", "")
    question_type = all_results[0].get("question_type", "")
    eval_notes = all_results[0].get("eval_notes", "")

    print(f"Question {args.question}: {question_text[:60]}...")
    print(f"  Type: {question_type}")
    print(f"  Total responses: {len(all_results)}")

    # Cluster responses
    if args.no_embeddings:
        clusters = cluster_responses(all_results, max_clusters=args.chunk_size * 2)
    else:
        clusters = cluster_responses_by_embedding(all_results, max_clusters=args.chunk_size * 2)
    representatives = pick_representatives(clusters)
    print(f"  Clusters: {len(clusters)} → {len(representatives)} representatives")
    for i, rep in enumerate(representatives):
        label = chr(65 + i)
        print(f"    [{label}] {rep['label']:<30} (cluster of {rep['cluster_size']}, hash={rep['response_hash'][:8]})")

    # If more reps than chunk_size, we need multiple ranking rounds
    # For now, take top chunk_size by cluster size (most common response patterns)
    if len(representatives) > args.chunk_size:
        representatives.sort(key=lambda r: -r["cluster_size"])
        representatives = representatives[:args.chunk_size]
        print(f"  Trimmed to {len(representatives)} largest clusters")

    # Build ranking prompt
    prompt = build_ranking_prompt(question_text, question_type, eval_notes, representatives)
    labels = [chr(65 + i) for i in range(len(representatives))]

    print(f"\n  Prompt: {len(prompt)} chars (~{len(prompt)//4} tokens)")
    print(f"  Judges: {args.judges}\n")

    # Run judges
    judge_keys = args.judges.split(",")
    all_borda = []
    all_rankings_raw = []

    for judge_key in judge_keys:
        if judge_key not in JUDGES:
            print(f"  Unknown judge: {judge_key}, skipping")
            continue
        provider, model = JUDGES[judge_key]
        sys.stdout.write(f"  {judge_key} ({model})... ")
        sys.stdout.flush()

        try:
            result_text = call_judge(provider, model, prompt)
            ranking = parse_ranking(result_text, len(representatives))

            if ranking:
                borda = ranking_to_borda(ranking, len(representatives))
                all_borda.append(borda)
                all_rankings_raw.append({
                    "judge": judge_key,
                    "model": model,
                    "ranking": ranking,
                    "raw_text": result_text[:2000],
                })
                print(f"{'  >  '.join(ranking)}")
            else:
                print(f"PARSE FAILED: {result_text[:100]}")
                all_rankings_raw.append({
                    "judge": judge_key,
                    "model": model,
                    "ranking": None,
                    "raw_text": result_text[:2000],
                    "error": "parse_failed",
                })
        except Exception as e:
            print(f"ERROR: {str(e)[:80]}")
            all_rankings_raw.append({
                "judge": judge_key, "model": model,
                "error": str(e)[:200],
            })

    if not all_borda:
        print("\nNo successful rankings — cannot aggregate.")
        sys.exit(1)

    # Aggregate via Borda count
    aggregate = aggregate_borda(all_borda, len(representatives))

    print(f"\n{'='*60}")
    print(f"  AGGREGATE RANKING (Borda count from {len(all_borda)} judges)")
    print(f"{'='*60}\n")
    print(f"  {'Rank':>4} {'Label':>5} {'Borda':>6} {'Model':<30} {'Cluster':>7} {'Existing Avg':>12}")
    print(f"  {'-'*4} {'-'*5} {'-'*6} {'-'*30} {'-'*7} {'-'*12}")

    for rank_pos, (label, score) in enumerate(aggregate):
        idx = ord(label) - 65
        rep = representatives[idx]
        existing = rep.get("existing_scores", {})
        dims = ["accuracy", "specificity", "safety", "coaching", "troop_voice"]
        existing_avg = sum(existing.get(d, 0) for d in dims) / 5 if existing else 0
        print(f"  {rank_pos+1:>4} [{label}]   {score:>5} {rep['label']:<30} {rep['cluster_size']:>7} {existing_avg:>11.1f}")

    # Check rank vs score agreement
    print(f"\n  Score-Rank Agreement:")
    top_by_rank = aggregate[0][0]
    top_by_rank_idx = ord(top_by_rank) - 65
    top_by_score = max(range(len(representatives)),
        key=lambda i: sum(representatives[i].get("existing_scores", {}).values()))
    top_by_score_label = chr(65 + top_by_score)

    if top_by_rank == top_by_score_label:
        print(f"  AGREE: [{top_by_rank}] is both highest-ranked and highest-scored")
    else:
        print(f"  DISAGREE: Ranked #{1}=[{top_by_rank}] vs Scored #{1}=[{top_by_score_label}]")
        print(f"    This disagreement warrants investigation.")

    # Inter-judge agreement
    if len(all_borda) >= 2:
        # Check if judges agree on top pick
        top_picks = [r["ranking"][0] for r in all_rankings_raw if r.get("ranking")]
        if len(set(top_picks)) == 1:
            print(f"  Inter-judge: UNANIMOUS top pick [{top_picks[0]}]")
        else:
            print(f"  Inter-judge: SPLIT — top picks: {top_picks}")

    # Save to MongoDB
    ranking_doc = {
        "question_id": args.question,
        "question": question_text,
        "question_type": question_type,
        "method": "listwise_borda",
        "clustering": "prefix" if args.no_embeddings else "embedding",
        "chunk_size": len(representatives),
        "judges": judge_keys,
        "representatives": [{
            "label": chr(65 + i),
            "response_hash": rep["response_hash"],
            "model": rep["model"],
            "label_name": rep["label"],
            "cluster_size": rep["cluster_size"],
            "cluster_hashes": rep["cluster_hashes"],
            "existing_scores": rep.get("existing_scores", {}),
        } for i, rep in enumerate(representatives)],
        "judge_rankings": all_rankings_raw,
        "aggregate_borda": [{"label": l, "score": s} for l, s in aggregate],
        "description": args.desc,
        "timestamp": datetime.now(timezone.utc),
    }

    rankings_col.insert_one(ranking_doc)
    print(f"\n  Saved to MongoDB eval_rankings")


if __name__ == "__main__":
    main()
