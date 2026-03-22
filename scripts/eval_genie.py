#!/usr/bin/env python3
"""Eval Genie v1 — Interactive AI research assistant for eval data.

REPL + LLM orchestration. Uses Claude Sonnet as the reasoning model
with tool_use to call local statistical analysis functions.

Usage:
  python3 scripts/eval_genie.py                    # interactive REPL
  python3 scripts/eval_genie.py "question here"    # single question mode
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Ensure scripts/ is on path
sys.path.insert(0, str(Path(__file__).parent))

from genie_tools import TOOLS, describe_data, _ensure_dirs

# ---------------------------------------------------------------------------
# API key loading (same pattern as run-eval.py)
# ---------------------------------------------------------------------------

LIBRECHAT_ENV = Path("/home/devuser/LibreChat/.env")


def load_dotenv_key(name: str) -> str | None:
    if not LIBRECHAT_ENV.exists():
        return None
    for line in LIBRECHAT_ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return None


def get_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    key = load_dotenv_key("ANTHROPIC_API_KEY")
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
        return key
    # Try GCP secret
    try:
        import subprocess
        result = subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest",
             "--secret", "anthropic-api-key", "--project", "hexapax-devbox"],
            capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            key = result.stdout.strip()
            os.environ["ANTHROPIC_API_KEY"] = key
            return key
    except Exception:
        pass
    print("ERROR: No ANTHROPIC_API_KEY found in env, .env, or GCP secrets.")
    sys.exit(1)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are Eval Genie — a research statistician helping analyze AI evaluation data.

Your job is to help the user find real signals in noisy eval data. You have
tools to query MongoDB, run statistical tests, and generate plots.

PRINCIPLES:
1. Always report effect sizes, not just p-values. A significant p with tiny
   effect is not interesting. A large effect with p=0.08 might be.
2. Always report confidence intervals when possible.
3. Flag when sample sizes are too small for reliable inference.
4. Distinguish "no effect found" from "not enough data to tell."
5. When results are ambiguous, suggest what experiment would resolve it.
6. Present findings at three levels: headline, evidence, caveats.
7. Generate plots when they'd clarify the finding — don't just dump numbers.

DATA CONTEXT:
- MongoDB collection: eval_results in scoutquest database
- Documents have: perspective, config_id, model_id, layer, knowledge,
  question_id, category, scores (dict of dimension->value), overall_score,
  run_id, eval_version, timestamp
- Score dimensions vary by perspective:
  - knowledge: accuracy, specificity, safety, coaching, troop_voice
  - chain: tool_accuracy, coaching_quality, state_awareness, character_voice, safety
  - safety: safety_compliance, boundary_firmness, emotional_handling,
    escalation_judgment, manipulation_resistance
- Key config axes: model_id, layer, knowledge, adaptive_effort

COMPARABILITY:
- Only compare results with the same eval_version (evaluator changed between versions)
- Results from different run_ids CAN be compared if same eval_version
- Rescored results (evaluator="panel-v2") used updated assessor prompts — note this
- The evaluator field tracks which panel version scored each result

When the user asks a question, think about:
1. What data do I need? (use describe_data or query_results)
2. What's the right statistical test? (depends on # groups, paired vs independent, normality)
3. Is the sample size adequate? (flag if not)
4. What visualization would help? (generate one if it adds clarity)
5. What can I NOT conclude from this data? (always state limitations)"""


# ---------------------------------------------------------------------------
# Build Anthropic tool definitions
# ---------------------------------------------------------------------------

def build_tool_defs() -> list[dict]:
    """Convert TOOLS registry into Anthropic tool_use format."""
    defs = []
    for name, info in TOOLS.items():
        defs.append({
            "name": name,
            "description": info["description"],
            "input_schema": info["input_schema"],
        })
    return defs


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def execute_tool(name: str, params: dict) -> dict:
    """Execute a tool by name with given params, return result dict."""
    if name not in TOOLS:
        return {"error": f"Unknown tool: {name}"}
    try:
        fn = TOOLS[name]["function"]
        result = fn(params)
        return result
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------------------
# Cost tracking
# ---------------------------------------------------------------------------

class CostTracker:
    """Track API costs from Anthropic usage metadata."""

    # Sonnet 4.6 pricing per 1M tokens
    INPUT_COST = 3.00
    OUTPUT_COST = 15.00

    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_creation_tokens = 0
        self.cache_read_tokens = 0
        self.calls = 0

    def add(self, usage):
        """Add usage from an Anthropic API response."""
        self.input_tokens += getattr(usage, "input_tokens", 0)
        self.output_tokens += getattr(usage, "output_tokens", 0)
        self.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0)
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0)
        self.calls += 1

    @property
    def total_cost(self) -> float:
        input_cost = (self.input_tokens / 1_000_000) * self.INPUT_COST
        output_cost = (self.output_tokens / 1_000_000) * self.OUTPUT_COST
        # Cache creation costs same as input; cache reads are discounted (10%)
        cache_create_cost = (self.cache_creation_tokens / 1_000_000) * self.INPUT_COST
        cache_read_cost = (self.cache_read_tokens / 1_000_000) * self.INPUT_COST * 0.1
        return input_cost + output_cost + cache_create_cost + cache_read_cost

    def summary(self) -> str:
        return (
            f"Session cost: ${self.total_cost:.4f}\n"
            f"  API calls: {self.calls}\n"
            f"  Input tokens: {self.input_tokens:,}\n"
            f"  Output tokens: {self.output_tokens:,}\n"
            f"  Cache create: {self.cache_creation_tokens:,}\n"
            f"  Cache read: {self.cache_read_tokens:,}"
        )


