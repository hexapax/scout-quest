"""Unified eval engine — handles single-turn through multi-turn conversations.

Replaces the direct model callers in perspectives/knowledge.py with a
conversation-loop engine that handles tool dispatch. The engine:

1. Builds the system prompt from the layer config
2. Sends the user message to the model with ALL tools registered
3. Handles tool_use responses: checks authorization, executes or rejects
4. Feeds tool results back and continues until the model stops
5. Returns the full transcript with tool call log

Currently supports Anthropic models for tool dispatch. Non-Anthropic
models fall back to single-call without tools.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

# Add parent dir for imports
sys.path.insert(0, str(Path(__file__).parent))

from eval_framework import EvalItem, ExecutionResult, RunConfig
from eval_tools import ToolRegistry
from eval_layers import LayerConfig
from eval_panel import UsageTracker, _call_with_retry, BudgetExceeded

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Import prompt-building helpers from knowledge perspective
# ---------------------------------------------------------------------------

from perspectives.knowledge import (
    _build_cached_system_blocks,
    _check_limits,
)


# ---------------------------------------------------------------------------
# EvalEngine
# ---------------------------------------------------------------------------

def _auto_respond(assistant_text: str, turn: int, question: str = "") -> str | None:
    """Use a cheap LLM to decide if the response needs a follow-up.

    A coach using Socratic method might ask a question instead of answering
    directly. The scout should respond naturally so the coach can continue.

    Returns None if the response is complete (no follow-up needed).
    Returns a short scout reply if the coach asked a question or gave
    an incomplete opener.

    Uses GPT-4.1-nano (~$0.001 per call) for the decision + response.
    """
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        # Fallback: simple heuristic
        text = assistant_text.strip()
        if text.endswith("?") and len(text) < 500:
            return "Yeah, I guess so. Can you tell me more?"
        if len(text) < 200 and turn == 0:
            return "Can you tell me more about that?"
        return None

    prompt = f"""You are a 14-year-old Boy Scout in a conversation with your AI coaching assistant.
The coach just responded to your question. Decide:

1. Did the coach give a COMPLETE answer? (explained the topic, gave specific info, addressed your concern)
2. Or did the coach ask YOU a question / give a brief opener that needs a reply to continue?

If COMPLETE: respond with exactly "DONE" (nothing else).
If NEEDS REPLY: respond as the scout would — casual, brief, age-appropriate. 1-2 sentences max.
Be natural. A teen would say "yeah" or "I dunno" not "Thank you for asking."

YOUR ORIGINAL QUESTION: {question}

