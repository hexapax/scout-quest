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

def _auto_respond(assistant_text: str, turn: int, question: str = "",
                   transcript: list[dict] | None = None,
                   scout_context: str = "") -> str | None:
    """Simulate a scout's reply in a multi-turn conversation.

    Uses a cheap LLM to role-play the scout based on the full conversation
    history, their original question, and their personality/state.

    Returns None if the conversation feels complete (coach gave a thorough answer).
    Returns an in-character scout reply to keep the conversation going.

    Uses GPT-4.1-nano (~$0.001 per call).
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

    # Build conversation history for context
    convo_block = ""
    if transcript:
        lines = []
        for entry in transcript[-6:]:  # Last 3 exchanges max
            role = "SCOUT" if entry["role"] == "user" else "COACH"
            lines.append(f"[{role}]: {entry['content'][:400]}")
        convo_block = "\n".join(lines)
    else:
        convo_block = f"[SCOUT]: {question}\n[COACH]: {assistant_text[:800]}"

    # After turn 2, lean toward ending the conversation
    turn_guidance = ""
    if turn >= 2:
        turn_guidance = """
This is turn 3+. Only continue if the coach asked a DIRECT question or left something clearly unfinished.
If the coach gave a solid answer with specific info, say DONE. Don't drag it out."""

    prompt = f"""You are Will, a 14-year-old Boy Scout. You like gaming and building PCs.
You're chatty but not formal. You say "yeah", "cool", "wait really?", "huh ok".
You DON'T say "Thank you for the information" or "That's very helpful."

{scout_context}

CONVERSATION SO FAR:
{convo_block}

COACH'S LATEST RESPONSE:
{assistant_text[:1000]}

INSTRUCTIONS:
- If the coach gave a COMPLETE, detailed answer → respond "DONE"
- If the coach asked you a question → answer it naturally as Will would
- If the coach suggested something → react genuinely (excited, skeptical, curious)
- If the coach mentioned specific badges/requirements → respond about whether you're interested or not
- Keep it to 1-2 sentences. Be a real teenager, not a polite robot.
{turn_guidance}

YOUR REPLY (or "DONE"):"""

    try:
        r = httpx.post("https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": "gpt-4.1-nano", "max_tokens": 120,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=30)
        d = r.json()
        if "choices" in d:
            reply = d["choices"][0]["message"]["content"].strip()
            upper = reply.upper()
            if upper == "DONE" or upper.startswith("DONE"):
                return None
            # Clean up — remove quotes, meta-responses, labels
            reply = reply.strip('"').strip("'")
            if reply.upper().startswith("NEEDS") or reply.upper().startswith("INCOMPLETE"):
                return None  # Don't fake it
            if reply.upper().startswith("[SCOUT]"):
                reply = reply[7:].strip(": ")
            return reply if len(reply) > 2 else None
    except Exception:
        pass

    # Fallback on error
    return None


def _build_scout_context(item: EvalItem) -> str:
    """Build a brief scout personality/state summary for the auto-responder."""
    parts = []
    fixtures = item.metadata.get("fixtures", {}) if item.metadata else {}
    reqs = fixtures.get("requirements", [])
    if reqs:
        badges = {}
        for r in reqs:
            b = r.get("badge", "unknown")
            badges.setdefault(b, []).append(r.get("status", ""))
        badge_summary = []
        for b, statuses in badges.items():
            done = statuses.count("signed_off")
            total = len(statuses)
            badge_summary.append(f"{b.replace('_', ' ').title()} ({done}/{total} done)")
        parts.append("Active badges: " + ", ".join(badge_summary))
    if item.metadata.get("domain"):
        parts.append(f"Topic: {item.metadata['domain'].replace('_', ' ')}")
    return "\n".join(parts)


