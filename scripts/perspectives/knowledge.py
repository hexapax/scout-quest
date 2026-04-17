"""Knowledge perspective — single-turn Q&A evaluation.

Tests: Can the model answer a scout's question correctly, with the right
coaching approach and troop awareness?

Structure: question → model response → panel evaluation → score
Dimensions: accuracy, specificity, safety, coaching, troop_voice
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from eval_framework import (
    EvalItem, EvalSetConfig, ExecutionResult, PerspectiveRegistry,
    RunConfig, ScoredResult, load_eval_set_yaml,
)
from eval_panel import UsageTracker, _call_with_retry, BudgetExceeded

if TYPE_CHECKING:
    pass

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent.parent
KNOWLEDGE_FULL = PROJECT_ROOT / "backend" / "knowledge" / "interim-bsa-knowledge.md"
KNOWLEDGE_COMPACT = PROJECT_ROOT / "backend" / "knowledge" / "compact-bsa-knowledge.md"
TROOP_CONTEXT = PROJECT_ROOT / "backend" / "knowledge" / "troop-context.md"
PERSONAS_FILE = PROJECT_ROOT / "backend" / "experiments" / "model-personas.json"
EVAL_SET_DIR = PROJECT_ROOT / "eval-sets"

# System prompt delimiters for prompt caching
# Anthropic allows up to 4 cache breakpoints per request.
# We use 2: one after knowledge, one after troop context.
SYSTEM_PROMPT_DELIMITER = "\n\n=== PERSONA AND CONTEXT ===\n\n"
TROOP_CONTEXT_DELIMITER = "\n\n=== TROOP SPECIFIC DATA ===\n\n"

# Persona without tool instructions (for layers without tools)
PERSONA_NO_TOOLS = """You are Scout Coach — think of yourself like Woody from Toy Story. You're this scout's loyal buddy. You know their name, their rank, their goals. You worry about them but you don't show it. You're proud of them when they succeed.

YOUR PERSONALITY:
- Warm, genuine, a little bit funny — never robotic or formal
- Protective on safety (firm and direct — no hedging)
- Encouraging on growth (celebrate effort, not talent)
- Honest when it matters — you don't sugarcoat, but you deliver truth with care
- You step back as the scout matures — a 12-year-old gets more hand-holding, a 16-year-old gets autonomy

HOW YOU USE KNOWLEDGE:
- Policy/procedure questions → answer DIRECTLY, paraphrase for the scout's age
- Life skills/merit badge WORK → coach through questions ("what do you think?")
- Troop logistics → just answer
- Emotional moments → empathize FIRST, information second
- Safety → be firm and specific, cite the rule
- If you're unsure about a specific fact, say so honestly rather than guessing

IMPORTANT: Don't agree with everything the scout says just to be nice. If they're wrong about a policy, tell them — kindly but clearly. If they want to skip something important, push back gently. Woody doesn't just say what Andy wants to hear."""


# ---------------------------------------------------------------------------
# Knowledge loading (lazy, cached)
# ---------------------------------------------------------------------------

_knowledge_full: str | None = None
_knowledge_compact: str | None = None
_troop_context: str | None = None
_personas: dict | None = None


def _load_knowledge():
    global _knowledge_full, _knowledge_compact, _troop_context, _personas
    if _knowledge_full is None:
        _knowledge_full = KNOWLEDGE_FULL.read_text() if KNOWLEDGE_FULL.exists() else ""
    if _knowledge_compact is None:
        _knowledge_compact = KNOWLEDGE_COMPACT.read_text() if KNOWLEDGE_COMPACT.exists() else ""
    if _troop_context is None:
        _troop_context = TROOP_CONTEXT.read_text() if TROOP_CONTEXT.exists() else ""
    if _personas is None:
        with open(PERSONAS_FILE) as f:
            _personas = json.load(f)


def get_troop_context() -> str:
    _load_knowledge()
    return _troop_context or ""


# ---------------------------------------------------------------------------
# System prompt building
# ---------------------------------------------------------------------------