COACH'S RESPONSE:
{assistant_text[:1000]}"""

    try:
        r = httpx.post("https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": "gpt-4.1-nano", "max_tokens": 100,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=30)
        d = r.json()
        if "choices" in d:
            reply = d["choices"][0]["message"]["content"].strip()
            upper = reply.upper()
            if upper == "DONE" or upper.startswith("DONE"):
                return None
            # Clean up — remove quotes, meta-responses
            reply = reply.strip('"').strip("'")
            # Filter out meta-responses like "NEEDS REPLY" that aren't actual scout speech
            if reply.upper().startswith("NEEDS") or reply.upper().startswith("INCOMPLETE"):
                return "Yeah... can you tell me more?"
            return reply if len(reply) > 2 else None
    except Exception:
        pass

    # Fallback on error
    return None


class EvalEngine:
    """Unified eval engine — handles single-turn through multi-session.

    For each eval item:
    1. Build system prompt from layer config
    2. Send initial message with ALL tools registered
    3. Handle tool_use loop (authorized tools execute, unauthorized return error)
    4. Log ALL tool calls (authorized or not)
    5. Return ExecutionResult with full transcript and tool call log
    """

    def __init__(
        self,
        config: RunConfig,
        layer: LayerConfig,
        tools: ToolRegistry,
        usage: UsageTracker,
    ):
        self.config = config
        self.layer = layer
        self.tools = tools
        self.usage = usage

    def run(self, item: EvalItem, max_turns: int = 1) -> ExecutionResult:
        """Run an eval item through the engine.

        Args:
            item: The eval item (question, scenario, etc.)
            max_turns: Maximum conversation turns (1 for single-turn Q&A)

        Returns:
            ExecutionResult with response text, tool call log, and transcript
        """
        start = time.time()

        # Seed with question-specific fixtures if available
        if hasattr(self.tools, 'test_state') and self.tools.test_state is not None:
            fixtures = item.metadata.get("fixtures") if item.metadata else None
            if fixtures:
                self.tools.test_state.seed(fixtures)

        try:
            # Non-Anthropic providers: fall back to legacy single-call without tools
            # TODO: Add multi-provider tool support (OpenAI, Gemini, DeepSeek tool_call APIs)
            if self.config.provider != "anthropic":
                result = self._run_legacy(item, start)
            else:
                result = self._run_anthropic(item, max_turns, start)

            # Capture final state snapshot if we have a test state
            if hasattr(self.tools, 'test_state') and self.tools.test_state is not None:
                result.raw_data["db_snapshot"] = self.tools.test_state.snapshot()

            return result

        except BudgetExceeded:
            raise
        except Exception as e:
            elapsed_ms = int((time.time() - start) * 1000)
            return ExecutionResult(
                item=item,
                config=self.config,
                response_text="",
                raw_data={},
                timing_ms=elapsed_ms,
                error=str(e)[:500],
            )

    def _run_anthropic(self, item: EvalItem, max_turns: int, start: float) -> ExecutionResult:
        """Run with Anthropic API, full tool dispatch support."""
        # 1. Build system prompt from layer config
        system_prompt = self.layer.build_system_prompt(self.config)

        # 2. Build cached system blocks for Anthropic
        system_blocks = _build_cached_system_blocks(system_prompt)

        # 3. Conversation loop
        messages: list[dict] = []
        transcript: list[dict] = []
        tool_call_log: list[dict] = []
        unauthorized_calls: list[dict] = []
        limits: dict = {}

        user_msg = item.description  # The question

        assistant_text = ""

        for turn in range(max_turns):
            messages.append({"role": "user", "content": user_msg})

            # Call model with ALL tools registered
            response = self._call_model(system_blocks, messages)

            # Handle tool use loop (model may call tools multiple times)
            max_tool_rounds = 10  # Safety limit
            tool_round = 0
            while response.get("stop_reason") == "tool_use" and tool_round < max_tool_rounds:
                tool_round += 1
                tool_blocks = [b for b in response.get("content", []) if b.get("type") == "tool_use"]
                tool_results = []

                for tb in tool_blocks:
                    tool_name = tb["name"]
                    tool_args = tb.get("input", {})
                    authorized = self.layer.is_authorized(tool_name)
                    result = self.tools.execute(tool_name, tool_args, authorized)

                    # Log ALL calls (authorized or not)
                    call_record = {
                        "name": tool_name,
                        "args": tool_args,
                        "result": result,
                        "authorized": authorized,
                        "round": tool_round,
                    }
                    tool_call_log.append(call_record)
                    if not authorized:
                        unauthorized_calls.append(call_record)

                    # Print tool call for progress tracking
                    status = "OK" if authorized else "DENIED"
                    sys.stdout.write(f"[tool: {tool_name} ({status})] ")
                    sys.stdout.flush()

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tb["id"],
                        "content": result.get("error") or result.get("result", ""),
                        "is_error": "error" in result,
                    })

                # Feed results back to the model
                messages.append({"role": "assistant", "content": response["content"]})
                messages.append({"role": "user", "content": tool_results})
                response = self._call_model(system_blocks, messages)

            # Extract text response from final response
            text_parts = [
                b["text"] for b in response.get("content", [])
                if b.get("type") == "text"
            ]
            assistant_text = "\n".join(text_parts)

            # Record transcript — capture tool calls from THIS turn only
            turn_tool_calls = tool_call_log[len(transcript) // 2 * 0:]  # approximate
            transcript.append({"role": "user", "content": user_msg})
            transcript.append({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": list(tool_call_log),  # full log for this entry
            })

            # Append to messages for potential multi-turn
            messages.append({"role": "assistant", "content": response.get("content", [])})

            # Check limit proximity
            u = response.get("usage", {})
            output_tokens = u.get("output_tokens", 0)
            effective_max = self.config.max_tokens
            if self.config.adaptive_effort:
                effective_max = 16000
            elif self.config.thinking:
                budget = self.config.thinking.get("budget", 4000)
                effective_max = budget + self.config.max_tokens

            limits = _check_limits(
                output_tokens=output_tokens,
                max_tokens=effective_max,
                stop_reason=response.get("stop_reason"),
            )

            if limits:
                limit_parts = []
                if "truncated" in limits:
                    limit_parts.append("TRUNCATED (hit max_tokens)")
                if "token_limit" in limits:
                    tl = limits["token_limit"]
                    limit_parts.append(f"tokens: {tl['output_tokens']}/{tl['max_tokens']} ({tl['utilization']:.0%})")
                if limit_parts:
                    sys.stdout.write(f" [LIMIT: {', '.join(limit_parts)}]")

            # Single turn: done after first response
            if max_turns == 1:
                break

            # Multi-turn: ask a cheap LLM if the response needs a follow-up
            # Catches Socratic openers and lets the model deliver substance
            follow_up = _auto_respond(assistant_text, turn, question=item.description)
            if follow_up is None:
                break  # Model gave a complete answer, no need to continue

            user_msg = follow_up
            messages.append({"role": "user", "content": user_msg})
            transcript.append({"role": "user", "content": user_msg})
            sys.stdout.write(f" [turn {turn+2}]")

        elapsed_ms = int((time.time() - start) * 1000)

        # Build response_text: for single-turn, just the assistant text.
        # For multi-turn, format the full conversation so the panel sees everything.
        turn_count = len([t for t in transcript if t["role"] == "user"])
        if turn_count > 1:
            # Format full conversation for the evaluator
            parts = []
            for entry in transcript:
                role = entry["role"].upper()
                label = "SCOUT" if role == "USER" else "COACH"
                parts.append(f"[{label}]: {entry['content']}")
                # Include tool calls in coach turns
                for tc in entry.get("tool_calls", []):
                    status = "OK" if tc.get("authorized", True) else "DENIED"
                    result_text = tc.get("result", {})
                    if isinstance(result_text, dict):
                        result_text = result_text.get("result") or result_text.get("error", "")
                    parts.append(f"  [TOOL CALL ({status})] {tc['name']}({tc.get('args',{})}) → {str(result_text)[:200]}")
            response_text = "\n\n".join(parts)
        else:
            response_text = assistant_text

        return ExecutionResult(
            item=item,
            config=self.config,
            response_text=response_text,
            raw_data={
                "tool_calls": tool_call_log,
                "unauthorized_calls": unauthorized_calls,
                "transcript": transcript,
                "turn_count": turn_count,
                "limits": limits,
            },
            timing_ms=elapsed_ms,
        )

    def _run_legacy(self, item: EvalItem, start: float) -> ExecutionResult:
        """Fall back to legacy single-call for non-Anthropic providers.

        Uses the existing model callers from knowledge.py which handle
        OpenAI, Gemini, and DeepSeek APIs without tool dispatch.

        TODO: Add tool_call support for OpenAI/Gemini/DeepSeek APIs.
        These APIs have their own tool_call formats that differ from
        Anthropic's tool_use blocks. For now, non-Anthropic models
        run single-turn without tools.
        """
        from perspectives.knowledge import _make_caller, build_system_prompt

        system_prompt = self.layer.build_system_prompt(self.config)
        caller = _make_caller(self.config, self.usage)

        def do_call():
            return caller(
                [{"role": "user", "content": item.description}],
                system_prompt,
                max_tokens=self.config.max_tokens,
            )

        response = _call_with_retry(do_call)
        elapsed_ms = int((time.time() - start) * 1000)

        # Capture tool call log if present (web search caller)
        tool_calls = getattr(caller, "_tool_log", None) or []
        limits = getattr(caller, "_limits", {})

        if limits:
            limit_parts = []
            if "truncated" in limits:
                limit_parts.append("TRUNCATED (hit max_tokens)")
            if "token_limit" in limits:
                tl = limits["token_limit"]
                limit_parts.append(f"tokens: {tl['output_tokens']}/{tl['max_tokens']} ({tl['utilization']:.0%})")
            if limit_parts:
                sys.stdout.write(f" [LIMIT: {', '.join(limit_parts)}]")

        return ExecutionResult(
            item=item,
            config=self.config,
            response_text=response,
            raw_data={
                "tool_calls": tool_calls,
                "unauthorized_calls": [],
                "transcript": [
                    {"role": "user", "content": item.description},
                    {"role": "assistant", "content": response},
                ],
                "turn_count": 1,
                "limits": limits,
            },
            timing_ms=elapsed_ms,
        )

    def _call_model(self, system_blocks: list[dict], messages: list[dict]) -> dict:
        """Call the Anthropic API with tools.

        Args:
            system_blocks: Cached system prompt blocks
            messages: Conversation history

        Returns:
            Raw API response dict
        """
        import httpx

        key = os.environ.get("ANTHROPIC_API_KEY", "")

        body: dict[str, Any] = {
            "model": self.config.model_id,
            "system": system_blocks,
            "messages": self._convert_messages(messages),
            "max_tokens": self.config.max_tokens,
            "tools": self.tools.all_definitions(),
        }

        # Handle thinking/adaptive configs
        if self.config.adaptive_effort:
            body["max_tokens"] = 16000
            body["thinking"] = {"type": "adaptive"}
            body["output_config"] = {"effort": self.config.adaptive_effort}
        elif self.config.thinking:
            budget = self.config.thinking.get("budget", 4000)
            body["max_tokens"] = budget + self.config.max_tokens
            body["thinking"] = {"type": "enabled", "budget_tokens": budget}

        def do_api_call():
            resp = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=body,
                timeout=180,
            )
            d = resp.json()

            if "error" in d:
                raise Exception(f"API error: {d['error']}")

            # Track usage
            u = d.get("usage", {})
            cache_read = u.get("cache_read_input_tokens", 0)
            cache_create = u.get("cache_creation_input_tokens", 0)
            total_input = u.get("input_tokens", 0) + cache_read + cache_create
            self.usage.record(
                self.config.model_id,
                input_tokens=total_input,
                output_tokens=u.get("output_tokens", 0),
                cached_tokens=cache_read,
                label=self.config.model_id,
                extra={"cache_creation": cache_create},
            )

            return d

        return _call_with_retry(do_api_call)

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Convert internal message format to Anthropic API format.

        Messages may contain tool_result blocks (lists) which are
        already in Anthropic format. String content messages get
        wrapped normally.
        """
        converted = []
        for msg in messages:
            if isinstance(msg.get("content"), list):
                # Already in Anthropic format (tool results or content blocks)
                converted.append(msg)
            else:
                converted.append({
                    "role": msg["role"],
                    "content": msg["content"],
                })
        return converted
