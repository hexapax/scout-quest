"""Chain perspective — multi-turn conversation evaluation.

Tests: Can the model sustain a realistic scout session with tool use,
state management, and character consistency across multiple turns?

Execution: TypeScript harness (subprocess) → JSON captures
Evaluation: Shared panel evaluator (Python)
Storage: Unified eval_results with chain_metadata
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

sys.path.insert(0, str(Path(__file__).parent.parent))

from eval_framework import (
    EvalItem, EvalSetConfig, ExecutionResult, PerspectiveRegistry,
    RunConfig, ScoredResult, load_eval_set_yaml,
)
from eval_panel import BudgetExceeded

if TYPE_CHECKING:
    from eval_panel import UsageTracker

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent.parent
HARNESS_DIR = PROJECT_ROOT / "mcp-servers" / "scout-quest" / "test"
HARNESS_SCRIPT = HARNESS_DIR / "harness.ts"
REPORT_DIR = HARNESS_DIR / "reports"
EVAL_SET_DIR = PROJECT_ROOT / "eval-sets"


# ---------------------------------------------------------------------------
# Transcript formatting
# ---------------------------------------------------------------------------

def format_transcript(messages: list[dict]) -> str:
    """Format a chain transcript for panel evaluator consumption.

    Produces the same [COACH]/[SCOUT] format the TypeScript evaluator uses,
    so the panel assessors see a familiar structure.
    """
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        line = f"[{role}]: {content}"

        # Include tool calls
        tool_calls = msg.get("toolCalls") or []
        if tool_calls:
            for tc in tool_calls:
                args_str = json.dumps(tc.get("args", {}))
                result_str = tc.get("result", "")
                line += f"\n  [TOOL CALL] {tc.get('name', '?')}({args_str}) → {result_str}"

        lines.append(line)

    return "\n\n".join(lines)


def extract_tool_calls(messages: list[dict]) -> list[dict]:
    """Extract all tool calls from a transcript."""
    calls = []
    for msg in messages:
        for tc in msg.get("toolCalls") or []:
            calls.append({
                "name": tc.get("name"),
                "args": tc.get("args"),
                "result": tc.get("result", ""),
            })
    return calls


# ---------------------------------------------------------------------------
# Harness execution
# ---------------------------------------------------------------------------

def run_harness(
    chain_id: str | None = None,
    scenario_ids: list[str] | None = None,
    model: str = "claude-sonnet-4-6",
    layer: str = "full",
    mongo_uri: str = "",
    output_dir: Path | None = None,
    thinking: bool = False,
    thinking_budget: int = 2000,
) -> Path:
    """Call the TypeScript harness via subprocess.

    Args:
        chain_id: Chain to run (mutually exclusive with scenario_ids)
        scenario_ids: Scenarios to run
        model: Model identifier for the harness
        layer: Layer config (full, persona-only, no-tools)
        mongo_uri: MongoDB connection string
        output_dir: Directory for JSON output
        thinking: Enable extended thinking
        thinking_budget: Token budget for thinking

    Returns:
        Path to the output directory containing JSON captures
    """
    if output_dir is None:
        timestamp = time.strftime("%Y-%m-%d_%H-%M-%S", time.gmtime())
        if chain_id:
            output_dir = REPORT_DIR / chain_id / timestamp
        else:
            output_dir = REPORT_DIR / "scenarios" / timestamp

    output_dir.mkdir(parents=True, exist_ok=True)

    # Build command — use --json-output to control where captures go
    cmd = [
        "npx", "tsx", str(HARNESS_SCRIPT),
        "--model", model,
        "--skip-eval",  # Python panel does evaluation
        "--json-output", str(output_dir),
        "--output", str(output_dir / "report.md"),
    ]

    if chain_id:
        cmd.extend(["--chain", chain_id])
    elif scenario_ids:
        cmd.extend(["--scenarios", ",".join(scenario_ids)])

    if mongo_uri:
        cmd.extend(["--mongo-uri", mongo_uri])

    if thinking:
        cmd.append("--thinking")
        cmd.extend(["--thinking-budget", str(thinking_budget)])

    # Note: --layer flag will be added to harness in Phase 1F
    # For now, the harness uses its default full system prompt

    print(f"  [HARNESS] Running: {' '.join(cmd[-6:])}")
    result = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=600,  # 10 min max per chain
    )

    if result.returncode != 0:
        print(f"  [HARNESS] stderr: {result.stderr[-500:]}")
        raise RuntimeError(f"Harness failed (exit {result.returncode}): {result.stderr[-200:]}")

    # Print harness output summary
    stdout_lines = result.stdout.strip().split("\n")
    for line in stdout_lines[-10:]:
        print(f"  [HARNESS] {line}")

    return output_dir


# ---------------------------------------------------------------------------
# Chain perspective implementation
# ---------------------------------------------------------------------------

class ChainPerspective:
    """Multi-turn session chain evaluation with tool use and state management."""

    name = "chain"
    description = "Multi-turn sessions with tool use and state management"
    default_eval_set = "chain-eval-v1.yaml"

    def load_eval_set(self, yaml_path: str) -> EvalSetConfig:
        """Load chain eval set from YAML."""
        path = Path(yaml_path)
        if not path.is_absolute():
            path = EVAL_SET_DIR / path
        return load_eval_set_yaml(str(path))

    def resolve_items(self, eval_set: EvalSetConfig, filters: dict) -> list[EvalItem]:
        """Resolve chains/scenarios from eval set into EvalItems.

        For chains: returns one EvalItem per chain (execution produces multiple steps).
        For scenarios: returns one EvalItem per scenario.
        """
        items: list[EvalItem] = []
        raw = eval_set.raw

        # Determine what to run
        chain_filter = filters.get("chain")
        scenario_filter = filters.get("scenario")

        if chain_filter:
            # Specific chain(s)
            chain_ids = [c.strip() for c in chain_filter.split(",")]
            for chain_def in raw.get("chains", []):
                if chain_def["id"] in chain_ids and chain_def.get("enabled", True):
                    items.append(EvalItem(
                        id=chain_def["id"],
                        perspective="chain",
                        item_type="chain",
                        category="chain",
                        description=chain_def.get("description", chain_def["id"]),
                        expected="",
                        question_type="chain",
                    ))
        elif scenario_filter:
            # Specific scenario(s)
            scenario_ids = [s.strip() for s in scenario_filter.split(",")]
            for sc_def in raw.get("scenarios", []):
                if sc_def["id"] in scenario_ids and sc_def.get("enabled", True):
                    items.append(EvalItem(
                        id=sc_def["id"],
                        perspective="chain",
                        item_type="scenario",
                        category=sc_def.get("category", "scenario"),
                        description=sc_def.get("description", sc_def["id"]),
                        expected="",
                        question_type=sc_def.get("category", "scenario"),
                    ))
        else:
            # Default: all enabled chains
            for chain_def in raw.get("chains", []):
                if chain_def.get("enabled", True):
                    items.append(EvalItem(
                        id=chain_def["id"],
                        perspective="chain",
                        item_type="chain",
                        category="chain",
                        description=chain_def.get("description", chain_def["id"]),
                        expected="",
                        question_type="chain",
                    ))

        # Apply sample filter
        sample = filters.get("sample")
        if sample:
            items = items[:sample]

        return items

    def execute(self, item: EvalItem, config: RunConfig,
                usage=None, **kwargs) -> ExecutionResult:
        """Execute a chain/scenario via the TypeScript harness.

        Returns an ExecutionResult with raw_data containing:
        - chain_result: full chain-result.json (if chain)
        - step_captures: list of per-step capture JSONs
        - output_dir: path to the output directory
        """
        mongo_uri = kwargs.get("mongo_uri", "")

        start = time.time()
        try:
            if item.item_type == "chain":
                output_dir = run_harness(
                    chain_id=item.id,
                    model=config.model_id,
                    layer=config.layer,
                    mongo_uri=mongo_uri,
                    thinking=config.thinking is not None and config.thinking.get("enabled", False),
                    thinking_budget=config.thinking.get("budget", 2000) if config.thinking else 2000,
                )
            else:
                output_dir = run_harness(
                    scenario_ids=[item.id],
                    model=config.model_id,
                    layer=config.layer,
                    mongo_uri=mongo_uri,
                    thinking=config.thinking is not None and config.thinking.get("enabled", False),
                    thinking_budget=config.thinking.get("budget", 2000) if config.thinking else 2000,
                )

            elapsed_ms = int((time.time() - start) * 1000)

            # Load results
            raw_data = self._load_results(output_dir, item)
            raw_data["output_dir"] = str(output_dir)

            # For the response_text, format the combined transcript
            all_transcripts = []
            for step in raw_data.get("step_captures", []):
                transcript = step.get("transcript", [])
                step_id = step.get("scenario", {}).get("id", "?")
                all_transcripts.append(f"=== STEP: {step_id} ===\n{format_transcript(transcript)}")

            response_text = "\n\n".join(all_transcripts)

            return ExecutionResult(
                item=item,
                config=config,
                response_text=response_text,
                raw_data=raw_data,
                timing_ms=elapsed_ms,
            )

        except Exception as e:
            elapsed_ms = int((time.time() - start) * 1000)
            return ExecutionResult(
                item=item,
                config=config,
                response_text="",
                raw_data={},
                timing_ms=elapsed_ms,
                error=str(e)[:500],
            )

    def _load_results(self, output_dir: Path, item: EvalItem) -> dict:
        """Load chain/scenario results from the harness output directory."""
        raw_data: dict = {"step_captures": []}

        if item.item_type == "chain":
            # Chain mode: chain-result.json + per-step JSONs
            chain_result_path = output_dir / "chain-result.json"
            if chain_result_path.exists():
                with open(chain_result_path) as f:
                    raw_data["chain_result"] = json.load(f)

                # Load per-step captures
                for step in raw_data["chain_result"].get("steps", []):
                    step_id = step.get("stepId", "")
                    step_path = output_dir / f"{step_id}.json"
                    if step_path.exists():
                        with open(step_path) as f:
                            raw_data["step_captures"].append(json.load(f))
        else:
            # Scenario mode: look for scenario JSON captures
            for json_file in sorted(output_dir.glob("*.json")):
                if json_file.name not in ("chain-result.json",):
                    with open(json_file) as f:
                        raw_data["step_captures"].append(json.load(f))

        return raw_data

    def format_for_evaluation(self, result: ExecutionResult) -> tuple[str, str]:
        """Format chain transcript for panel evaluator.

        For chains with multiple steps, evaluates each step individually.
        Returns (content, context) for one evaluation pass.
        """
        content = result.response_text
        item = result.item

        # Build context from chain description + step details
        context_parts = [f"CHAIN/SCENARIO: {item.id}", f"DESCRIPTION: {item.description}"]

        # Include expected tools from step captures
        for capture in result.raw_data.get("step_captures", []):
            scenario = capture.get("scenario", {})
            expected_tools = scenario.get("expectedTools", [])
            if expected_tools:
                context_parts.append(
                    f"EXPECTED TOOLS ({scenario.get('id', '?')}): {', '.join(expected_tools)}"
                )
            # Include evaluator context if present
            desc = scenario.get("description", "")
            if "EVALUATOR CONTEXT:" in desc:
                context_parts.append(desc.split("EVALUATOR CONTEXT:")[1].strip())

        context = "\n".join(context_parts)
        return content, context

    def format_step_for_evaluation(self, capture: dict) -> tuple[str, str]:
        """Format a single chain step for panel evaluation.

        Used when evaluating steps individually rather than the whole chain.
        """
        transcript = capture.get("transcript", [])
        content = format_transcript(transcript)

        scenario = capture.get("scenario", {})
        expected_tools = scenario.get("expectedTools", [])

        context_parts = [
            f"STEP: {scenario.get('id', '?')}",
            f"DESCRIPTION: {scenario.get('description', '')}",
        ]
        if expected_tools:
            context_parts.append(f"EXPECTED TOOLS: {', '.join(expected_tools)}")

        context = "\n".join(context_parts)
        return content, context

    def to_mongo_doc(self, scored: ScoredResult, run_id: str,
                     eval_version: str, system_version: str) -> dict:
        """Convert to MongoDB document with chain_metadata."""
        item = scored.execution.item
        config = scored.execution.config
        response = scored.execution.response_text
        resp_hash = hashlib.sha256(response.encode()).hexdigest()[:16]

        # Extract tool calls and hallucinations from all steps
        all_tool_calls = []
        all_hallucinations = []
        all_db_diffs = []

        for capture in scored.execution.raw_data.get("step_captures", []):
            transcript = capture.get("transcript", [])
            all_tool_calls.extend(extract_tool_calls(transcript))

            eval_data = capture.get("evaluation", {})
            all_hallucinations.extend(eval_data.get("hallucinations", []))

        # DB diffs from chain_result
        chain_result = scored.execution.raw_data.get("chain_result", {})
        for step in chain_result.get("steps", []):
            db_before = step.get("dbBefore", {})
            db_after = step.get("dbAfter", {})
            if db_before or db_after:
                all_db_diffs.append({
                    "step_id": step.get("stepId"),
                    "before": db_before,
                    "after": db_after,
                })

        doc = {
            # Perspective
            "perspective": "chain",

            # Run identity
            "run_id": run_id,
            "eval_version": eval_version,
            "system_version": system_version,
            "evaluator": "panel",

            # Config axes
            **config.to_mongo_fields(),

            # Item
            "question_id": item.id,
            "item_type": item.item_type,
            "category": item.category,
            "question_type": item.question_type,
            "question": item.description,
            "expected": item.expected,
            "eval_notes": item.eval_notes,

            # Results
            "response": response,
            "response_hash": resp_hash,
            "scores": scored.scores,
            "scores_notes": scored.scores_notes,
            "scores_assessments": scored.assessments,
            "overall_score": scored.overall_score,

            # Chain-specific metadata
            "chain_metadata": {
                "chain_id": item.id if item.item_type == "chain" else None,
                "step_count": len(scored.execution.raw_data.get("step_captures", [])),
                "tool_calls": all_tool_calls,
                "hallucinations": all_hallucinations,
                "db_diffs": all_db_diffs,
                "step_summaries": [
                    {
                        "step_id": c.get("scenario", {}).get("id"),
                        "turns": len(c.get("transcript", [])),
                        "tool_count": len(extract_tool_calls(c.get("transcript", []))),
                        "duration_ms": c.get("timing", {}).get("durationMs", 0),
                    }
                    for c in scored.execution.raw_data.get("step_captures", [])
                ],
            },

            "timing_ms": scored.execution.timing_ms,
            "timestamp": datetime.now(timezone.utc),
        }

        if scored.execution.error:
            doc["error"] = scored.execution.error

        return doc

    def evaluate_per_step(self, result: ExecutionResult, panel, eval_notes: str = "") -> list[ScoredResult]:
        """Evaluate each chain step individually (finer granularity).

        Returns one ScoredResult per step. Useful when you want per-step
        scores in addition to overall chain scores.
        """
        scored_steps = []
        for capture in result.raw_data.get("step_captures", []):
            content, context = self.format_step_for_evaluation(capture)
            scenario = capture.get("scenario", {})
            step_eval_notes = ""
            desc = scenario.get("description", "")
            if "EVALUATOR CONTEXT:" in desc:
                step_eval_notes = desc.split("EVALUATOR CONTEXT:")[1].strip()

            scores = panel.evaluate(content, context, step_eval_notes or eval_notes)

            scored_steps.append(ScoredResult(
                execution=ExecutionResult(
                    item=EvalItem(
                        id=scenario.get("id", "?"),
                        perspective="chain",
                        item_type="chain_step",
                        category=result.item.category,
                        description=desc,
                        expected="",
                        question_type="chain_step",
                    ),
                    config=result.config,
                    response_text=content,
                    raw_data={"capture": capture},
                    timing_ms=capture.get("timing", {}).get("durationMs", 0),
                ),
                scores={k: v for k, v in scores.items() if k not in ("notes", "_assessments")},
                scores_notes=scores.get("notes", ""),
                assessments=scores.get("_assessments", {}),
            ))

        return scored_steps


# Register
PerspectiveRegistry.register(ChainPerspective())