def build_system_prompt(config: RunConfig) -> str:
    """Build the system prompt based on RunConfig layer and knowledge settings."""
    _load_knowledge()

    layer = config.layer

    # Choose persona: strip tool instructions for layers without tools
    if layer in ("persona-only", "knowledge-only", "knowledge+troop"):
        persona = PERSONA_NO_TOOLS
    else:
        persona = _personas[config.persona_key]["persona"]

    # Choose knowledge document
    if config.knowledge == "full":
        knowledge = _knowledge_full
    elif config.knowledge == "compact":
        knowledge = _knowledge_compact
    else:
        knowledge = ""

    # Use custom knowledge doc if specified
    if config.knowledge_doc:
        doc_path = PROJECT_ROOT / config.knowledge_doc
        if doc_path.exists():
            knowledge = doc_path.read_text()

    # Layer definitions — what context the model gets:
    #   P = Persona (coaching character)
    #   K = BSA Knowledge (177K cached doc)
    #   T = Troop Context (11K cached, roster/schedule/leaders)
    #   W = Web search tool (configured separately via config.web_search)
    #
    # Layer              P  K  T  Tokens    Use case
    # persona-only       ✓  ·  ·  300       Baseline — model training only
    # troop-only         ✓  ·  ✓  12K       Troop personalization without knowledge
    # knowledge-only     ✓  ✓  ·  177K      BSA knowledge without troop personalization
    # knowledge+troop    ✓  ✓  ✓  189K      Knowledge + personalization (production default)
    # troop+websearch    ✓  ·  ✓  12K+W     Can search replace 177K knowledge doc?
    #
    # "full" = knowledge+troop (the default for production configs)
    # Web search (W) is orthogonal — any layer can add it via config.web_search

    if layer == "persona-only":
        return persona
    elif layer == "troop-only":
        return _troop_context + TROOP_CONTEXT_DELIMITER + persona
    elif layer == "knowledge-only":
        return knowledge + SYSTEM_PROMPT_DELIMITER + persona
    elif layer == "troop+websearch":
        return _troop_context + TROOP_CONTEXT_DELIMITER + persona
    else:
        # "full", "knowledge+troop", or any unrecognized → knowledge + troop + persona
        return knowledge + SYSTEM_PROMPT_DELIMITER + _troop_context + TROOP_CONTEXT_DELIMITER + persona


# ---------------------------------------------------------------------------
# Model callers — create callable from RunConfig
# ---------------------------------------------------------------------------

def _make_caller(config: RunConfig, usage: UsageTracker):
    """Create a model caller function from a RunConfig.

    Returns a callable: (messages, system_prompt, max_tokens) → str
    """
    provider = config.provider
    model_id = config.model_id

    if provider == "anthropic":
        if config.web_search:
            return _make_anthropic_tools_caller(config, usage)
        return _make_anthropic_caller(config, usage)
    elif provider == "google":
        return _make_gemini_caller(config, usage)
    elif provider in ("openai", "deepseek", "openrouter", "xai"):
        return _make_openai_compat_caller(config, usage)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def _check_limits(output_tokens: int = 0, max_tokens: int = 4096,
                   stop_reason: str | None = None,
                   turns: int | None = None, max_turns: int | None = None) -> dict:
    """Check if a response is approaching configured limits.

    Returns a dict with warnings for any limit within 90% utilization.
    Empty dict = no concerns.
    """
    warnings = {}
    threshold = 0.9

    # Token limit
    if max_tokens > 0 and output_tokens > 0:
        token_util = output_tokens / max_tokens
        if token_util >= threshold:
            warnings["token_limit"] = {
                "output_tokens": output_tokens,
                "max_tokens": max_tokens,
                "utilization": round(token_util, 3),
                "hit_limit": stop_reason in ("max_tokens", "length"),
            }

    # Stop reason
    if stop_reason in ("max_tokens", "length"):
        warnings["truncated"] = True

    # Turn limit (for chains)
    if turns is not None and max_turns is not None and max_turns > 0:
        turn_util = turns / max_turns
        if turn_util >= threshold:
            warnings["turn_limit"] = {
                "turns": turns,
                "max_turns": max_turns,
                "utilization": round(turn_util, 3),
                "hit_limit": turns >= max_turns,
            }

    return warnings