# ---------------------------------------------------------------------------
# Conversation loop
# ---------------------------------------------------------------------------

class GenieSession:
    """Manages a conversation session with the LLM."""

    MODEL = "claude-sonnet-4-6"

    def __init__(self, client):
        self.client = client
        self.messages = []
        self.tool_defs = build_tool_defs()
        self.cost = CostTracker()

    def send(self, user_text: str) -> str:
        """Send user message, handle tool calls, return final text response."""
        self.messages.append({"role": "user", "content": user_text})

        while True:
            response = self.client.messages.create(
                model=self.MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=self.tool_defs,
                messages=self.messages,
            )
            self.cost.add(response.usage)

            # Collect text and tool_use blocks
            text_parts = []
            tool_calls = []
            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
                elif block.type == "tool_use":
                    tool_calls.append(block)

            # Append assistant message to history
            self.messages.append({"role": "assistant", "content": response.content})

            # If no tool calls, we're done
            if not tool_calls:
                return "\n".join(text_parts)

            # Execute tool calls and feed results back
            tool_results = []
            for tc in tool_calls:
                print(f"  [tool] {tc.name}({_compact_json(tc.input)})")
                result = execute_tool(tc.name, tc.input)
                # Truncate large results to keep context manageable
                result_str = json.dumps(result, default=str)
                if len(result_str) > 15000:
                    result_str = result_str[:15000] + "...(truncated)"
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": result_str,
                })

            self.messages.append({"role": "user", "content": tool_results})

            # If stop_reason is "end_turn" and there were text parts, also return text
            if response.stop_reason == "end_turn" and text_parts:
                return "\n".join(text_parts)
            # Otherwise loop to let Claude continue processing tool results


def _compact_json(obj) -> str:
    """Compact JSON representation for tool call logging."""
    s = json.dumps(obj, default=str)
    if len(s) > 120:
        return s[:120] + "..."
    return s


# ---------------------------------------------------------------------------
# Startup banner
# ---------------------------------------------------------------------------

def print_banner():
    """Print startup banner with data summary."""
    _ensure_dirs()
    print()
    print("=" * 56)
    print("  Eval Genie v1 -- Research Assistant")
    print("=" * 56)

    try:
        summary = describe_data({})
        total = summary["total_docs"]
        perspectives = list(summary["perspectives"].keys())
        n_configs = len(summary["config_ids"])
        n_models = len(summary["model_ids"])
        dims = summary["score_dimensions"]

        print(f"  Data: {total:,} eval results")
        print(f"  Perspectives: {', '.join(perspectives)}")
        print(f"  Configs: {n_configs} | Models: {n_models}")
        print(f"  Score dimensions: {', '.join(dims)}")
        if summary["gaps"]:
            n_gaps = len(summary["gaps"])
            print(f"  Gaps detected: {n_gaps}")
    except Exception as e:
        print(f"  (Could not load data summary: {e})")

    print()
    print("  Type your question, or 'help' for examples.")
    print("  Commands: help, cost, quit/exit")
    print("=" * 56)
    print()


def print_help():
    print("""
Example questions:
  - Is there a significant difference between L0 and L3 on accuracy?
  - Which model scores highest on coaching?
  - What's the correlation between accuracy and specificity?
  - Show me the distribution of safety scores by model.
  - Compare all configs on overall_score.
  - Are the chain perspective scores normally distributed?
  - What does the data look like for the knowledge perspective?

Special commands:
  help  - Show this help message
  cost  - Show session API cost so far
  quit  - Exit the REPL
  exit  - Exit the REPL
""")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import anthropic

    api_key = get_api_key()
    client = anthropic.Anthropic(api_key=api_key)

    # Single question mode
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        session = GenieSession(client)
        try:
            response = session.send(question)
            print(response)
        except Exception as e:
            print(f"Error: {e}")
        return

    # Interactive REPL
    print_banner()
    session = GenieSession(client)

    while True:
        try:
            user_input = input("> ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            print(session.cost.summary())
            break

        if not user_input:
            continue

        cmd = user_input.lower()
        if cmd in ("quit", "exit"):
            print(session.cost.summary())
            print("Goodbye!")
            break
        if cmd == "help":
            print_help()
            continue
        if cmd == "cost":
            print(session.cost.summary())
            continue

        try:
            response = session.send(user_input)
            print()
            print(response)
            print()
        except KeyboardInterrupt:
            print("\n(Interrupted)")
            continue
        except Exception as e:
            print(f"\nError: {type(e).__name__}: {e}\n")


if __name__ == "__main__":
    main()
