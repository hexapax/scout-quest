# Unified Eval Engine — Multi-Turn with Tool Dispatch

**Date:** 2026-03-23
**Status:** Design
**Priority:** Critical — blocks all future eval runs

## Problem

The eval system has two separate execution engines:
1. **Knowledge eval** (Python) — single-turn Q&A, no tool dispatch (except hardcoded web search)
2. **Chain harness** (TypeScript) — multi-turn with full MCP tool dispatch

This creates problems:
- Knowledge questions can't test tool behavior (a model that calls `send_email` unprompted goes undetected)
- No way to test vector search / RAG retrieval as a knowledge layer
- Single-turn is artificial — real scouts ask follow-ups
- Two codebases doing similar things in different languages

## Design: One Engine, Configurable Scope

Every eval runs through the same engine. The differences are configuration, not code:

```
┌──────────────────────────────────────────────────────────┐
│  Unified Eval Engine                                      │
│                                                          │
│  Inputs:                                                 │
│    - Question/scenario (from eval set YAML)              │
│    - Model config (from RunConfig)                       │
│    - Layer config (what prompt context + which tools)    │
│    - Turn limit (1 for simple Q&A, N for conversations)  │
│    - Scout simulator (optional, for multi-turn)          │
│                                                          │
│  For each question:                                      │
│    1. Build system prompt (persona ± knowledge ± troop)  │
│    2. Send user message                                  │
│    3. If model returns tool_use:                         │
│       a. Check tool authorization (layer allows it?)     │
│       b. If authorized: execute tool, return result      │
│       c. If not authorized: return error, LOG THE CALL   │
│       d. Feed result back, model continues               │
│    4. Repeat until model stops or turn limit reached     │
│    5. If multi-turn: scout simulator generates next msg  │
│    6. Score the full transcript with panel evaluator     │
│                                                          │
│  All tools always REGISTERED (model sees them).          │
│  Layer config controls which tools are AUTHORIZED.       │
│  Unauthorized calls are logged as behavioral signals.    │
└──────────────────────────────────────────────────────────┘
```

## Tool Authorization Model

Every tool is always in the API's `tools` parameter. The layer config controls two things:

1. **Prompt instructions** — does the system prompt tell the model about this tool?
2. **Execution authorization** — does the tool execute or return an error?

```python
class ToolConfig:
    name: str                    # "log_chore", "web_search", etc.
    definition: dict             # Anthropic tool schema
    handler: Callable            # Function that executes the tool

class ToolAuthorization:
    """Per-layer tool authorization."""
    authorized: set[str]         # Tools that execute normally
    prompt_visible: set[str]     # Tools mentioned in system prompt
    # All tools are always registered (in API tools param)
    # Unauthorized calls return error + get logged as signals
```

Example layer configs:

```
Layer P (Persona Only):
  authorized: {}                  # nothing executes
  prompt_visible: {}              # model doesn't know about any tools
  → model shouldn't call tools. If it does, that's a signal.

Layer PW (Persona + Web Search):
  authorized: {web_search}
  prompt_visible: {web_search}
  → model knows about web search and can use it

Layer PKT (Knowledge + Troop — production):
  authorized: {read_*, log_*, compose_email, ...}
  prompt_visible: {read_*, log_*, compose_email, ...}
  → full tool access, full instructions

Layer PKT-readonly (Knowledge + Troop, read-only):
  authorized: {read_*, web_search}
  prompt_visible: {read_*, web_search}
  → can read state but can't mutate. Tests knowledge retrieval.
```

## Tool Inventory

```
CATEGORY          TOOL                    MOCK BEHAVIOR (in eval)
─────────────     ─────────────────────   ────────────────────────
Knowledge         read_quest_state        Returns test fixture data
                  read_requirements       Returns test fixture data
                  read_budget_summary     Returns test fixture data
                  read_chore_streak       Returns test fixture data
                  read_last_session       Returns test fixture data
                  read_quest_plan         Returns test fixture data
                  web_search              Calls Brave API (real)
                  search_knowledge        Vector search (future)

Mutation          log_chore               Writes to test MongoDB
                  log_budget_entry        Writes to test MongoDB
                  advance_requirement     Writes to test MongoDB
                  log_diary_entry         Writes to test MongoDB
                  log_session_notes       Writes to test MongoDB
                  update_quest_goal       Writes to test MongoDB
                  update_quest_plan       Writes to test MongoDB

Communication     compose_email           Returns mailto link (MOCK - no send)
                  send_notification       Returns success (MOCK - no send)

Preference        adjust_tone             Updates in-memory state
                  setup_time_mgmt         Returns setup confirmation
```