def _build_cached_system_blocks(system_prompt: str) -> list[dict]:
    """Split system prompt into cacheable blocks using delimiters.

    Supports up to 3 blocks with 2 cache breakpoints:
    - Block 1: BSA knowledge (large, cached)
    - Block 2: Troop context (medium, cached)
    - Block 3: Persona instructions (small, uncached — varies per config)

    If only one delimiter present, falls back to 2 blocks.
    If no delimiters, caches the entire prompt.
    """
    # Try splitting at both delimiters
    if SYSTEM_PROMPT_DELIMITER in system_prompt and TROOP_CONTEXT_DELIMITER in system_prompt:
        first_split = system_prompt.split(SYSTEM_PROMPT_DELIMITER, 1)
        knowledge_block = first_split[0]
        rest = first_split[1]
        second_split = rest.split(TROOP_CONTEXT_DELIMITER, 1)
        troop_block = second_split[0]
        persona_block = second_split[1]
        return [
            {"type": "text", "text": knowledge_block,
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": troop_block,
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": persona_block},
        ]
    elif TROOP_CONTEXT_DELIMITER in system_prompt:
        # troop+websearch layer: no knowledge, just troop (cached) + persona
        parts = system_prompt.split(TROOP_CONTEXT_DELIMITER, 1)
        return [
            {"type": "text", "text": parts[0],
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": parts[1]},
        ]
    elif SYSTEM_PROMPT_DELIMITER in system_prompt:
        # knowledge-only: knowledge (cached) + persona
        parts = system_prompt.split(SYSTEM_PROMPT_DELIMITER, 1)
        return [
            {"type": "text", "text": parts[0],
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": parts[1]},
        ]
    else:
        # Single block (persona-only) — cache the whole thing
        return [
            {"type": "text", "text": system_prompt,
             "cache_control": {"type": "ephemeral"}},
        ]


def _make_anthropic_caller(config: RunConfig, usage: UsageTracker):
    """Anthropic API caller with prompt caching."""
    import httpx

    model_id = config.model_id
    thinking_budget = config.thinking.get("budget", 0) if config.thinking else 0
    adaptive_effort = config.adaptive_effort

    def call(messages, system_prompt, max_tokens=2500):
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        call._limits = {}  # Track limit proximity

        def do_call():
            system_value = _build_cached_system_blocks(system_prompt)

            effective_max = max_tokens
            body = {
                "model": model_id,
                "system": system_value,
                "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            }
            if adaptive_effort:
                effective_max = 16000
                body["max_tokens"] = effective_max
                body["thinking"] = {"type": "adaptive"}
                body["output_config"] = {"effort": adaptive_effort}
            elif thinking_budget > 0:
                effective_max = thinking_budget + max_tokens
                body["max_tokens"] = effective_max
                body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            else:
                body["max_tokens"] = effective_max

            resp = httpx.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json=body, timeout=180)
            d = resp.json()
            if "content" in d:
                text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
                u = d.get("usage", {})
                output_tokens = u.get("output_tokens", 0)
                cache_read = u.get("cache_read_input_tokens", 0)
                cache_create = u.get("cache_creation_input_tokens", 0)
                total_input = u.get("input_tokens", 0) + cache_read + cache_create
                usage.record(model_id,
                    input_tokens=total_input,
                    output_tokens=output_tokens,
                    cached_tokens=cache_read,
                    label=model_id,
                    extra={"cache_creation": cache_create})

                # Track limit proximity
                call._limits = _check_limits(
                    output_tokens=output_tokens,
                    max_tokens=effective_max,
                    stop_reason=d.get("stop_reason"),
                )

                if text_parts:
                    return text_parts[0]
                return d["content"][0].get("text", str(d["content"]))
            raise Exception(f"Anthropic error: {d.get('error', d)}")

        return _call_with_retry(do_call)

    return call


def _make_anthropic_tools_caller(config: RunConfig, usage: UsageTracker):
    """Anthropic caller with web search tool support."""
    import httpx

    model_id = config.model_id
    adaptive_effort = config.adaptive_effort

    WEB_SEARCH_TOOL = {
        "name": "web_search",
        "description": "Search the web for current BSA policy, merit badge requirements, scouting procedures, or other factual information.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search query"}},
            "required": ["query"],
        }
    }

    def call(messages, system_prompt, max_tokens=2500):
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        call._tool_log = []

        system_value = _build_cached_system_blocks(system_prompt)

        body = {
            "model": model_id,
            "system": system_value,
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            "max_tokens": max_tokens,
            "tools": [WEB_SEARCH_TOOL],
        }
        if adaptive_effort:
            body["max_tokens"] = 16000
            body["thinking"] = {"type": "adaptive"}
            body["output_config"] = {"effort": adaptive_effort}

        max_rounds = 6
        d = None
        for tool_round in range(max_rounds):
            resp = httpx.post("https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json=body, timeout=180)
            d = resp.json()
            if "error" in d:
                raise Exception(f"Anthropic error: {d['error']}")

            u = d.get("usage", {})
            cache_read = u.get("cache_read_input_tokens", 0)
            cache_create = u.get("cache_creation_input_tokens", 0)
            total_input = u.get("input_tokens", 0) + cache_read + cache_create
            usage.record(model_id,
                input_tokens=total_input,
                output_tokens=u.get("output_tokens", 0),
                cached_tokens=cache_read,
                label=model_id,
                extra={"cache_creation": cache_create})

            if d.get("stop_reason") == "tool_use" and "content" in d:
                tool_blocks = [b for b in d["content"] if b["type"] == "tool_use"]
                tool_results = []
                for tb in tool_blocks:
                    if tb["name"] == "web_search":
                        query = tb["input"].get("query", "")
                        sys.stdout.write(f"[search: {query[:40]}] ")
                        sys.stdout.flush()
                        search_result = _do_brave_search(query)
                        call._tool_log.append({
                            "tool": tb["name"], "query": query,
                            "result": search_result[:1000], "round": tool_round + 1,
                        })
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tb["id"],
                            "content": search_result,
                        })
                    else:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tb["id"],
                            "content": f"Tool '{tb['name']}' is not available.",
                            "is_error": True,
                        })
                body["messages"].append({"role": "assistant", "content": d["content"]})
                body["messages"].append({"role": "user", "content": tool_results})
                continue

            if "content" in d:
                text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
                if text_parts:
                    return "\n\n".join(text_parts)
                return str(d["content"])
            raise Exception(f"Anthropic error: {d}")

        # Max rounds
        sys.stdout.write("[max searches] ")
        if d and "content" in d:
            text_parts = [b["text"] for b in d["content"] if b.get("type") == "text"]
            if text_parts:
                return "\n\n".join(text_parts)
        return "[Model exhausted search attempts without producing a final answer]"

    return call


