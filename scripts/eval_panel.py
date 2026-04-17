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
#
# Loaded from config/pricing.yaml — the canonical source of truth that the
# production backend cost logger (Stream C) also reads.
#
# Historical tuple form (input, output, cache_read) is preserved so existing
# consumers can keep indexing PRICING directly.
# ---------------------------------------------------------------------------

from pathlib import Path

_PRICING_YAML = Path(__file__).resolve().parent.parent / "config" / "pricing.yaml"


def _load_pricing_yaml(path: Path) -> dict[str, tuple[float, float, float]]:
    """Load pricing.yaml into the legacy tuple form.

    Returns a mapping of model_id → (input, output, cache_read) in $/M tokens.
    If the YAML is missing or malformed, returns an empty dict and logs a
    warning — callers will see $0 cost but the eval will keep running.
    """
    try:
        import yaml  # type: ignore
    except ImportError:
        sys.stderr.write(
            "[eval_panel] pyyaml not installed; cannot load pricing.yaml "
            "— all costs will be $0.00\n"
        )
        return {}

    if not path.exists():
        sys.stderr.write(f"[eval_panel] pricing.yaml not found at {path}\n")
        return {}

    try:
        data = yaml.safe_load(path.read_text())
    except Exception as e:
        sys.stderr.write(f"[eval_panel] failed to parse pricing.yaml: {e}\n")
        return {}

    out: dict[str, tuple[float, float, float]] = {}
    models = (data or {}).get("models", {}) or {}
    for model_id, spec in models.items():
        if not isinstance(spec, dict):
            continue
        out[model_id] = (
            float(spec.get("input_per_million", 0.0)),
            float(spec.get("output_per_million", 0.0)),
            float(spec.get("cache_read_per_million", 0.0)),
        )
    return out


