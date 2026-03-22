#!/usr/bin/env python3
"""Re-score existing eval responses with the current panel evaluator.

Skips model calls entirely — reads responses from MongoDB, runs them through
the panel evaluator (assessors + scorer), and updates the scores in-place.

Usage:
  # Re-score a specific run
  python3 rescore-eval.py --run-id 2026-03-22_01-25-18 --budget 5.00

  # Re-score all runs from today
  python3 rescore-eval.py --since 2026-03-22 --budget 10.00

  # Re-score only a specific perspective
  python3 rescore-eval.py --run-id 2026-03-22_01-25-18 --perspective knowledge

  # Dry run — show what would be re-scored
  python3 rescore-eval.py --run-id 2026-03-22_01-25-18 --dry-run
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from eval_framework import load_eval_set_yaml
from eval_panel import PanelEvaluator, UsageTracker, BudgetExceeded

# Key loading
LIBRECHAT_ENV = Path("/home/devuser/LibreChat/.env")
PROJECT_ROOT = Path(__file__).parent.parent
EVAL_SET_DIR = PROJECT_ROOT / "eval-sets"


def load_dotenv_key(name):
    if not LIBRECHAT_ENV.exists():
        return None
    for line in LIBRECHAT_ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return None


def get_key(env_var, dotenv_name=None):
    val = os.environ.get(env_var)
    if val:
        return val
    if dotenv_name:
        val = load_dotenv_key(dotenv_name)
        if val:
            os.environ[env_var] = val
            return val
    return ""


def main():
    parser = argparse.ArgumentParser(description="Re-score eval responses with fixed panel")
    parser.add_argument("--run-id", type=str, help="Specific run ID to re-score")
    parser.add_argument("--since", type=str, help="Re-score all runs since date (YYYY-MM-DD)")
    parser.add_argument("--perspective", type=str, default=None, help="Filter by perspective")
    parser.add_argument("--eval-set", type=str, default=None, help="Eval set YAML (auto-detected from perspective)")
    parser.add_argument("--budget", type=float, default=5.0, help="Max USD to spend")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be re-scored")
    parser.add_argument("--mongo-uri", default="mongodb://localhost:27017", help="MongoDB URI")
    args = parser.parse_args()

    # Load API keys
    get_key("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
    get_key("OPENAI_API_KEY", "OPENAI_API_KEY")
    get_key("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY")
    get_key("OPENROUTER_KEY", "OPENROUTER_KEY")

    from pymongo import MongoClient
    client = MongoClient(args.mongo_uri, serverSelectionTimeoutMS=5000)
    db = client["scoutquest"]
    col = db["eval_results"]

    # Build query
    query = {"response": {"$exists": True, "$ne": ""}}
    if args.run_id:
        query["run_id"] = args.run_id
    elif args.since:
        query["run_id"] = {"$gte": args.since}
    else:
        print("Must specify --run-id or --since")
        return

    if args.perspective:
        query["perspective"] = args.perspective

    docs = list(col.find(query).sort("run_id", 1))
    print(f"Found {len(docs)} responses to re-score")

    if not docs:
        return

    # Group by perspective to use the right eval set
    by_perspective = {}
    for doc in docs:
        p = doc.get("perspective", "knowledge")
        by_perspective.setdefault(p, []).append(doc)

    for p, count in by_perspective.items():
        print(f"  {p}: {len(count)} responses")

    if args.dry_run:
        print("\nDry run — no changes made.")
        # Show sample
        for doc in docs[:3]:
            print(f"  {doc.get('run_id')} / {doc.get('config_id', doc.get('model'))} / {doc.get('question_id')}")
        if len(docs) > 3:
            print(f"  ... and {len(docs) - 3} more")
        return

    # Initialize usage tracker
    usage_col = db["eval_usage"]
    usage = UsageTracker(run_id=f"rescore-{time.strftime('%Y%m%d-%H%M%S')}", budget=args.budget, db_collection=usage_col)

    # Load troop context
    troop_path = PROJECT_ROOT / "backend" / "knowledge" / "troop-context.md"
    troop_context = troop_path.read_text() if troop_path.exists() else ""

    print(f"\nBudget: ${args.budget:.2f}")
    print(f"Starting re-score...\n")

    rescored = 0
    errors = 0

    for perspective, p_docs in by_perspective.items():
        # Load the right eval set for this perspective
        if args.eval_set:
            eval_set_path = args.eval_set
        elif perspective == "chain":
            eval_set_path = str(EVAL_SET_DIR / "chain-eval-v1.yaml")
        else:
            eval_set_path = str(EVAL_SET_DIR / "scout-coach-v5.yaml")

        eval_set = load_eval_set_yaml(eval_set_path)
        panel = PanelEvaluator(eval_set, usage, troop_context)
        dim_names = [d.name for d in eval_set.dimensions]

        print(f"=== {perspective} ({len(p_docs)} responses, {len(dim_names)} dimensions) ===\n")

        for doc in p_docs:
            qid = doc.get("question_id", "?")
            config = doc.get("config_id", doc.get("model", "?"))
            response = doc["response"]
            question = doc.get("question", "")
            expected = doc.get("expected", "")
            eval_notes = doc.get("eval_notes", "")

            sys.stdout.write(f"  {config}/{qid}: ")
            sys.stdout.flush()

            try:
                # Build content and context for panel
                if perspective == "chain":
                    content = response
                    context = f"CHAIN/SCENARIO: {qid}\nDESCRIPTION: {question}"
                else:
                    content = response
                    context = f"QUESTION: {question}\n\nEXPECTED: {expected}"

                scores = panel.evaluate(content, context, eval_notes)

                # Extract dimension scores
                score_vals = {d: scores.get(d, 0) for d in dim_names}
                overall = panel.compute_overall(score_vals)
                notes = scores.get("notes", "")
                assessments = scores.get("_assessments", {})

                # Update in MongoDB
                col.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {
                        "scores": score_vals,
                        "scores_notes": notes,
                        "scores_assessments": assessments,
                        "overall_score": overall,
                        "evaluator": "panel-v2",  # Mark as re-scored
                    }}
                )

                dims_str = " ".join(f"{d[:4]}:{score_vals.get(d, 0)}" for d in dim_names[:4])
                cost_str = f" [${usage.totals['cost']:.2f}]"
                print(f"avg={overall:.1f} [{dims_str}]{cost_str}")
                rescored += 1

            except BudgetExceeded as e:
                print(f"\nBUDGET EXCEEDED: {e}")
                print(f"Re-scored {rescored}/{len(docs)} before stopping.")
                usage.summary()
                return

            except Exception as e:
                print(f"ERROR: {str(e)[:80]}")
                errors += 1

    print(f"\n{'='*60}")
    print(f"Re-scored: {rescored}/{len(docs)}")
    if errors:
        print(f"Errors: {errors}")
    usage.summary()


if __name__ == "__main__":
    main()