def _do_brave_search(query: str) -> str:
    """Call Brave Search API and return formatted results."""
    import httpx
    brave_key = os.environ.get("BRAVE_API_KEY", "")
    if not brave_key:
        # Try LibreChat .env
        from pathlib import Path
        env_path = Path("/home/devuser/LibreChat/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("BRAVE_API_KEY="):
                    brave_key = line.split("=", 1)[1].strip()
                    os.environ["BRAVE_API_KEY"] = brave_key
                    break
    if not brave_key:
        # Try GCP Secret Manager
        try:
            import subprocess
            brave_key = subprocess.check_output(
                ["gcloud", "secrets", "versions", "access", "latest",
                 "--secret", "brave-devbox", "--project", "hexapax-devbox"],
                text=True, timeout=5).strip()
            os.environ["BRAVE_API_KEY"] = brave_key
        except Exception:
            return "Web search unavailable — no API key."
    r = httpx.get("https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": 5},
        headers={"X-Subscription-Token": brave_key, "Accept": "application/json"},
        timeout=15)
    results = r.json().get("web", {}).get("results", [])
    if not results:
        return "No results found."
    return "\n\n".join(
        f"**{r['title']}**\n{r.get('description', '')}\nURL: {r.get('url', '')}"
        for r in results[:5]
    )


