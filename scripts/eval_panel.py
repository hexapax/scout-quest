"""Shared panel evaluator — multi-model assessment for any perspective.

The panel evaluator is perspective-agnostic. It receives:
- Assessor configs (role, model, provider, prompt) from the eval set YAML
- Dimension configs (name, weight, description) from the eval set YAML
- Scorer prompt from the eval set YAML
- Content + context from the perspective's format_for_evaluation()

Adding a new perspective with different scoring dimensions and different
assessor prompts requires ZERO changes to this module — just a new YAML
eval set.

Extracted from run-model-eval.py _eval_panel(), _call_cheap(), and the
assessor prompt system.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from eval_framework import EvalSetConfig, AssessorConfig

# ---------------------------------------------------------------------------
# Pricing per million tokens (input, output, cached_input)
# Shared across panel evaluator and perspectives
# ---------------------------------------------------------------------------

PRICING = {
    "claude-sonnet-4-6":              (3.00, 15.00, 0.30),
    "claude-opus-4-6":                (5.00, 25.00, 0.50),
    "gpt-4.1":                        (2.00,  8.00, 0.50),
    "gpt-4.1-mini":                   (0.40,  1.60, 0.10),
    "gpt-4.1-nano":                   (0.10,  0.40, 0.025),
    "gpt-5.4":                        (2.50, 15.00, 0.625),
    "gpt-5.4-mini":                   (0.75,  4.50, 0.1875),
    "gpt-5.4-nano":                   (0.20,  1.25, 0.05),
    "gemini-2.5-flash":               (0.15,  0.60, 0.0375),
    "gemini-2.5-flash-lite":          (0.10,  0.40, 0.025),
    "gemini-3-flash-preview":         (0.50,  3.00, 0.125),
    "gemini-3.1-flash-lite-preview":  (0.25,  1.50, 0.0625),
    "deepseek-chat":                  (0.14,  0.28, 0.07),
    "x-ai/grok-3-mini":              (0.30,  0.50, 0.075),
}


# ---------------------------------------------------------------------------
# Budget exception (shared)
# ---------------------------------------------------------------------------

class BudgetExceeded(Exception):
    """Raised when the eval run exceeds its cost budget."""
    pass


# ---------------------------------------------------------------------------
# Usage tracker (shared)
# ---------------------------------------------------------------------------

class UsageTracker:
    """Tracks token usage and estimated costs across all API calls."""

    def __init__(self, run_id=None, budget=None, db_collection=None):
        self.calls = []
        self.totals = {"input_tokens": 0, "output_tokens": 0,
                       "cached_tokens": 0, "cost": 0.0, "calls": 0}
        self.run_id = run_id
        self.budget = budget
        self.db_collection = db_collection

    def record(self, model_id, input_tokens=0, output_tokens=0,
               cached_tokens=0, label="", extra=None):
        from datetime import datetime, timezone
        pricing = PRICING.get(model_id, (0, 0, 0))
        uncached_input = max(0, input_tokens - cached_tokens)
        cost = (uncached_input * pricing[0] / 1e6 +
                cached_tokens * pricing[2] / 1e6 +
                output_tokens * pricing[1] / 1e6)
        record = {
            "model": model_id, "label": label,
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "cached_tokens": cached_tokens, "cost": cost,
        }
        if extra:
            record.update(extra)
        self.calls.append(record)
        self.totals["input_tokens"] += input_tokens
        self.totals["output_tokens"] += output_tokens
        self.totals["cached_tokens"] += cached_tokens
        self.totals["cost"] += cost
        self.totals["calls"] += 1

        if self.db_collection is not None:
            try:
                self.db_collection.insert_one({
                    "run_id": self.run_id,
                    "model": model_id,
                    "label": label,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cached_tokens": cached_tokens,
                    "cache_creation": (extra or {}).get("cache_creation", 0),
                    "cost": cost,
                    "call_type": "evaluator" if "eval" in label or "panel" in label or "assessor" in label else "model",
                    "timestamp": datetime.now(timezone.utc),
                    "cumulative_cost": self.totals["cost"],
                })
            except Exception:
                pass

        if self.budget is not None and self.totals["cost"] > self.budget:
            raise BudgetExceeded(
                f"Budget exceeded: ${self.totals['cost']:.2f} > ${self.budget:.2f} "
                f"after {self.totals['calls']} calls")

        return cost

    def summary(self):
        """Print usage summary."""
        print(f"\n{'='*60}")
        print(f"  USAGE & COST SUMMARY")
        if self.budget:
            remaining = self.budget - self.totals["cost"]
            print(f"  Budget: ${self.budget:.2f} | Spent: ${self.totals['cost']:.2f} | Remaining: ${remaining:.2f}")
        print(f"{'='*60}\n")
        print(f"  Total API calls: {self.totals['calls']}")
        print(f"  Input tokens:    {self.totals['input_tokens']:,} ({self.totals['cached_tokens']:,} cached)")
        print(f"  Output tokens:   {self.totals['output_tokens']:,}")
        print(f"  Estimated cost:  ${self.totals['cost']:.2f}\n")

        by_model: dict[str, dict] = {}
        for c in self.calls:
            key = c.get("label") or c["model"]
            if key not in by_model:
                by_model[key] = {"calls": 0, "input": 0, "output": 0, "cached": 0, "cost": 0.0}
            by_model[key]["calls"] += 1
            by_model[key]["input"] += c["input_tokens"]
            by_model[key]["output"] += c["output_tokens"]
            by_model[key]["cached"] += c["cached_tokens"]
            by_model[key]["cost"] += c["cost"]

        print(f"  {'Model/Role':<30} {'Calls':>6} {'Input':>10} {'Cached':>10} {'Output':>8} {'Cost':>8}")
        print(f"  {'-'*30} {'-'*6} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")
        for key in sorted(by_model, key=lambda k: -by_model[k]["cost"]):
            m = by_model[key]
            print(f"  {key:<30} {m['calls']:>6} {m['input']:>10,} {m['cached']:>10,} {m['output']:>8,} ${m['cost']:>7.2f}")
        print(f"  {'-'*30} {'-'*6} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")
        print(f"  {'TOTAL':<30} {self.totals['calls']:>6} {self.totals['input_tokens']:>10,} {self.totals['cached_tokens']:>10,} {self.totals['output_tokens']:>8,} ${self.totals['cost']:>7.2f}")

    def to_dict(self):
        return {"totals": self.totals, "calls": self.calls, "budget": self.budget}


# ---------------------------------------------------------------------------
# Low-level API callers
# ---------------------------------------------------------------------------

def _call_with_retry(fn, retries=2, backoff=5):
    """Retry on rate-limit (429) or transient errors."""
    for attempt in range(retries + 1):
        try:
            return fn()
        except BudgetExceeded:
            raise
        except Exception as e:
            err_str = str(e)
            if attempt < retries and ("429" in err_str or "rate" in err_str.lower() or "overloaded" in err_str.lower()):
                wait = backoff * (attempt + 1)
                sys.stdout.write(f"[retry in {wait}s] ")
                sys.stdout.flush()
                time.sleep(wait)
                continue
            raise


def _call_cheap(provider: str, model: str, system: str, user: str,
                max_tokens: int = 1500) -> str:
    """Call a cheap model for panel assessment (observation, no scoring)."""
    import httpx

    if provider == "deepseek":
        url, key_env = "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"
    elif provider == "openrouter":
        url, key_env = "https://openrouter.ai/api/v1", "OPENROUTER_KEY"
    else:  # openai
        url, key_env = "https://api.openai.com/v1", "OPENAI_API_KEY"

    key = os.environ.get(key_env, "")
    r = httpx.post(f"{url}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system},
                           {"role": "user", "content": user}]},
        timeout=90)
    d = r.json()
    if "choices" in d:
        return d["choices"][0]["message"]["content"]
    raise Exception(f"Panel assessor error ({model}): {d.get('error', d)}")


def _call_scorer(model: str, system: str, user: str,
                 usage: UsageTracker) -> dict:
    """Call the scorer model (Claude) and parse JSON scores."""
    import httpx

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    resp = httpx.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": model, "max_tokens": 1500,
              "system": system,
              "messages": [{"role": "user", "content": user}]},
        timeout=90)
    d = resp.json()

    if "error" in d:
        raise Exception(f"Panel scorer error: {d['error']}")

    u = d.get("usage", {})
    usage.record(model,
        input_tokens=u.get("input_tokens", 0),
        output_tokens=u.get("output_tokens", 0),
        label="panel-scorer")

    text = d["content"][0]["text"] if "content" in d else "{}"
    return _parse_scores(text)


def _parse_scores(text: str) -> dict:
    """Parse JSON scores from model output, handling markdown fences."""
    clean = re.sub(r'```(?:json)?\s*', '', text).strip()
    try:
        return json.loads(clean)
    except Exception:
        m = re.search(r'\{[^{}]*\}', clean)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
        return {"notes": f"parse error: {text[:100]}"}


# ---------------------------------------------------------------------------
# Panel Evaluator
# ---------------------------------------------------------------------------

class PanelEvaluator:
    """Configurable multi-model panel evaluator.

    Two-phase pipeline:
    Phase 1: Cheap assessors observe (extract facts, describe coaching, check refs)
    Phase 2: Strong scorer synthesizes observations into dimension scores

    Config-driven: assessors, dimensions, and scorer prompt come from eval set YAML.
    No hardcoded prompts, models, or dimensions.
    """

    def __init__(self, eval_config: EvalSetConfig, usage: UsageTracker,
                 troop_context: str = ""):
        self.assessors = eval_config.assessors
        self.scorer_model = eval_config.scorer_model
        self.scorer_prompt = eval_config.scorer_prompt
        self.dimensions = eval_config.dimensions
        self.usage = usage
        self.troop_context = troop_context

    def evaluate(self, content: str, context: str,
                 eval_notes: str = "") -> dict:
        """Score content using the panel pipeline.

        Args:
            content: What to score (response text, formatted transcript, etc.)
            context: What it should accomplish (question+expected, scenario desc)
            eval_notes: Ground truth hints for the scorer

        Returns:
            dict with dimension scores (name → 0-10), "notes", and "_assessments"
        """
        # Phase 1: Cheap assessors observe (no scoring)
        assessments = self._run_assessors(content, context)

        # Phase 2: Scorer synthesizes observations + eval_notes → scores
        return self._score(content, context, assessments, eval_notes)

    def _run_assessors(self, content: str, context: str) -> dict[str, str]:
        """Run each configured assessor. Returns role → observation text."""
        results: dict[str, str] = {}
        for assessor in self.assessors:
            prompt = assessor.prompt
            # Inject troop context for troop-role assessors
            if assessor.role == "troop" and self.troop_context:
                prompt = prompt + "\n\nTROOP DATA (verified real):\n" + self.troop_context

            user_msg = f"CONTEXT: {context}\n\nCONTENT:\n{content}"
            try:
                text = _call_with_retry(
                    lambda a=assessor, p=prompt, u=user_msg: _call_cheap(
                        a.provider, a.model, p, u
                    )
                )
                if text and len(text) > 20:
                    results[assessor.role] = text
                    # Track assessor cost
                    self.usage.record(assessor.model,
                        input_tokens=len(prompt + user_msg) // 4,  # estimate
                        output_tokens=len(text) // 4,
                        label=f"assessor-{assessor.role}")
                else:
                    results[assessor.role] = "[Empty response from assessor]"
            except BudgetExceeded:
                raise
            except Exception as e:
                results[assessor.role] = f"[Assessment unavailable: {str(e)[:80]}]"

        return results

    def _score(self, content: str, context: str,
               assessments: dict[str, str], eval_notes: str) -> dict:
        """Claude scorer synthesizes assessor observations into final scores."""
        # Build assessor sections (only include non-error assessments)
        assessor_block = ""
        has_assessments = any(not v.startswith("[") for v in assessments.values())
        if has_assessments:
            sections = []
            for role, text in assessments.items():
                if not text.startswith("["):
                    sections.append(
                        f"--- {role.upper()} ASSESSMENT ---\n{text}"
                    )
            assessor_block = "\n\n".join(sections)

        notes_block = ""
        if eval_notes:
            notes_block = f"\n--- EVALUATOR NOTES (verified facts) ---\n{eval_notes}"

        dim_names = [d.name for d in self.dimensions]
        scorer_input = (
            f"CONTEXT: {context}\n\n"
            f"CONTENT:\n{content}\n"
            f"{notes_block}\n\n"
            f"{assessor_block}\n\n"
            f"Score this content. Return ONLY valid JSON with keys: "
            f"{','.join(dim_names)},notes"
        )

        def do_score():
            return _call_scorer(self.scorer_model, self.scorer_prompt,
                                scorer_input, self.usage)

        result = _call_with_retry(do_score)
        if result:
            result["_assessments"] = dict(assessments)

        return result

    def compute_overall(self, scores: dict[str, float]) -> float:
        """Compute weighted average score across dimensions."""
        total_weight = sum(d.weight for d in self.dimensions)
        if total_weight == 0:
            return 0.0
        weighted_sum = sum(
            scores.get(d.name, 0) * d.weight
            for d in self.dimensions
        )
        return weighted_sum / total_weight

    def rescore(self, collection, query: dict, eval_notes_field: str = "eval_notes",
                on_progress=None) -> dict:
        """Re-score existing responses in MongoDB with the current panel config.

        Core framework operation — not a script. Tracks provenance:
        - Original scores preserved in `score_history` array
        - Each rescore tagged with eval_set version, timestamp, assessor config

        Args:
            collection: pymongo Collection (eval_results)
            query: MongoDB query to select documents to re-score
            eval_notes_field: Field name containing eval notes
            on_progress: Callback(doc_index, total, doc, scores) for progress

        Returns:
            dict with counts: {"rescored": N, "errors": N, "skipped": N}
        """
        from datetime import datetime, timezone

        docs = list(collection.find({**query, "response": {"$exists": True, "$ne": ""}})
                    .sort("run_id", 1))

        if not docs:
            return {"rescored": 0, "errors": 0, "skipped": 0}

        dim_names = [d.name for d in self.dimensions]
        eval_set_version = f"{self.scorer_model}+{len(self.assessors)}assessors"

        stats = {"rescored": 0, "errors": 0, "skipped": 0}

        for i, doc in enumerate(docs):
            response = doc.get("response", "")
            if not response:
                stats["skipped"] += 1
                continue

            perspective = doc.get("perspective", "knowledge")
            question = doc.get("question", "")
            expected = doc.get("expected", "")
            eval_notes = doc.get(eval_notes_field, "")

            try:
                # Build content/context based on perspective
                if perspective == "chain":
                    content = response
                    context = f"CHAIN/SCENARIO: {doc.get('question_id', '?')}\nDESCRIPTION: {question}"
                else:
                    content = response
                    context = f"QUESTION: {question}\n\nEXPECTED: {expected}"

                scores = self.evaluate(content, context, eval_notes)

                score_vals = {d: scores.get(d, 0) for d in dim_names}
                overall = self.compute_overall(score_vals)
                notes = scores.get("notes", "")
                assessments = scores.get("_assessments", {})

                # Build score history entry (preserve old scores)
                history_entry = {
                    "scores": doc.get("scores"),
                    "scores_notes": doc.get("scores_notes"),
                    "evaluator": doc.get("evaluator"),
                    "replaced_at": datetime.now(timezone.utc),
                }

                # Update document
                collection.update_one(
                    {"_id": doc["_id"]},
                    {
                        "$set": {
                            "scores": score_vals,
                            "scores_notes": notes,
                            "scores_assessments": assessments,
                            "overall_score": overall,
                            "evaluator": "panel",
                            "evaluator_version": eval_set_version,
                            "rescored_at": datetime.now(timezone.utc),
                        },
                        "$push": {
                            "score_history": history_entry,
                        },
                    }
                )

                stats["rescored"] += 1

                if on_progress:
                    on_progress(i, len(docs), doc, score_vals)

            except BudgetExceeded:
                raise
            except Exception as e:
                stats["errors"] += 1
                if on_progress:
                    on_progress(i, len(docs), doc, None, error=str(e))

        return stats