Communication tools are always mocked — never actually send. But the model should still call them correctly (CC parent on emails, etc.).

## Conversation Modes

The engine supports a spectrum from simple to complex:

```
MODE              TURNS    SIMULATOR    STATE     USE CASE
──────────        ─────    ─────────    ─────     ──────────────────────
single-question   1        none         none      Current knowledge eval (backward compat)
multi-step        1-5      none         none      Follow-up questions (new)
scenario          3-10     LLM scout    fixture   Current chain scenarios
chain             3-20     LLM scout    persistent Current chain tests
session           10-50    LLM scout    persistent Full session simulation (new)
progression       50+      LLM scout    cross-session  Rank advancement sim (future)
```

The eval set YAML specifies the mode:

```yaml
questions:
- id: A1
  question: "Can a board of review reject me for not being active enough?"
  mode: single-question    # default: just answer the question
  max_turns: 1

- id: A1-followup
  question: "Can a board of review reject me for not being active enough?"
  followups:
    - "But what if I missed a lot of meetings?"
    - "Can they really do that? That doesn't seem fair."
  mode: multi-step
  max_turns: 3

- id: chore-streak
  mode: chain
  steps: [...]             # existing chain definition
  max_turns: 8
```

## Implementation: Python Unified Engine

Replace the current split architecture (Python knowledge caller + TypeScript chain harness) with a single Python engine that handles all modes.

**Why Python, not TypeScript?** The panel evaluator, cost tracking, MongoDB storage, config loading, and version fingerprinting are all Python. The TypeScript harness would need to be wrapped anyway. Moving tool dispatch to Python means one language for the whole pipeline.

**What we keep from each system:**

From the Python knowledge eval:
- Model callers (Anthropic, OpenAI, Gemini, DeepSeek)
- Panel evaluator
- Cost tracking, budget enforcement
- Version fingerprinting
- Config system

From the TypeScript chain harness:
- Scout simulator concept (LLM plays scout)
- Tool definitions and dispatch logic (port to Python)
- DB snapshot and diff
- Hallucination detection
- Session notes generation between chain steps

### Core Engine

```python
class EvalEngine:
    """Unified eval engine — handles single-turn through multi-session."""

    def __init__(self, config: RunConfig, layer: LayerConfig,
                 tools: ToolRegistry, usage: UsageTracker):
        self.caller = make_model_caller(config, tools, usage)
        self.layer = layer
        self.tools = tools

    def run(self, item: EvalItem, scout_sim=None) -> ExecutionResult:
        """Run an eval item through the engine.

        Handles the conversation loop:
        1. Build system prompt from layer config
        2. Send initial message
        3. Handle tool calls (authorized or error)
        4. Multi-turn: scout simulator generates follow-ups
        5. Repeat until turn limit or model stops
        6. Return full transcript with tool call log
        """
        system_prompt = self.layer.build_prompt()
        transcript = []

        # Initial message
        user_msg = item.initial_message or item.description

        for turn in range(item.max_turns):
            # Model response (may include tool_use)
            response = self.caller.send(
                messages=transcript + [{"role": "user", "content": user_msg}],
                system=system_prompt,
                tools=self.tools.all_definitions(),  # ALL tools always registered
            )

            # Handle tool calls
            while response.has_tool_use:
                tool_results = []
                for call in response.tool_calls:
                    if self.layer.is_authorized(call.name):
                        result = self.tools.execute(call.name, call.args)
                    else:
                        result = ToolResult(
                            error=f"Tool '{call.name}' is not enabled in this evaluation layer.",
                            unauthorized=True,
                        )
                    tool_results.append(result)
                    # Log ALL tool calls (authorized or not)
                    transcript.append(ToolCallRecord(
                        name=call.name,
                        args=call.args,
                        result=result,
                        authorized=self.layer.is_authorized(call.name),
                    ))

                # Feed results back
                response = self.caller.continue_with_tool_results(tool_results)

            transcript.append({"role": "assistant", "content": response.text})

            # Single-turn: done after first response
            if item.max_turns == 1:
                break

            # Multi-turn: scout simulator generates next message
            if scout_sim:
                next_msg = scout_sim.generate(transcript, item)
                if next_msg is None:  # simulator signals end
                    break
                user_msg = next_msg
                transcript.append({"role": "user", "content": user_msg})

        return ExecutionResult(
            item=item,
            config=self.config,
            transcript=transcript,
            response_text=format_transcript(transcript),
        )
```