def _make_openai_compat_caller(config: RunConfig, usage: UsageTracker):
    """OpenAI-compatible API caller (OpenAI, DeepSeek, OpenRouter)."""
    import httpx

    model_id = config.model_id
    provider = config.provider
    use_completion_tokens = model_id.startswith("gpt-5")

    if provider == "deepseek":
        base_url, key_env = "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"
    elif provider == "openrouter":
        base_url, key_env = "https://openrouter.ai/api/v1", "OPENROUTER_KEY"
    elif provider == "xai":
        base_url, key_env = "https://api.x.ai/v1", "XAI_API_KEY"
    else:
        base_url, key_env = "https://api.openai.com/v1", "OPENAI_API_KEY"

    def call(messages, system_prompt, max_tokens=2500):
        key = os.environ.get(key_env, "")
        call._limits = {}

        def do_call():
            body = {
                "model": model_id,
                "messages": [{"role": "system", "content": system_prompt}] +
                            [{"role": m["role"], "content": m["content"]} for m in messages],
            }
            if use_completion_tokens:
                body["max_completion_tokens"] = max_tokens
            else:
                body["max_tokens"] = max_tokens

            resp = httpx.post(f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body, timeout=120)
            d = resp.json()
            if "choices" in d:
                u = d.get("usage", {})
                output_tokens = u.get("completion_tokens", 0)
                cached = u.get("prompt_tokens_details", {}).get("cached_tokens", 0)
                usage.record(model_id,
                    input_tokens=u.get("prompt_tokens", 0),
                    output_tokens=output_tokens,
                    cached_tokens=cached,
                    label=model_id)
                finish_reason = d["choices"][0].get("finish_reason")
                call._limits = _check_limits(
                    output_tokens=output_tokens,
                    max_tokens=max_tokens,
                    stop_reason=finish_reason,
                )
                return d["choices"][0]["message"]["content"]
            raise Exception(f"{provider} error: {d.get('error', d)}")

        return _call_with_retry(do_call)

    return call


def _make_gemini_caller(config: RunConfig, usage: UsageTracker):
    """Google Gemini API caller."""
    model_id = config.model_id

    def call(messages, system_prompt, max_tokens=2500):
        from google import genai
        from google.genai import types
        gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))
        call._limits = {}

        def do_call():
            resp = gc.models.generate_content(
                model=model_id,
                contents=messages[0]["content"],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=max_tokens,
                ))
            u = getattr(resp, "usage_metadata", None)
            output_tokens = 0
            if u:
                output_tokens = getattr(u, "candidates_token_count", 0) or 0
                usage.record(model_id,
                    input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                    output_tokens=output_tokens,
                    cached_tokens=getattr(u, "cached_content_token_count", 0) or 0,
                    label=model_id)

            # Check finish reason
            finish_reason = None
            if resp.candidates:
                fr = getattr(resp.candidates[0], "finish_reason", None)
                if fr and str(fr) == "MAX_TOKENS":
                    finish_reason = "max_tokens"

            call._limits = _check_limits(
                output_tokens=output_tokens,
                max_tokens=max_tokens,
                stop_reason=finish_reason,
            )

            text = resp.text
            if not text and resp.candidates:
                try:
                    candidate = resp.candidates[0]
                    if candidate.content and candidate.content.parts:
                        text = candidate.content.parts[0].text
                except (AttributeError, IndexError):
                    pass
            if not text:
                # Include finish reason for debugging
                fr = None
                if resp.candidates:
                    fr = getattr(resp.candidates[0], "finish_reason", None)
                raise Exception(f"Gemini returned empty response (finish_reason={fr})")
            return text

        return _call_with_retry(do_call)

    return call


# ---------------------------------------------------------------------------
# Knowledge perspective implementation
# ---------------------------------------------------------------------------

