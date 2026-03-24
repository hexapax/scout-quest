#!/usr/bin/env python3
"""Unified evaluation runner — multi-perspective, multi-axis.

Supports multiple evaluation perspectives (knowledge, chain, safety, etc.)
with configurable model/knowledge/layer/parameter axes.

Usage:
  # Knowledge perspective (default — same as run-model-eval.py)
  python3 run-eval.py --config claude --sample 2 --budget 5.00

  # Chain perspective
  python3 run-eval.py --perspective chain --chain chore-streak --config claude --budget 5.00

  # Ablation sweep
  python3 run-eval.py --config layer-L0,layer-L1,layer-L2,layer-L3 --sample 2 --budget 10.00

  # Override config axes
  python3 run-eval.py --config claude --layer persona-only --knowledge none

  # Per-step chain evaluation
  python3 run-eval.py --perspective chain --chain chore-streak --config claude --per-step
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure scripts/ is on path
sys.path.insert(0, str(Path(__file__).parent))

from eval_framework import (
    PerspectiveRegistry, load_run_configs, load_eval_set_yaml,
    ScoredResult, EvalSetConfig, compute_version_fingerprint,
    diff_version_fingerprints,
)
from eval_panel import PanelEvaluator, UsageTracker, BudgetExceeded

# Import perspectives (auto-registers via PerspectiveRegistry)
import perspectives  # noqa: F401

# ---------------------------------------------------------------------------
# Key loading (reused from run-model-eval.py)
# ---------------------------------------------------------------------------

LIBRECHAT_ENV = Path("/home/devuser/LibreChat/.env")
PROJECT_ROOT = Path(__file__).parent.parent
CONFIGS_YAML = PROJECT_ROOT / "eval-sets" / "configs.yaml"
REPORT_DIR = PROJECT_ROOT / "mcp-servers" / "scout-quest" / "test" / "reports" / "model-comparison"


def load_dotenv_key(name):
    if not LIBRECHAT_ENV.exists():
        return None
    for line in LIBRECHAT_ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return None


def load_secret(name):
    try:
        import subprocess
        result = subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest",
             "--secret", name, "--project", "hexapax-devbox"],
            capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def get_key(env_var, dotenv_name=None, secret_name=None):
    val = os.environ.get(env_var)
    if val:
        return val
    if dotenv_name:
        val = load_dotenv_key(dotenv_name)
        if val:
            os.environ[env_var] = val
            return val
    if secret_name:
        val = load_secret(secret_name)
        if val:
            os.environ[env_var] = val
            return val
    return ""


def load_all_keys():
    keys = {
        "ANTHROPIC_API_KEY": get_key("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "anthropic-api-key"),
        "OPENAI_API_KEY": get_key("OPENAI_API_KEY", "OPENAI_API_KEY", "openai-api-key"),
        "GOOGLE_KEY": get_key("GOOGLE_KEY", "GOOGLE_KEY", None),
        "DEEPSEEK_API_KEY": get_key("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY", "deepseek-api-key"),
        "OPENROUTER_KEY": get_key("OPENROUTER_KEY", "OPENROUTER_KEY", "openrouter-api-key"),
        "XAI_API_KEY": get_key("XAI_API_KEY", "XAI_API_KEY", "xai-api-key"),
    }
    print("API Keys:")
    for name, val in keys.items():
        status = f"OK ({len(val)} chars)" if val else "MISSING"
        print(f"  {name}: {status}")
    print()
    return keys


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Unified multi-perspective evaluation runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Knowledge eval (default)
  python3 run-eval.py --config claude --sample 2 --budget 5.00

  # Chain eval
  python3 run-eval.py --perspective chain --chain chore-streak --config claude --budget 5.00

  # Ablation sweep
  python3 run-eval.py --config layer-L0,layer-L1,layer-L2 --sample 2 --budget 10.00

  # List available configs/perspectives
  python3 run-eval.py --list
""",
    )

    # Core args
    parser.add_argument("--spectre", "--perspective", default="knowledge",
        dest="perspective",
        choices=PerspectiveRegistry.available(),
        help=f"Evaluation spectre ({', '.join(PerspectiveRegistry.available())})")
    parser.add_argument("--config", default="claude",
        help="Comma-separated config names from configs.yaml, or 'all'")
    parser.add_argument("--budget", type=float, default=None,
        help="Maximum USD to spend (e.g., --budget 5.00)")
    parser.add_argument("--desc", type=str, default=None,
        help="Description of this eval run (shown in viewer)")

    # Item filtering
    parser.add_argument("--category", default="all",
        help="Category filter (e.g., A,B,C) or 'all'")
    parser.add_argument("--sample", type=int, default=None,
        help="Sample N items per category")
    parser.add_argument("--questions", type=str, default=None,
        help="Specific question IDs (knowledge perspective)")

    # Chain-specific
    parser.add_argument("--chain", type=str, default=None,
        help="Chain ID(s) to run (chain perspective)")
    parser.add_argument("--scenario", type=str, default=None,
        help="Scenario ID(s) to run (chain perspective)")
    parser.add_argument("--per-step", action="store_true",
        help="Evaluate each chain step individually (chain perspective)")
    parser.add_argument("--mongo-uri", type=str, default="",
        help="MongoDB URI for chain harness")

    # Rescore mode — re-evaluate existing responses without re-running models
    parser.add_argument("--rescore", type=str, default=None,
        help="Re-score existing run (run_id or 'since:YYYY-MM-DD'). Skips model calls.")
    parser.add_argument("--rescore-all-today", action="store_true",
        help="Re-score all runs from today")

    # Config overrides (applied on top of configs.yaml)
    parser.add_argument("--layer", type=str, default=None,
        help="Override layer config (persona-only, knowledge-only, full, etc.)")
    parser.add_argument("--knowledge", type=str, default=None,
        help="Override knowledge config (full, compact, none)")
    parser.add_argument("--knowledge-doc", type=str, default=None,
        help="Override knowledge document path")
    parser.add_argument("--adaptive-effort", type=str, default=None,
        help="Override adaptive effort (low, medium, high)")

    # Eval set
    parser.add_argument("--eval-set", type=str, default=None,
        help="YAML eval set file (default: perspective's default)")
    parser.add_argument("--eval-version", type=str, default="5",
        help="Eval system version")
    parser.add_argument("--system-version", type=str, default="5",
        help="System under test version")

    # Utility
    parser.add_argument("--list", action="store_true",
        help="List available perspectives and configs, then exit")

    args = parser.parse_args()

    # List mode
    if args.list:
        print("Perspectives:")
        for name in PerspectiveRegistry.available():
            p = PerspectiveRegistry.get(name)
            print(f"  {name}: {p.description}")

        print(f"\nConfigs (from {CONFIGS_YAML}):")
        from eval_framework import load_configs_yaml
        configs = load_configs_yaml(str(CONFIGS_YAML))
        for name, cfg in configs.items():
            if cfg.get("model_id"):
                label = cfg.get("label", name)
                print(f"  {name}: {label} (model={cfg['model_id']}, layer={cfg.get('layer', 'full')})")
        return

    # Load API keys
    keys = load_all_keys()

    # Resolve perspective
    perspective = PerspectiveRegistry.get(args.perspective)
    print(f"Perspective: {perspective.name} — {perspective.description}")

    # Load eval set
    eval_set_path = args.eval_set or perspective.default_eval_set
    eval_set = perspective.load_eval_set(eval_set_path)
    print(f"Eval set: {eval_set.name} v{eval_set.version} ({len(eval_set.dimensions)} dimensions)")

    # Load run configs
    overrides = {
        "layer": args.layer,
        "knowledge": args.knowledge,
        "knowledge_doc": args.knowledge_doc,
        "adaptive_effort": args.adaptive_effort,
    }
    configs = load_run_configs(args.config, str(CONFIGS_YAML), overrides)
    print(f"Configs: {', '.join(c.label for c in configs)}")

    # Resolve items
    filters = {
        "category": args.category,
        "sample": args.sample,
        "questions": args.questions,
        "chain": args.chain,
        "scenario": args.scenario,
    }
    items = perspective.resolve_items(eval_set, filters)
    print(f"Items: {len(items)}")

    if not items:
        print("No items to evaluate. Check filters.")
        return

    # Initialize timestamp and output directory
    timestamp = time.strftime("%Y-%m-%d_%H-%M-%S", time.gmtime())
    run_dir = REPORT_DIR / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    # Initialize MongoDB
    db_collection = None
    eval_results_col = None
    try:
        from pymongo import MongoClient
        mongo_uri = args.mongo_uri or os.environ.get("MONGO_URI", "mongodb://localhost:27017")
        mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        mongo_client.server_info()
        db = mongo_client["scoutquest"]
        db_collection = db["eval_usage"]
        eval_results_col = db["eval_results"]
        # Ensure indexes
        eval_results_col.create_index([("perspective", 1), ("run_id", 1)])
        eval_results_col.create_index("model_id")
        eval_results_col.create_index("layer")
        eval_results_col.create_index("config_id")
        eval_results_col.create_index("question_id")
        eval_results_col.create_index("response_hash")
        print(f"MongoDB: connected")
    except Exception as e:
        print(f"MongoDB: not available ({e})")

    # Initialize usage tracker
    usage = UsageTracker(run_id=timestamp, budget=args.budget, db_collection=db_collection)

    if args.budget:
        print(f"Budget: ${args.budget:.2f}")

    # Initialize panel evaluator
    from perspectives.knowledge import get_troop_context
    troop_context = get_troop_context()
    panel = PanelEvaluator(eval_set, usage, troop_context)

    # Compute version fingerprint
    versions = compute_version_fingerprint(PROJECT_ROOT, eval_set)
    print(f"Version: SYS={versions['system_fingerprint']} EVL={versions['eval_fingerprint']} git={versions['git_head']}")

    # Warn on uncommitted changes
    dirty = versions.get("git_dirty", [])
    if dirty:
        print(f"\n  WARNING: Uncommitted changes to versioned files:")
        for f in dirty:
            print(f"    - {f}")
        print(f"  Results may not be reproducible. Commit before eval for full traceability.\n")

    # ---------------------------------------------------------------------------
    # Rescore mode — re-evaluate existing responses, skip model calls
    # ---------------------------------------------------------------------------
    if args.rescore or args.rescore_all_today:
        if eval_results_col is None:
            print("ERROR: MongoDB required for rescore mode.")
            return

        query = {}
        if args.rescore_all_today:
            today = time.strftime("%Y-%m-%d", time.gmtime())
            query["run_id"] = {"$gte": today}
            print(f"Re-scoring all runs since {today}")
        elif args.rescore.startswith("since:"):
            since = args.rescore.split(":", 1)[1]
            query["run_id"] = {"$gte": since}
            print(f"Re-scoring all runs since {since}")
        else:
            query["run_id"] = args.rescore
            print(f"Re-scoring run: {args.rescore}")

        if args.perspective != "knowledge":
            query["perspective"] = args.perspective

        dim_names = [d.name for d in eval_set.dimensions]

        def on_progress(i, total, doc, scores, error=None):
            qid = doc.get("question_id", "?")
            config = doc.get("config_id", doc.get("model", "?"))
            if error:
                print(f"  [{i+1}/{total}] {config}/{qid}: ERROR {error[:60]}")
            else:
                dims_str = " ".join(f"{d[:4]}:{scores.get(d, 0)}" for d in dim_names[:4])
                overall = panel.compute_overall(scores)
                cost_str = f" [${usage.totals['cost']:.2f}]"
                print(f"  [{i+1}/{total}] {config}/{qid}: avg={overall:.1f} [{dims_str}]{cost_str}")

        try:
            stats = panel.rescore(eval_results_col, query, on_progress=on_progress)
        except BudgetExceeded as e:
            print(f"\nBUDGET EXCEEDED: {e}")
            stats = {"rescored": "partial", "errors": "?", "skipped": "?"}

        print(f"\nRescore complete: {stats}")
        usage.summary()
        return

    # ---------------------------------------------------------------------------
    # Normal eval mode
    # ---------------------------------------------------------------------------

    # Write run metadata
    meta = {
        "perspective": args.perspective,
        "spectre": args.perspective,
        "description": args.desc,
        "dimensions": [d.name for d in eval_set.dimensions],
        "evalVersion": args.eval_version,
        "systemVersion": args.system_version,
        "evaluator": "panel",
        "configs": [c.config_id for c in configs],
        "versions": versions,
        "categories": args.category,
        "itemCount": len(items),
        "budget": args.budget,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "running",
    }
    with open(run_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Output: {run_dir}")
    print(f"\n{'='*60}\n")

    # ---------------------------------------------------------------------------
    # Main evaluation loop
    # ---------------------------------------------------------------------------

    all_results: dict[str, list] = {}
    budget_stopped = False

    try:
        for config in configs:
            config_key = config.config_id
            print(f"{'='*60}")
            print(f"  {config.label} ({config_key})")
            print(f"  model={config.model_id} layer={config.layer} knowledge={config.knowledge}")
            if config.adaptive_effort:
                print(f"  adaptive_effort={config.adaptive_effort}")
            if usage.budget:
                remaining = usage.budget - usage.totals["cost"]
                print(f"  Budget remaining: ${remaining:.2f}")
            print(f"{'='*60}\n")

            results = []
            consecutive_errors = 0

            # Chain state management: chain items share a TestState
            chain_states: dict = {}  # chain_id -> TestState

            for item in items:
                sys.stdout.write(f"  {item.id}: {item.description[:50]}... ")
                sys.stdout.flush()

                try:
                    # For chain steps, create/reuse shared state
                    chain_id = item.metadata.get("chain_id") if item.metadata else None
                    shared_state = None
                    if chain_id:
                        if chain_id not in chain_states:
                            from eval_tools import TestState
                            chain_test_id = f"chain_{chain_id}_{int(time.time())}"
                            chain_states[chain_id] = TestState(test_id=chain_test_id)
                            chain_fixtures = item.metadata.get("chain_fixtures")
                            chain_states[chain_id].seed(chain_fixtures)
                        shared_state = chain_states[chain_id]

                    # Execute
                    execution = perspective.execute(
                        item, config, usage=usage,
                        mongo_uri=args.mongo_uri,
                        shared_state=shared_state,
                    )

                    if execution.error:
                        raise Exception(execution.error)

                    # Evaluate with panel
                    if args.per_step and args.perspective == "chain":
                        # Per-step evaluation for chains
                        chain_persp = PerspectiveRegistry.get("chain")
                        step_scores = chain_persp.evaluate_per_step(execution, panel)
                        for ss in step_scores:
                            dim_names = [d.name for d in eval_set.dimensions]
                            avg = sum(ss.scores.get(d, 0) for d in dim_names) / max(len(dim_names), 1)
                            print(f"\n    step {ss.execution.item.id}: avg={avg:.1f}")

                            if eval_results_col is not None:
                                doc = chain_persp.to_mongo_doc(
                                    ss, timestamp, args.eval_version, args.system_version)
                                doc["question_id"] = f"{item.id}/{ss.execution.item.id}"
                                doc["versions"] = versions
                                try:
                                    eval_results_col.insert_one(doc)
                                except Exception:
                                    pass
                        # Also score overall
                        content, context = perspective.format_for_evaluation(execution)
                        scores = panel.evaluate(content, context, item.eval_notes)
                    else:
                        content, context = perspective.format_for_evaluation(execution)
                        scores = panel.evaluate(content, context, item.eval_notes)

                    # Build ScoredResult
                    dim_names = [d.name for d in eval_set.dimensions]
                    # Keep None for N/A dimensions (don't default to 0)
                    score_vals = {d: scores.get(d) for d in dim_names}
                    overall = panel.compute_overall(score_vals)

                    # Phase 3: Rebuttal — let the model defend itself
                    rebuttal_data = panel.rebuttal(
                        content, context, scores,
                        model_id=config.model_id, provider=config.provider,
                        usage=usage,
                    )

                    # Apply adjustments if judge agreed
                    adjusted_scores = dict(score_vals)
                    if rebuttal_data.get("adjustments"):
                        for dim, adj in rebuttal_data["adjustments"].items():
                            if dim in adjusted_scores and adjusted_scores[dim] is not None:
                                adjusted_scores[dim] = min(10, adjusted_scores[dim] + adj)
                        overall = panel.compute_overall(adjusted_scores)

                    scored = ScoredResult(
                        execution=execution,
                        scores=adjusted_scores,
                        scores_notes=scores.get("notes", ""),
                        assessments=scores.get("_assessments", {}),
                        overall_score=overall,
                    )

                    # Print summary
                    rebuttal_tag = ""
                    if rebuttal_data.get("rebuttal_type") == "legitimate":
                        adj_str = ", ".join(f"{d}+{v}" for d, v in rebuttal_data["adjustments"].items())
                        rebuttal_tag = f" [REBUTTAL: {adj_str}]"
                    elif rebuttal_data.get("rebuttal_type") == "excuses":
                        rebuttal_tag = " [rebuttal: excuses]"
                    elif rebuttal_data.get("rebuttal_type") == "mixed":
                        adj_str = ", ".join(f"{d}+{v}" for d, v in rebuttal_data["adjustments"].items())
                        rebuttal_tag = f" [rebuttal: mixed {adj_str}]"
                    dims_str = " ".join(f"{d[:3].upper()}:{adjusted_scores[d]}" for d in dim_names[:4] if adjusted_scores.get(d) is not None)
                    cost_str = f" [${usage.totals['cost']:.2f}]" if usage.budget else ""
                    print(f"avg={overall:.1f} [{dims_str}]{rebuttal_tag}{cost_str}")

                    # Store in MongoDB
                    if eval_results_col is not None:
                        doc = perspective.to_mongo_doc(
                            scored, timestamp, args.eval_version, args.system_version)
                        doc["versions"] = versions
                        doc["rebuttal"] = rebuttal_data
                        doc["original_scores"] = dict(score_vals) if rebuttal_data.get("adjustments") else None
                        try:
                            eval_results_col.insert_one(doc)
                        except Exception:
                            pass

                    # Build viewer-compatible result entry
                    result_entry = {
                        # Viewer-expected fields (backward compat)
                        "model": config_key,
                        "label": config.label,
                        "price": config.price,
                        "questionId": item.id,
                        "category": item.category,
                        "question": item.description,
                        "expected": item.expected,
                        "response": execution.response_text,
                        "scores": {**adjusted_scores, "notes": scores.get("notes", ""),
                                   "_assessments": scores.get("_assessments", {})},
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        # New fields
                        "config_id": config_key,
                        "perspective": args.perspective,
                        "overall": overall,
                        "rebuttal": rebuttal_data,
                        "original_scores": dict(score_vals) if rebuttal_data.get("adjustments") else None,
                        "timing_ms": execution.timing_ms,
                        "turn_count": execution.raw_data.get("turn_count", 1),
                        "turn_timings": execution.raw_data.get("turn_timings"),
                    }
                    results.append(result_entry)
                    consecutive_errors = 0

                except BudgetExceeded as e:
                    print(f"\n  BUDGET EXCEEDED: {e}")
                    budget_stopped = True
                    raise

                except Exception as e:
                    consecutive_errors += 1
                    print(f"ERROR: {str(e)[:100]}")
                    results.append({
                        "model": config_key,
                        "label": config.label,
                        "questionId": item.id,
                        "category": item.category,
                        "question": item.description,
                        "error": str(e)[:200],
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    })

                    if eval_results_col is not None:
                        try:
                            eval_results_col.insert_one({
                                "perspective": args.perspective,
                                "run_id": timestamp,
                                "eval_version": args.eval_version,
                                **config.to_mongo_fields(),
                                "question_id": item.id,
                                "category": item.category,
                                "error": str(e)[:500],
                                "versions": versions,
                                "timestamp": datetime.now(timezone.utc),
                            })
                        except Exception:
                            pass

                    if consecutive_errors >= 2:
                        print(f"\n  FAIL-FAST: 2 consecutive errors for {config.label}, skipping remaining.")
                        break

            # Cleanup chain states
            for cs in chain_states.values():
                try:
                    cs.cleanup()
                except Exception:
                    pass

            all_results[config_key] = results

            # Per-config summary
            scored_results = [r for r in results if "scores" in r]
            errors = [r for r in results if "error" in r]
            print()
            if scored_results:
                print(f"  Scored: {len(scored_results)}/{len(results)}", end="")
                if errors:
                    print(f"  Errors: {len(errors)}", end="")
                print()
                for d in [dim.name for dim in eval_set.dimensions]:
                    vals = [r["scores"].get(d) for r in scored_results if r["scores"].get(d) is not None]
                    if vals:
                        avg = sum(vals) / len(vals)
                        print(f"  {d}: {avg:.1f} ({len(vals)}/{len(scored_results)} scored)")

            # Save incrementally
            with open(run_dir / "results.json", "w") as f:
                json.dump(all_results, f, indent=2)

    except BudgetExceeded:
        if results:
            all_results[config_key] = results
        with open(run_dir / "results.json", "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"\n  Run stopped. Partial results saved.")

    # ---------------------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------------------

    print(f"\n{'='*80}")
    print(f"  CONFIG COMPARISON ({args.perspective} perspective)")
    print(f"{'='*80}\n")

    dim_names = [d.name for d in eval_set.dimensions]
    header = f"  {'Config':<35}"
    for d in dim_names:
        header += f" {d[:8]:>8}"
    header += f" {'Avg':>6}"
    print(header)
    print(f"  {'-'*35}" + f" {'-'*8}" * len(dim_names) + f" {'-'*6}")

    for config in configs:
        results = all_results.get(config.config_id, [])
        scored_results = [r for r in results if "scores" in r]
        if not scored_results:
            print(f"  {config.label:<35} — no scored results —")
            continue
        avgs = {}
        for d in dim_names:
            vals = [r["scores"].get(d) for r in scored_results if r["scores"].get(d) is not None]
            avgs[d] = sum(vals) / len(vals) if vals else None
        scored_avgs = {k: v for k, v in avgs.items() if v is not None}
        overall = sum(scored_avgs.values()) / len(scored_avgs) if scored_avgs else 0
        row = f"  {config.label:<35}"
        for d in dim_names:
            v = avgs[d]
            row += f" {v:>8.1f}" if v is not None else f" {'—':>8}"
        row += f" {overall:>6.1f}"
        print(row)

    # Save final results and metadata
    with open(run_dir / "results.json", "w") as f:
        json.dump(all_results, f, indent=2)

    meta["status"] = "budget_stopped" if budget_stopped else "complete"
    meta["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["totalCost"] = usage.totals["cost"]
    meta["configsCompleted"] = list(all_results.keys())
    with open(run_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    with open(run_dir / "usage.json", "w") as f:
        json.dump(usage.to_dict(), f, indent=2)

    usage.summary()
    print(f"\nResults saved to {run_dir}")


if __name__ == "__main__":
    main()