def _scout_sim_respond(assistant_text: str, turn: int, sim_prompt: str,
                        transcript: list[dict] | None = None) -> str | None:
    """Use a scenario-specific scout simulator for deterministic multi-turn.

    Unlike _auto_respond which uses a generic Will persona, this uses the
    question's scout_sim_prompt to drive targeted, scenario-appropriate behavior.
    Used for tool workflow questions where the scout needs to provide specific data.

    Returns None if the conversation is complete.
    """
    import httpx

    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        return None

    # Build conversation for the simulator
    convo_block = ""
    if transcript:
        lines = []
        for entry in transcript[-8:]:
            role = "SCOUT" if entry["role"] == "user" else "COACH"
            lines.append(f"[{role}]: {entry['content'][:500]}")
        convo_block = "\n".join(lines)

    turn_guidance = ""
    if turn >= 3:
        turn_guidance = "\nThis is turn 4+. Wrap up unless the coach is clearly still working on something."

    prompt = f"""{sim_prompt}

CONVERSATION SO FAR:
{convo_block}

COACH'S LATEST RESPONSE:
{assistant_text[:1200]}

Reply as the scout described above. If the conversation is complete, say "DONE".
Keep it to 1-3 sentences. Be natural.{turn_guidance}

YOUR REPLY (or "DONE"):"""

    try:
        r = httpx.post("https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": "gpt-4.1-nano", "max_tokens": 150,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=30)
        d = r.json()
        if "choices" in d:
            reply = d["choices"][0]["message"]["content"].strip()
            if reply.upper().startswith("DONE"):
                return None
            reply = reply.strip('"').strip("'")
            if reply.upper().startswith("[SCOUT]"):
                reply = reply[7:].strip(": ")
            return reply if len(reply) > 2 else None
    except Exception:
        pass
    return None