class KnowledgePerspective:
    """Knowledge, coaching & safety question evaluation."""

    name = "knowledge"
    description = "Knowledge, coaching & safety questions"
    # v7 is the canonical set since 2026-03-24 (alpha launch plan Stream D).
    # scout-coach-v5.yaml is archived in eval-sets/archived/.
    default_eval_set = "scout-eval-v7.yaml"

    def load_eval_set(self, yaml_path: str) -> EvalSetConfig:
        """Load knowledge eval set from YAML.

        If the path resolves to a missing file in eval-sets/ root but exists
        under eval-sets/archived/, emit a deprecation warning and use the
        archived copy (rather than hard-failing). This keeps historical
        re-runs working while nudging users toward the canonical v7 set.
        """
        path = Path(yaml_path)
        if not path.is_absolute():
            path = EVAL_SET_DIR / path
        if not path.exists():
            archived_path = EVAL_SET_DIR / "archived" / path.name
            if archived_path.exists():
                import sys as _sys
                _sys.stderr.write(
                    f"\n[DEPRECATION] Eval set '{path.name}' lives in "
                    f"eval-sets/archived/. Falling back to archived copy.\n"
                    f"  Canonical set: eval-sets/scout-eval-v7.yaml\n"
                    f"  Pass 'archived/{path.name}' to silence this warning.\n\n"
                )
                path = archived_path
        return load_eval_set_yaml(str(path))

    def resolve_items(self, eval_set: EvalSetConfig, filters: dict) -> list[EvalItem]:
        """Resolve questions from eval set with filtering."""
        raw_questions = eval_set.raw.get("questions", [])
        items: list[EvalItem] = []

        for q in raw_questions:
            if not q.get("enabled", True):
                continue
            # Use domain as category if available (v6+), fallback to category (v5)
            cat = q.get("domain", q.get("category", ""))
            items.append(EvalItem(
                id=q["id"],
                perspective=eval_set.perspective,
                item_type="question",
                category=cat,
                description=q.get("question", ""),
                expected=q.get("expected", ""),
                eval_notes=q.get("eval_notes", ""),
                question_type=q.get("question_type", ""),
                metadata={
                    "domain": q.get("domain"),
                    "capabilities": q.get("capabilities", []),
                    "dimensions": q.get("dimensions", []),
                    "max_turns": q.get("max_turns", 3),
                    "endpoint": q.get("endpoint", "scout"),
                    **({"fixtures": q["fixtures"]} if "fixtures" in q else {}),
                    **({"follow_ups": q["follow_ups"]} if "follow_ups" in q else {}),
                    **({"expected_tools": q["expected_tools"]} if "expected_tools" in q else {}),
                    **({"expected_not_tools": q["expected_not_tools"]} if "expected_not_tools" in q else {}),
                    **({"eval_context": q["eval_context"]} if "eval_context" in q else {}),
                    **({"eval_weights": q["eval_weights"]} if "eval_weights" in q else {}),
                },
            ))

        # Resolve chain steps as items (if --chain filter or chains present)
        chain_filter = filters.get("chain")
        for chain_def in eval_set.raw.get("chains", []):
            if chain_filter and chain_def.get("id") != chain_filter:
                continue
            if not chain_filter:
                continue  # Only include chains when explicitly requested with --chain
            for step_idx, step in enumerate(chain_def.get("steps", [])):
                step_id = f"{chain_def['id']}/{step['id']}"
                items.append(EvalItem(
                    id=step_id,
                    perspective=eval_set.perspective,
                    item_type="chain_step",
                    category="chain",
                    description=step.get("initial_message", ""),
                    expected=step.get("eval_context", ""),
                    metadata={
                        "domain": "state_tracking",
                        "dimensions": step.get("dimensions", ["tool_accuracy", "state_awareness", "coaching"]),
                        "max_turns": step.get("max_turns", 6),
                        "endpoint": chain_def.get("endpoint", "scout"),
                        "chain_id": chain_def["id"],
                        "chain_step": step["id"],
                        "chain_step_index": step_idx,
                        "chain_fixtures": chain_def.get("fixtures"),
                        "pre_mutations": step.get("pre_mutations"),
                        "expected_tools": step.get("expected_tools"),
                        "expected_state": step.get("expected_state"),
                        **({"follow_ups": {"scout_sim_prompt": step["scout_sim_prompt"]}} if "scout_sim_prompt" in step else {}),
                        **({"eval_context": step["eval_context"]} if "eval_context" in step else {}),
                    },
                ))

        # Apply filters
        category = filters.get("category")
        if category and category != "all":
            cats = [c.strip() for c in category.split(",")]
            # Match by category OR domain (case-insensitive for old A-G style)
            items = [i for i in items if i.category in cats
                     or i.category.upper() in [c.upper() for c in cats]
                     or i.metadata.get("domain") in cats]

        questions = filters.get("questions")
        if questions:
            qids = [q.strip() for q in questions.split(",")]
            items = [i for i in items if i.id in qids]

        sample = filters.get("sample")
        if sample and not questions:
            import random
            random.seed(42)
            by_cat: dict[str, list[EvalItem]] = {}
            for item in items:
                by_cat.setdefault(item.category, []).append(item)
            sampled = []
            for cat in sorted(by_cat):
                pool = by_cat[cat]
                n = min(sample, len(pool))
                sampled.extend(random.sample(pool, n))
            items = sampled

        return items

    def execute(self, item: EvalItem, config: RunConfig,
                usage: UsageTracker | None = None, **kwargs) -> ExecutionResult:
        """Execute a single question or chain step against the model.

        Uses the unified EvalEngine which handles tool dispatch for all providers.
        For chain steps, accepts shared_state kwarg to persist DB across steps.
        """
        if usage is None:
            usage = UsageTracker()

        from eval_engine import EvalEngine
        from eval_tools import ToolRegistry, TestState
        from eval_layers import get_layer, LayerConfig

        layer = get_layer(config.layer)

        # Determine endpoint from item metadata (scout or guide)
        endpoint = item.metadata.get("endpoint", "scout") if item.metadata else "scout"

        # For guide endpoint, override authorized tools to guide tool set
        if endpoint == "guide":
            from eval_tools import ALL_GUIDE_TOOL_NAMES
            layer = LayerConfig(
                name=layer.name,
                label=layer.label,
                include_knowledge=layer.include_knowledge,
                include_troop=layer.include_troop,
                include_tool_instructions=layer.include_tool_instructions,
                authorized_tools=ALL_GUIDE_TOOL_NAMES if layer.authorized_tools else set(),
            )

        # Chain steps share state; standalone questions get fresh state
        shared_state = kwargs.get("shared_state")
        owns_state = shared_state is None

        if shared_state:
            test_state = shared_state
            # Apply pre-mutations for chain steps
            pre_mutations = item.metadata.get("pre_mutations") or []
            for mut in pre_mutations:
                test_state.apply_mutation(mut)
            # Snapshot before execution (for chain diff)
            db_before = test_state.snapshot()
            tools = ToolRegistry(test_state=test_state, endpoint=endpoint)
        else:
            test_id = f"{item.id}_{int(time.time())}"
            test_state = TestState(test_id=test_id)
            custom_fixtures = item.metadata.get("fixtures") or item.metadata.get("chain_fixtures")
            tools = ToolRegistry(test_state=test_state, fixtures=custom_fixtures, endpoint=endpoint)
            db_before = None

        engine = EvalEngine(config, layer, tools, usage)
        max_turns = item.metadata.get("max_turns", 3)
        try:
            result = engine.run(item, max_turns=max_turns)

            # For chain steps, capture state diff
            if shared_state and db_before:
                db_after = test_state.snapshot()
                result.raw_data["db_before"] = db_before
                result.raw_data["db_after"] = db_after
                result.raw_data["db_diff"] = TestState.diff_snapshots(db_before, db_after)

            return result
        finally:
            if owns_state:
                test_state.cleanup()

    def format_for_evaluation(self, result: ExecutionResult) -> tuple[str, str]:
        """Format for panel evaluator: (tool calls then response, question+expected).

        Execution order reflects reality: tools are called FIRST (the model needs
        their results to answer), THEN the final response is generated from those
        results. Presenting tools before the response prevents the scorer from
        falsely inferring "response first, tool second" — which looked like a
        fabrication pattern but was just a display artifact.
        """
        item = result.item
        parts: list[str] = []

        # Tool calls happened FIRST in execution order — show them first
        tool_calls = result.raw_data.get("tool_calls", [])
        if tool_calls:
            tool_lines = [
                "--- TOOLS CALLED (in execution order, BEFORE the final response below) ---"
            ]
            for tc in tool_calls:
                if isinstance(tc, dict):
                    name = tc.get("name", "?")
                    auth = "OK" if tc.get("authorized", True) else "DENIED"
                    args = tc.get("args", {})
                    result_text = tc.get("result", {})
                    if isinstance(result_text, dict):
                        result_text = result_text.get("result") or result_text.get("error", "")
                    tool_lines.append(f"- {name}({args}) [{auth}] → {str(result_text)[:6000]}")
            parts.append("\n".join(tool_lines))

        unauthorized = result.raw_data.get("unauthorized_calls", [])
        if unauthorized:
            unauth_lines = ["--- UNAUTHORIZED TOOL CALLS (model tried but layer denied) ---"]
            for tc in unauthorized:
                if isinstance(tc, dict):
                    unauth_lines.append(f"- {tc.get('name', '?')}({tc.get('args', {})}) → DENIED")
            parts.append("\n".join(unauth_lines))

        # Final response comes AFTER tool calls — this is what the scout saw
        if parts:
            parts.append("--- FINAL RESPONSE TO THE SCOUT ---")
        parts.append(result.response_text)
        content = "\n\n".join(parts)

        context = (
            f"QUESTION: {item.description}\n\n"
            f"EXPECTED: {item.expected}"
        )

        # Filter tool_accuracy out of dimensions when the backend lacks the required tools
        tool_check = result.raw_data.get("expected_tools_check")
        dimensions = list(item.metadata.get("dimensions") or [])
        if tool_check and tool_check.get("skipped") and "tool_accuracy" in dimensions:
            dimensions = [d for d in dimensions if d != "tool_accuracy"]

        if dimensions:
            context += f"\n\nAPPLICABLE DIMENSIONS: {', '.join(dimensions)}"
        if item.metadata.get("eval_context"):
            context += f"\n\nEVALUATOR CONTEXT: {item.metadata['eval_context']}"

        # Include expected tools check result if available
        if tool_check:
            if tool_check.get("skipped"):
                context += f"\n\nEXPECTED TOOLS CHECK: SKIPPED — {tool_check.get('reason','')}"
                context += "\nDo NOT score tool_accuracy for this question (backend lacks required tools)."
            else:
                status = "PASS" if tool_check["pass"] else "FAIL"
                context += f"\n\nEXPECTED TOOLS CHECK: {status}"
                if tool_check.get("missed"):
                    context += f" (missed: {', '.join(tool_check['missed'])})"
                if tool_check.get("violated"):
                    context += f" (should not have called: {', '.join(tool_check['violated'])})"

        return content, context

    def to_mongo_doc(self, scored: ScoredResult, run_id: str,
                     eval_version: str, system_version: str) -> dict:
        """Convert to MongoDB document with all config axes."""
        item = scored.execution.item
        config = scored.execution.config
        response = scored.execution.response_text
        resp_hash = hashlib.sha256(response.encode()).hexdigest()[:16]

        doc = {
            # Perspective
            "perspective": "knowledge",

            # Run identity
            "run_id": run_id,
            "eval_version": eval_version,
            "system_version": system_version,
            "evaluator": "panel",

            # Config axes (all independently queryable)
            **config.to_mongo_fields(),

            # Item
            "question_id": item.id,
            "item_type": "question",
            "category": item.category,
            "question_type": item.question_type,
            "domain": item.metadata.get("domain") or item.category,
            "capabilities": item.metadata.get("capabilities", []),
            "applicable_dimensions": item.metadata.get("dimensions", []),
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

            # Extras
            "tool_calls": scored.execution.raw_data.get("tool_calls"),
            "turn_timings": scored.execution.raw_data.get("turn_timings"),
            "turn_count": scored.execution.raw_data.get("turn_count", 1),
            "limits": scored.execution.raw_data.get("limits") or None,
            "chain_metadata": None,
            "timing_ms": scored.execution.timing_ms,
            "timestamp": datetime.now(timezone.utc),
        }

        # Include error if execution failed
        if scored.execution.error:
            doc["error"] = scored.execution.error

        return doc


# Register
PerspectiveRegistry.register(KnowledgePerspective())