def _compute_pricing_source() -> dict[str, str]:
    """Capture provenance for pricing.yaml — commit hash + file hash.

    Included in results so every cost total is traceable to a specific
    version of config/pricing.yaml.
    """
    import hashlib
    import subprocess

    repo_root = _PRICING_YAML.parent.parent
    info: dict[str, str] = {"path": str(_PRICING_YAML.relative_to(repo_root))}
    if _PRICING_YAML.exists():
        content = _PRICING_YAML.read_bytes()
        info["sha256"] = hashlib.sha256(content).hexdigest()[:12]
        try:
            result = subprocess.run(
                ["git", "log", "-1", "--format=%h", "--", str(_PRICING_YAML)],
                cwd=repo_root,
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                info["git_commit"] = result.stdout.strip() or "untracked"
        except Exception:
            pass
    return info


PRICING: dict[str, tuple[float, float, float]] = _load_pricing_yaml(_PRICING_YAML)
PRICING_SOURCE: dict[str, str] = _compute_pricing_source()


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
        return {
            "totals": self.totals,
            "calls": self.calls,
            "budget": self.budget,
            "pricing_source": PRICING_SOURCE,
        }


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

    def rebuttal(self, content: str, context: str, scores: dict,
                  model_id: str, provider: str, usage: "UsageTracker") -> dict:
        """Give the scored model a chance to rebut its scores.

        Phase 3 (optional): The model that produced the response sees its
        scores and evaluator notes, and can argue for adjustments.

        A cheap judge then determines if each argument is a legitimate
        point (evaluator error) or just an excuse.

        Returns:
            dict with "rebuttal_text", "verdict" (per-dimension), "adjustments",
            and "rebuttal_type" ("legitimate" | "excuses" | "mixed" | "accepted")
        """
        dim_names = [d.name for d in self.dimensions]
        scored_dims = {d: scores.get(d) for d in dim_names if scores.get(d) is not None}
        notes = scores.get("notes", "")

        if not scored_dims:
            return {"rebuttal_text": None, "verdict": {}, "adjustments": {}, "rebuttal_type": "skipped"}

        scores_block = "\n".join(f"  {d}: {v}/10" for d, v in scored_dims.items())

        # Phase 3a: Ask the original model to rebut
        rebuttal_prompt = f"""You just gave this response to a scout's question and were scored by an evaluation panel.

QUESTION: {context[:500]}

YOUR RESPONSE:
{content[:1500]}

SCORES YOU RECEIVED:
{scores_block}

EVALUATOR NOTES: {notes[:500]}

Review your scores. For any dimension where you believe the score is unfair or based on an error:
- State which dimension
- Explain specifically why the score should be higher
- Reference the exact part of your response that supports your case

If the scores are fair, just say "ACCEPTED" and nothing else.

Be honest. Only argue points where you have genuine evidence from your response.
Do NOT argue that you "tried" or "intended to" — only argue based on what you actually said."""

        # Call the original model for the rebuttal
        rebuttal_text = None
        try:
            if provider == "anthropic":
                import httpx
                key = os.environ.get("ANTHROPIC_API_KEY", "")
                resp = httpx.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                             "content-type": "application/json"},
                    json={"model": model_id, "max_tokens": 500,
                          "messages": [{"role": "user", "content": rebuttal_prompt}]},
                    timeout=60)
                d = resp.json()
                if "content" in d:
                    rebuttal_text = d["content"][0].get("text", "")
                    u = d.get("usage", {})
                    usage.record(model_id,
                        input_tokens=u.get("input_tokens", 0),
                        output_tokens=u.get("output_tokens", 0),
                        label=f"{model_id} (rebuttal)")
            elif provider in ("openai", "deepseek", "openrouter", "xai"):
                import httpx
                urls = {"deepseek": "https://api.deepseek.com/v1",
                        "openrouter": "https://openrouter.ai/api/v1",
                        "xai": "https://api.x.ai/v1"}
                base = urls.get(provider, "https://api.openai.com/v1")
                keys = {"deepseek": "DEEPSEEK_API_KEY", "openrouter": "OPENROUTER_KEY",
                        "xai": "XAI_API_KEY"}
                key = os.environ.get(keys.get(provider, "OPENAI_API_KEY"), "")
                resp = httpx.post(f"{base}/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={"model": model_id, "max_tokens": 500,
                          "messages": [{"role": "user", "content": rebuttal_prompt}]},
                    timeout=60)
                d = resp.json()
                if "choices" in d:
                    rebuttal_text = d["choices"][0]["message"]["content"]
                    u = d.get("usage", {})
                    usage.record(model_id,
                        input_tokens=u.get("prompt_tokens", 0),
                        output_tokens=u.get("completion_tokens", 0),
                        label=f"{model_id} (rebuttal)")
            elif provider == "google":
                from google import genai
                from google.genai import types
                gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
                resp = gc.models.generate_content(
                    model=model_id, contents=rebuttal_prompt,
                    config=types.GenerateContentConfig(max_output_tokens=500))
                rebuttal_text = resp.text
                u = getattr(resp, "usage_metadata", None)
                if u:
                    usage.record(model_id,
                        input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                        output_tokens=getattr(u, "candidates_token_count", 0) or 0,
                        label=f"{model_id} (rebuttal)")
        except Exception as e:
            return {"rebuttal_text": f"[Rebuttal failed: {str(e)[:100]}]",
                    "verdict": {}, "adjustments": {}, "rebuttal_type": "error"}

        if not rebuttal_text:
            return {"rebuttal_text": None, "verdict": {}, "adjustments": {}, "rebuttal_type": "error"}

        # Check for acceptance
        if rebuttal_text.strip().upper().startswith("ACCEPTED"):
            return {"rebuttal_text": rebuttal_text, "verdict": {}, "adjustments": {},
                    "rebuttal_type": "accepted"}

        # Phase 3b: Cheap judge evaluates the rebuttal
        judge_prompt = f"""A model was scored on an eval and submitted a rebuttal arguing for higher scores.

ORIGINAL SCORES:
{scores_block}

EVALUATOR NOTES: {notes[:300]}

MODEL'S REBUTTAL:
{rebuttal_text[:1000]}

For each dimension the model argues about, decide:
- "upheld": The original score stands. The model is making excuses or the argument isn't supported by evidence.
- "adjust +N": The model has a legitimate point. The score should increase by N (1-3 max).

Return ONLY JSON: {{"dimension_name": "upheld" or "adjust +N", ...}}
Example: {{"accuracy": "adjust +2", "specificity": "upheld"}}

Be skeptical. Most rebuttals are excuses. Only adjust if the model cites specific evidence from its response that the evaluator clearly missed or misread."""

        verdict = {}
        adjustments = {}
        try:
            verdict_text = _call_with_retry(
                lambda: _call_cheap("openai", "gpt-4.1-nano", judge_prompt, "")
            )
            if verdict_text:
                import re
                json_match = re.search(r'\{.*\}', verdict_text, re.DOTALL)
                if json_match:
                    verdict = __import__("json").loads(json_match.group())
                    for dim, ruling in verdict.items():
                        if isinstance(ruling, str) and ruling.startswith("adjust"):
                            try:
                                adj = int(ruling.split("+")[1].strip())
                                adjustments[dim] = min(adj, 3)  # cap at +3
                            except (IndexError, ValueError):
                                pass
                usage.record("gpt-4.1-nano",
                    input_tokens=len(judge_prompt) // 4,
                    output_tokens=len(verdict_text) // 4,
                    label="rebuttal-judge")
        except Exception:
            pass

        # Classify the rebuttal
        if not verdict:
            rebuttal_type = "unscored"
        elif adjustments:
            rebuttal_type = "legitimate" if len(adjustments) > len(verdict) / 2 else "mixed"
        else:
            rebuttal_type = "excuses"

        return {
            "rebuttal_text": rebuttal_text,
            "verdict": verdict,
            "adjustments": adjustments,
            "rebuttal_type": rebuttal_type,
        }

    def compute_overall(self, scores: dict[str, float | None]) -> float:
        """Compute weighted average score across applicable dimensions.

        Skips dimensions that are None or missing (N/A for this question).
        Only averages dimensions that have actual scores.
        """
        weighted_sum = 0.0
        total_weight = 0.0
        for d in self.dimensions:
            val = scores.get(d.name)
            if val is not None and isinstance(val, (int, float)):
                weighted_sum += val * d.weight
                total_weight += d.weight
        if total_weight == 0:
            return 0.0
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