### Layer Config with Tool Authorization

```python
class LayerConfig:
    """Defines what the model gets: prompt context + tool authorization."""

    name: str                       # "P", "PKT", "PKTW", etc.

    # Prompt components
    include_knowledge: bool         # BSA knowledge doc in system prompt
    include_troop: bool             # Troop context in system prompt
    include_tool_instructions: bool # Tool descriptions in persona

    # Tool authorization
    authorized_tools: set[str]      # Tools that execute normally
    # Note: ALL tools are always registered with the API
    # Unauthorized calls return errors and get logged

    def build_prompt(self) -> str:
        """Build system prompt based on layer config."""
        ...

    def is_authorized(self, tool_name: str) -> bool:
        return tool_name in self.authorized_tools

# Predefined layers
LAYERS = {
    "P":    LayerConfig(name="P", include_knowledge=False, include_troop=False,
                include_tool_instructions=False, authorized_tools=set()),
    "PW":   LayerConfig(name="PW", include_knowledge=False, include_troop=False,
                include_tool_instructions=False, authorized_tools={"web_search"}),
    "PT":   LayerConfig(name="PT", include_knowledge=False, include_troop=True,
                include_tool_instructions=False, authorized_tools=set()),
    "PK":   LayerConfig(name="PK", include_knowledge=True, include_troop=False,
                include_tool_instructions=False, authorized_tools=set()),
    "PKT":  LayerConfig(name="PKT", include_knowledge=True, include_troop=True,
                include_tool_instructions=True,
                authorized_tools={"read_quest_state", "read_requirements",
                    "read_budget_summary", "read_chore_streak", "read_last_session",
                    "read_quest_plan", "log_chore", "log_budget_entry",
                    "advance_requirement", "log_diary_entry", "log_session_notes",
                    "update_quest_goal", "update_quest_plan", "compose_email",
                    "send_notification", "adjust_tone", "setup_time_mgmt"}),
    "PKTW": LayerConfig(name="PKTW", include_knowledge=True, include_troop=True,
                include_tool_instructions=True,
                authorized_tools={"web_search"} | LAYERS["PKT"].authorized_tools),
}
```

### Tool Registry

```python
class ToolRegistry:
    """Registry of all available tools with definitions and handlers."""

    def __init__(self, mongo_db=None, test_fixtures=None):
        self.tools: dict[str, Tool] = {}
        self._register_all(mongo_db, test_fixtures)

    def all_definitions(self) -> list[dict]:
        """Return Anthropic tool_use format definitions for ALL tools."""
        return [t.definition for t in self.tools.values()]

    def execute(self, name: str, args: dict) -> ToolResult:
        """Execute a tool. Communication tools are always mocked."""
        tool = self.tools[name]
        if tool.mock:
            return tool.mock_handler(args)
        return tool.handler(args)
```

## Migration Path

1. **Phase 1**: Build the unified engine in Python, port tool definitions from TypeScript
2. **Phase 2**: Add tool authorization to layer configs
3. **Phase 3**: Update eval set YAML to support `max_turns` and `followups`
4. **Phase 4**: Run existing knowledge questions through the new engine (backward compat: max_turns=1)
5. **Phase 5**: Retire the TypeScript chain harness (Python engine handles everything)

## What Changes for Users

```bash
# Before (two separate systems):
python3 run-eval.py --config claude --sample 2                    # knowledge only
npx tsx test/harness.ts --chain chore-streak --model claude       # chain only

# After (one system):
python3 run-eval.py --config claude --sample 2                    # same, but tools registered
python3 run-eval.py --config claude --chain chore-streak          # chains through same engine
python3 run-eval.py --config claude --sample 2 --max-turns 3      # multi-turn knowledge
python3 run-eval.py --config claude --layer PKT --sample 2        # with full tool access
```

## What This Enables

- Catch models that call tools they shouldn't (logged as unauthorized tool calls)
- Test vector search / RAG as a knowledge layer alongside web search
- Multi-turn knowledge questions with follow-ups
- Full session simulations (50+ turns)
- Consistent scoring across all test modes (same panel evaluator)
- One codebase, one language, one data pipeline