def _check_expected_tools(tool_call_log: list[dict],
                           expected: list[str] | None,
                           not_expected: list[str] | None = None) -> dict | None:
    """Compare actual tool calls against expected tools.

    Returns None if no expectations defined. Otherwise returns:
    {expected, called, missed, unexpected, pass}
    """
    if not expected and not not_expected:
        return None

    actual_tools = set()
    for tc in tool_call_log:
        if tc.get("authorized", True):
            actual_tools.add(tc["name"])

    result = {"actual": sorted(actual_tools)}

    if expected:
        called = actual_tools & set(expected)
        missed = set(expected) - actual_tools
        result["expected"] = expected
        result["called"] = sorted(called)
        result["missed"] = sorted(missed)

    if not_expected:
        violated = actual_tools & set(not_expected)
        result["not_expected"] = not_expected
        result["violated"] = sorted(violated)

    result["pass"] = (
        (not expected or len(set(expected) - actual_tools) == 0) and
        (not not_expected or len(actual_tools & set(not_expected)) == 0)
    )
    return result


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
        # Detect endpoint from ToolRegistry for system prompt selection
        self.endpoint = getattr(tools, "endpoint", "scout")

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
            # Route to provider-specific engine
            if self.config.provider == "anthropic":
                result = self._run_anthropic(item, max_turns, start)
            elif self.config.provider in ("openai", "deepseek", "openrouter", "xai"):
                result = self._run_openai_compat(item, max_turns, start)
            elif self.config.provider == "google":
                result = self._run_gemini(item, max_turns, start)
            else:
                result = self._run_legacy(item, start)

            # Capture final state snapshot if we have a test state
            if hasattr(self.tools, 'test_state') and self.tools.test_state is not None:
                result.raw_data["db_snapshot"] = self.tools.test_state.snapshot()

            # Check expected tools if defined on the question
            if item.metadata:
                expected = item.metadata.get("expected_tools")
                not_expected = item.metadata.get("expected_not_tools")
                tool_check = _check_expected_tools(
                    result.raw_data.get("tool_calls", []),
                    expected, not_expected)
                if tool_check is not None:
                    result.raw_data["expected_tools_check"] = tool_check

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
        system_prompt = self.layer.build_system_prompt(self.config, endpoint=self.endpoint)

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
        turn_timings: list[dict] = []

        for turn in range(max_turns):
            turn_start = time.time()
            messages.append({"role": "user", "content": user_msg})

            # Call model with ALL tools registered
            call_start = time.time()
            response = self._call_model(system_blocks, messages)
            call_ms = int((time.time() - call_start) * 1000)

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
                    tool_start = time.time()
                    authorized = self.layer.is_authorized(tool_name)
                    result = self.tools.execute(tool_name, tool_args, authorized)
                    tool_ms = int((time.time() - tool_start) * 1000)

                    # Log ALL calls (authorized or not)
                    call_record = {
                        "name": tool_name,
                        "args": tool_args,
                        "result": result,
                        "authorized": authorized,
                        "round": tool_round,
                        "timing_ms": tool_ms,
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
                call_start = time.time()
                response = self._call_model(system_blocks, messages)
                call_ms = int((time.time() - call_start) * 1000)

            # Extract text response from final response
            text_parts = [
                b["text"] for b in response.get("content", [])
                if b.get("type") == "text"
            ]
            assistant_text = "\n".join(text_parts)
            turn_ms = int((time.time() - turn_start) * 1000)

            # Record transcript with per-turn timing
            turn_timings.append({"turn": turn + 1, "timing_ms": turn_ms, "api_call_ms": call_ms})
            transcript.append({"role": "user", "content": user_msg})
            transcript.append({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": list(tool_call_log),
                "timing_ms": turn_ms,
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
            sim_config = item.metadata.get("follow_ups") if item.metadata else None
            if sim_config and sim_config.get("scout_sim_prompt"):
                follow_up = _scout_sim_respond(
                    assistant_text, turn, sim_prompt=sim_config["scout_sim_prompt"],
                    transcript=transcript)
            else:
                follow_up = _auto_respond(assistant_text, turn, question=item.description,
                                          transcript=transcript, scout_context=_build_scout_context(item))
            if follow_up is None:
                break  # Model gave a complete answer, no need to continue

            user_msg = follow_up
            # Note: user_msg is appended to messages at the top of the next loop iteration (line 202)
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
                "turn_timings": turn_timings,
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

        system_prompt = self.layer.build_system_prompt(self.config, endpoint=self.endpoint)
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

    def _run_openai_compat(self, item: EvalItem, max_turns: int, start: float) -> ExecutionResult:
        """Multi-turn engine for OpenAI-compatible APIs (OpenAI, DeepSeek, OpenRouter).

        Supports tool_call format used by OpenAI, DeepSeek, and OpenRouter.
        Handles conversation loop with auto-respond for multi-turn.
        """
        import httpx

        system_prompt = self.layer.build_system_prompt(self.config, endpoint=self.endpoint)
        model_id = self.config.model_id
        provider = self.config.provider
        use_completion_tokens = model_id.startswith("gpt-5")

        if provider == "deepseek":
            base_url, key_env = "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"
        elif provider == "openrouter":
            base_url, key_env = "https://openrouter.ai/api/v1", "OPENROUTER_KEY"
        elif provider == "xai":
            base_url, key_env = "https://api.x.ai/v1", "XAI_API_KEY"
        else:
            base_url, key_env = "https://api.openai.com/v1", "OPENAI_API_KEY"

        api_key = os.environ.get(key_env, "")

        # Convert tool definitions to OpenAI format
        openai_tools = []
        for td in self.tools.all_definitions():
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": td["name"],
                    "description": td.get("description", ""),
                    "parameters": td.get("input_schema", {"type": "object", "properties": {}}),
                },
            })

        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        transcript: list[dict] = []
        tool_call_log: list[dict] = []
        unauthorized_calls: list[dict] = []
        limits: dict = {}
        turn_timings: list[dict] = []

        user_msg = item.description
        assistant_text = ""

        for turn in range(max_turns):
            turn_start = time.time()
            messages.append({"role": "user", "content": user_msg})

            # Build API request
            body: dict[str, Any] = {
                "model": model_id,
                "messages": messages,
            }
            if use_completion_tokens:
                body["max_completion_tokens"] = self.config.max_tokens
            else:
                body["max_tokens"] = self.config.max_tokens

            # Include tools if any are authorized
            if self.layer.authorized_tools and openai_tools:
                body["tools"] = openai_tools

            # Call API with tool loop
            max_tool_rounds = 10
            tool_round = 0
            call_ms = 0

            while True:
                call_start = time.time()

                def do_call():
                    resp = httpx.post(
                        f"{base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                        timeout=120,
                    )
                    return resp.json()

                d = _call_with_retry(do_call)
                call_ms += int((time.time() - call_start) * 1000)

                if "error" in d and "choices" not in d:
                    raise Exception(f"{provider} error: {d.get('error', d)}")

                # Track usage
                u = d.get("usage", {})
                output_tokens = u.get("completion_tokens", 0)
                cached = u.get("prompt_tokens_details", {}).get("cached_tokens", 0)
                self.usage.record(
                    model_id,
                    input_tokens=u.get("prompt_tokens", 0),
                    output_tokens=output_tokens,
                    cached_tokens=cached,
                    label=model_id,
                )

                choice = d["choices"][0]
                msg = choice["message"]
                finish_reason = choice.get("finish_reason")

                # Check for tool calls
                if msg.get("tool_calls") and tool_round < max_tool_rounds:
                    tool_round += 1
                    # Append assistant message with tool_calls to conversation
                    messages.append(msg)

                    for tc in msg["tool_calls"]:
                        func = tc.get("function", {})
                        tool_name = func.get("name", "")
                        try:
                            tool_args = __import__("json").loads(func.get("arguments", "{}"))
                        except Exception:
                            tool_args = {}

                        tool_exec_start = time.time()
                        authorized = self.layer.is_authorized(tool_name)
                        result = self.tools.execute(tool_name, tool_args, authorized)
                        tool_ms = int((time.time() - tool_exec_start) * 1000)

                        call_record = {
                            "name": tool_name,
                            "args": tool_args,
                            "result": result,
                            "authorized": authorized,
                            "round": tool_round,
                            "timing_ms": tool_ms,
                        }
                        tool_call_log.append(call_record)
                        if not authorized:
                            unauthorized_calls.append(call_record)

                        status = "OK" if authorized else "DENIED"
                        sys.stdout.write(f"[tool: {tool_name} ({status})] ")
                        sys.stdout.flush()

                        # Feed tool result back
                        result_content = result.get("error") or result.get("result", "")
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": str(result_content)[:4000],
                        })

                    # Update body with new messages and re-call
                    body["messages"] = messages
                    continue

                # No tool calls — extract text
                assistant_text = msg.get("content", "") or ""
                limits = _check_limits(
                    output_tokens=output_tokens,
                    max_tokens=self.config.max_tokens,
                    stop_reason=finish_reason,
                )
                break

            turn_ms = int((time.time() - turn_start) * 1000)

            # Record transcript with timing
            turn_timings.append({"turn": turn + 1, "timing_ms": turn_ms, "api_call_ms": call_ms})
            transcript.append({"role": "user", "content": user_msg})
            transcript.append({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": list(tool_call_log),
                "timing_ms": turn_ms,
            })

            # Append assistant to messages for multi-turn
            messages.append({"role": "assistant", "content": assistant_text})

            if limits:
                limit_parts = []
                if "truncated" in limits:
                    limit_parts.append("TRUNCATED (hit max_tokens)")
                if "token_limit" in limits:
                    tl = limits["token_limit"]
                    limit_parts.append(f"tokens: {tl['output_tokens']}/{tl['max_tokens']} ({tl['utilization']:.0%})")
                if limit_parts:
                    sys.stdout.write(f" [LIMIT: {', '.join(limit_parts)}]")

            if max_turns == 1:
                break

            # Multi-turn: auto-respond
            sim_config = item.metadata.get("follow_ups") if item.metadata else None
            if sim_config and sim_config.get("scout_sim_prompt"):
                follow_up = _scout_sim_respond(
                    assistant_text, turn, sim_prompt=sim_config["scout_sim_prompt"],
                    transcript=transcript)
            else:
                follow_up = _auto_respond(assistant_text, turn, question=item.description,
                                          transcript=transcript, scout_context=_build_scout_context(item))
            if follow_up is None:
                break

            user_msg = follow_up
            transcript.append({"role": "user", "content": user_msg})
            sys.stdout.write(f" [turn {turn+2}]")

        elapsed_ms = int((time.time() - start) * 1000)

        # Format response text
        turn_count = len([t for t in transcript if t["role"] == "user"])
        if turn_count > 1:
            parts = []
            for entry in transcript:
                role = entry["role"].upper()
                label = "SCOUT" if role == "USER" else "COACH"
                parts.append(f"[{label}]: {entry['content']}")
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
                "turn_timings": turn_timings,
                "limits": limits,
            },
            timing_ms=elapsed_ms,
        )

    def _run_gemini(self, item: EvalItem, max_turns: int, start: float) -> ExecutionResult:
        """Multi-turn engine for Google Gemini using the genai SDK.

        Gemini uses a custom API format with Content/Part objects.
        Tool calls are returned as FunctionCall parts in the response.
        """
        from google import genai
        from google.genai import types

        system_prompt = self.layer.build_system_prompt(self.config, endpoint=self.endpoint)
        model_id = self.config.model_id
        gc = genai.Client(api_key=os.environ.get("GOOGLE_KEY", ""))

        # Convert tool definitions to Gemini FunctionDeclaration format
        def _to_gemini_schema(json_schema: dict) -> "types.Schema":
            """Recursively convert JSON Schema to Gemini types.Schema."""
            stype = json_schema.get("type", "string").upper()
            kwargs: dict[str, Any] = {"type": stype}
            if "description" in json_schema:
                kwargs["description"] = json_schema["description"]
            if "enum" in json_schema:
                kwargs["enum"] = json_schema["enum"]
            if stype == "OBJECT" and "properties" in json_schema:
                kwargs["properties"] = {
                    k: _to_gemini_schema(v)
                    for k, v in json_schema["properties"].items()
                }
                if json_schema.get("required"):
                    kwargs["required"] = json_schema["required"]
            elif stype == "ARRAY" and "items" in json_schema:
                kwargs["items"] = _to_gemini_schema(json_schema["items"])
            return types.Schema(**kwargs)

        gemini_tools = None
        if self.layer.authorized_tools:
            func_decls = []
            for td in self.tools.all_definitions():
                schema = td.get("input_schema", {})
                param_schema = _to_gemini_schema(schema) if schema.get("properties") else None
                func_decls.append(types.FunctionDeclaration(
                    name=td["name"],
                    description=td.get("description", ""),
                    parameters=param_schema,
                ))
            if func_decls:
                gemini_tools = [types.Tool(function_declarations=func_decls)]

        # Build conversation as Gemini Content objects
        contents: list = []
        transcript: list[dict] = []
        tool_call_log: list[dict] = []
        unauthorized_calls: list[dict] = []
        limits: dict = {}
        turn_timings: list[dict] = []

        user_msg = item.description
        assistant_text = ""

        for turn in range(max_turns):
            turn_start = time.time()
            contents.append(types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_msg)],
            ))

            # Call Gemini with tool loop
            max_tool_rounds = 10
            tool_round = 0
            call_ms = 0

            config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=self.config.max_tokens,
            )
            if gemini_tools:
                config.tools = gemini_tools

            while True:
                call_start = time.time()

                def do_call():
                    return gc.models.generate_content(
                        model=model_id,
                        contents=contents,
                        config=config,
                    )

                resp = _call_with_retry(do_call)
                call_ms += int((time.time() - call_start) * 1000)

                # Track usage
                u = getattr(resp, "usage_metadata", None)
                output_tokens = 0
                if u:
                    output_tokens = getattr(u, "candidates_token_count", 0) or 0
                    self.usage.record(
                        model_id,
                        input_tokens=getattr(u, "prompt_token_count", 0) or 0,
                        output_tokens=output_tokens,
                        cached_tokens=getattr(u, "cached_content_token_count", 0) or 0,
                        label=model_id,
                    )

                # Check for function calls in response
                candidate = resp.candidates[0] if resp.candidates else None
                if not candidate or not candidate.content:
                    raise Exception("Gemini returned empty response")

                parts = candidate.content.parts or []
                func_calls = [p for p in parts if hasattr(p, "function_call") and p.function_call]
                text_parts = [p.text for p in parts if hasattr(p, "text") and p.text]

                if func_calls and tool_round < max_tool_rounds:
                    tool_round += 1
                    # Append the assistant's response (with function calls) to contents
                    contents.append(candidate.content)

                    # Process each function call
                    func_response_parts = []
                    for fc_part in func_calls:
                        fc = fc_part.function_call
                        tool_name = fc.name
                        tool_args = dict(fc.args) if fc.args else {}

                        tool_exec_start = time.time()
                        authorized = self.layer.is_authorized(tool_name)
                        result = self.tools.execute(tool_name, tool_args, authorized)
                        tool_ms = int((time.time() - tool_exec_start) * 1000)

                        call_record = {
                            "name": tool_name,
                            "args": tool_args,
                            "result": result,
                            "authorized": authorized,
                            "round": tool_round,
                            "timing_ms": tool_ms,
                        }
                        tool_call_log.append(call_record)
                        if not authorized:
                            unauthorized_calls.append(call_record)

                        status = "OK" if authorized else "DENIED"
                        sys.stdout.write(f"[tool: {tool_name} ({status})] ")
                        sys.stdout.flush()

                        # Build function response
                        result_content = result.get("error") or result.get("result", "")
                        func_response_parts.append(types.Part.from_function_response(
                            name=tool_name,
                            response={"result": str(result_content)[:4000]},
                        ))

                    # Feed tool results back as a user turn with function responses
                    contents.append(types.Content(
                        role="user",
                        parts=func_response_parts,
                    ))
                    continue

                # No function calls — extract text
                assistant_text = "\n".join(text_parts) if text_parts else ""
                if not assistant_text:
                    fr = getattr(candidate, "finish_reason", None)
                    raise Exception(f"Gemini returned no text (finish_reason={fr})")

                finish_reason = None
                fr = getattr(candidate, "finish_reason", None)
                if fr and str(fr) == "MAX_TOKENS":
                    finish_reason = "max_tokens"

                limits = _check_limits(
                    output_tokens=output_tokens,
                    max_tokens=self.config.max_tokens,
                    stop_reason=finish_reason,
                )
                break

            turn_ms = int((time.time() - turn_start) * 1000)

            # Record transcript with timing
            turn_timings.append({"turn": turn + 1, "timing_ms": turn_ms, "api_call_ms": call_ms})
            transcript.append({"role": "user", "content": user_msg})
            transcript.append({
                "role": "assistant",
                "content": assistant_text,
                "tool_calls": list(tool_call_log),
                "timing_ms": turn_ms,
            })

            # Append assistant text to contents for multi-turn
            contents.append(types.Content(
                role="model",
                parts=[types.Part.from_text(text=assistant_text)],
            ))

            if limits:
                limit_parts = []
                if "truncated" in limits:
                    limit_parts.append("TRUNCATED (hit max_tokens)")
                if "token_limit" in limits:
                    tl = limits["token_limit"]
                    limit_parts.append(f"tokens: {tl['output_tokens']}/{tl['max_tokens']} ({tl['utilization']:.0%})")
                if limit_parts:
                    sys.stdout.write(f" [LIMIT: {', '.join(limit_parts)}]")

            if max_turns == 1:
                break

            # Multi-turn: auto-respond
            sim_config = item.metadata.get("follow_ups") if item.metadata else None
            if sim_config and sim_config.get("scout_sim_prompt"):
                follow_up = _scout_sim_respond(
                    assistant_text, turn, sim_prompt=sim_config["scout_sim_prompt"],
                    transcript=transcript)
            else:
                follow_up = _auto_respond(assistant_text, turn, question=item.description,
                                          transcript=transcript, scout_context=_build_scout_context(item))
            if follow_up is None:
                break

            user_msg = follow_up
            transcript.append({"role": "user", "content": user_msg})
            sys.stdout.write(f" [turn {turn+2}]")

        elapsed_ms = int((time.time() - start) * 1000)

        # Format response text
        turn_count = len([t for t in transcript if t["role"] == "user"])
        if turn_count > 1:
            parts = []
            for entry in transcript:
                role = entry["role"].upper()
                label = "SCOUT" if role == "USER" else "COACH"
                parts.append(f"[{label}]: {entry['content']}")
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
                "turn_timings": turn_timings,
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
