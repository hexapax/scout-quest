# Scout-Quest Tool Critique

## Purpose

This document is a candid assessment of the current scout-quest MCP tool design — what works, what doesn't, and what must change to support the three-layer memory architecture. The goal is not to enumerate everything wrong, but to identify the structural problems that will block scale and quality, and propose specific fixes.

The tools were reviewed in the context of three personas: scout-quest (11 tools, scout-facing), scout-guide (15 tools, parent-facing), and scout-admin (12 tools, admin-facing). Total: 38 tools across three MCP servers.

---

## Structural Problems

### 1. Badge-specific tools encode business logic in the wrong place

This is the single biggest problem and it gets worse with every badge you add.

`log_chore`, `log_budget_entry`, `setup_time_mgmt`, and `log_diary_entry` are all Personal Management / Family Life specific tools. Each one bakes the requirements of those specific badges into its parameter schema. `log_budget_entry` has parameters for `week_number (int 1-13)`, `income`, `expenses`, `savings_deposited` — these are literally the structure of PM Requirement 2c.

**Why this is a problem:**

When you add Cooking merit badge, you'll need a tool for logging meal plans and cooking sessions. Environmental Science will need data collection logs. Citizenship badges need interview records. You end up with 20-30 badge-specific logging tools, each with a bespoke parameter schema, each adding to the tool description payload that the model must parse on every turn.

The model's tool selection accuracy degrades roughly linearly with tool count. At 11 tools it's workable. At 30+ tools with similar-sounding names (`log_budget_entry` vs `log_meal_plan` vs `log_service_hours` vs `log_fitness_record`), the model will routinely pick the wrong tool or hallucinate parameters from one tool onto another.

**Where the logic should live:** The knowledge graph knows what each requirement expects as evidence. The server-side validation layer checks incoming evidence against the graph schema. The model's job is to have a conversation with the scout, understand what they did, and submit it through a single generic tool. The model already knows BSA policy (from the cached context) — it doesn't need the tool schema to tell it what PM Req 2c requires.

**Proposed fix:** Replace all badge-specific logging tools with a single `log_requirement_work` tool that takes `badge_or_rank`, `requirement_id`, `evidence_type`, and a flexible `evidence` payload. Server-side validation (informed by the knowledge graph) rejects malformed evidence with a helpful error message that the model can relay to the scout.

### 2. Tool descriptions don't define boundaries

None of the current tool descriptions tell the model when NOT to use them. This is a well-documented cause of over-eager tool calling in LLM agents.

For example, `advance_requirement` is described as "Move a requirement to the next state-machine status." But when a scout asks "what do I need to do for requirement 4a?", the model might call `advance_requirement` to look up the current status, even though the answer should come from cached knowledge (what the requirement is) and possibly `get_scout_advancement` (what's completed vs. pending). There is no `get_scout_advancement` tool on the scout-facing persona at all — the scout has no read-only way to check their own progress without the model inferring it from tool side effects.

**Proposed fix:** Every tool description needs three sections: what it does, when to use it, and when NOT to use it. For the new architecture, tool descriptions must explicitly reference the cached knowledge layer:

```
"Do NOT use this tool to answer questions about what a requirement involves
or what a scout needs to do — you already know BSA requirements from your
built-in knowledge. Use this tool ONLY to record that work has been done."
```

### 3. The scout has no read-only status tool

Looking at the 11 scout-facing tools, there is no tool that lets a scout ask "where am I?" or "what do I need to do next?" without the model making an inference from side-channel data.

`update_quest_plan` is the closest, but it's a write tool with complex parameters. `advance_requirement` is a state transition tool. There's no simple `get_my_progress` that returns the scout's current advancement state across all active badges and ranks.

This means the model either answers progress questions from conversation history (unreliable across sessions) or it has to call a write tool and ignore the response to glean status information. Both paths produce bad answers.

**Proposed fix:** Add a `get_my_status` tool to the scout persona:

```json
{
  "name": "get_my_status",
  "description": "Get your current advancement progress. Returns completed and pending requirements for active badges and rank. Use this when the scout asks about their progress, what they need to do next, or where they stand. This is read-only — it doesn't change anything.",
  "input_schema": {
    "type": "object",
    "properties": {
      "scope": {
        "type": "string",
        "enum": ["overview", "specific_badge", "rank_progress"],
        "description": "What level of detail to return"
      },
      "badge_name": {
        "type": "string",
        "description": "Required if scope is specific_badge"
      }
    },
    "required": ["scope"]
  }
}
```

This tool reads from the knowledge graph, joining the scout's `WORKING_ON` and `COMPLETED` relationships with the version-correct requirement list. It's the most commonly needed tool and currently doesn't exist.

### 4. Complex nested parameter schemas hurt tool call accuracy

`update_quest_plan` is the worst offender:

```
add_milestone ({id, label, category, target_metric?, target_date?}, optional)
scout_observations ({engagement_patterns?, attention_notes?, motivation_triggers?,
    tone_notes?}, optional)
next_counselor_session ({badge, requirements_to_present, prep_notes}, optional)
```

Models struggle with deeply nested object parameters, especially optional ones with sub-fields. The model has to decide: do I fill in `scout_observations.engagement_patterns` or `scout_observations.motivation_triggers`? Every optional nested field is a decision point that increases the probability of a malformed tool call.

This problem compounds with the tool description payload size. Each of these nested schemas adds significant tokens to the system prompt, reducing the budget available for actual BSA knowledge.

**Proposed fix:** Flatten or split. Either decompose `update_quest_plan` into focused tools (`add_milestone`, `record_observation`, `prep_counselor_session`) each with flat parameter schemas, or redesign as a single tool that accepts a simpler payload and handles the routing server-side.

Given the overall goal of reducing tool count, the better approach is to keep it as one tool but simplify the schema:

```json
{
  "name": "update_quest_plan",
  "description": "Update the coaching plan for this scout. Accepts one update at a time — call multiple times for multiple changes.",
  "input_schema": {
    "type": "object",
    "properties": {
      "update_type": {
        "type": "string",
        "enum": ["priority", "milestone", "observation", "counselor_prep", "strategy"]
      },
      "content": {
        "type": "object",
        "description": "Payload varies by update_type. For milestone: {label, category, target_date}. For observation: free-text string. For counselor_prep: {badge, requirements, notes}."
      },
      "reason": { "type": "string" }
    },
    "required": ["update_type", "content", "reason"]
  }
}
```

This shifts the complexity from the tool schema (which the model parses) to the server-side handler (which you control). The model just needs to pick the right `update_type` and fill a simpler payload.

### 5. The onboarding flow is over-decomposed

The parent-facing persona has 7 onboarding tools:

1. `setup_scout_profile`
2. `set_scout_interests`
3. `set_quest_goal`
4. `set_chore_list_guide`
5. `set_budget_plan`
6. `set_character_preferences`
7. `set_session_limits`

These must be called in a specific sequence (some have prerequisites like "requires goal + chores first"). This creates a multi-step orchestration problem that the model has to manage across conversation turns.

Models are not good at multi-step sequential orchestration, especially when they have to remember which steps are complete, which remain, and what the dependencies are. The model will sometimes skip steps, repeat steps, or call them out of order.

**What works:** The individual tools have clean, well-defined parameter schemas. The YPT-aware design (parent must be involved) is good.

**What doesn't work:** Forcing the model to be the state machine for a 7-step workflow. The model doesn't reliably track "interests step is done, goal step is done, chores step is pending."

**Proposed fix — two options:**

**Option A (simpler):** Consolidate into 2-3 tools: `setup_scout` (profile + interests + session limits — the stuff that doesn't depend on badge choice), `setup_quest` (goal + chores + budget — the badge-specific stuff), and `set_character_preferences` (kept separate since it's about the AI persona). Server-side, the handler orchestrates the sub-steps and returns which fields are still needed.

**Option B (more robust):** Keep the individual tools but add a `get_onboarding_status` tool that returns the current checklist state. The model calls this to see what's done and what's next, then calls the appropriate setup tool. This is the pattern that works best with LLM agents — give them a read tool to check state, then let them decide what action to take.

Option B is better if the onboarding conversation is genuinely multi-session (parent starts one day, finishes another). Option A is better if onboarding usually happens in one sitting.

### 6. Admin tools are well-designed but should be separated from the knowledge system

The 12 admin tools are mostly Scoutbook sync operations, and they're the best-designed set of the three personas. Clear names, simple parameters, obvious purposes. `scoutbook_sync_roster`, `scoutbook_sync_scout`, `scoutbook_list_scouts` — these are clean CRUD operations.

**Minor issues:**

`scoutbook_init_quest` does too much: "Bootstrap quest profiles from Scoutbook data. Maps MB status → quest requirement statuses." This is a complex transformation that probably shouldn't be a single tool call. If it fails partway through, what state is the data in? Consider adding a dry_run that returns a preview of changes (you already have this as an optional parameter — good).

`scoutbook_get_rank_requirements` returns "Canonical requirements list (text + numbering) for a BSA rank." With the new architecture, this data should come from the knowledge graph, not from a Scoutbook API call. The Scoutbook sync populates the graph; the graph serves the data. This tool should either be removed (the model knows requirements from cached context) or reimplemented as a graph query.

**Proposed fix:** Keep the sync tools as-is. Remove `scoutbook_get_rank_requirements` (redundant with cached context + knowledge graph). Add `rebuild_knowledge_cache` and `validate_graph_integrity` admin tools for the new architecture.

---

## Tool-by-Tool Recommendations

### Scout-Facing (Current: 11 → Proposed: 7)

| Current Tool | Action | Rationale |
|---|---|---|
| `log_chore` | **REMOVE** — replace with `log_requirement_work` | Badge-specific, won't scale |
| `log_budget_entry` | **REMOVE** — replace with `log_requirement_work` | Badge-specific, won't scale |
| `setup_time_mgmt` | **REMOVE** — replace with `log_requirement_work` | Badge-specific, won't scale |
| `log_diary_entry` | **REMOVE** — replace with `log_requirement_work` | Badge-specific, won't scale |
| `advance_requirement` | **KEEP** — refine description | Core state machine, well-designed |
| `compose_email` | **KEEP** as-is | YPT compliance is critical, design is solid |
| `send_notification` | **KEEP** as-is | Simple and correct |
| `adjust_tone` | **KEEP** as-is | Clean design |
| `update_quest_goal` | **KEEP** — simplify slightly | Good scope |
| `update_quest_plan` | **KEEP** — flatten parameter schema | Needed but too complex |
| `log_session_notes` | **KEEP** as-is | Important for continuity |
| — | **ADD** `log_requirement_work` | Generic evidence logging |
| — | **ADD** `get_my_status` | Read-only progress check |

### Parent/Guide-Facing (Current: 15 → Proposed: 10-12)

| Area | Action | Rationale |
|---|---|---|
| Onboarding (7 tools) | **CONSOLIDATE** to 3-4 | Over-decomposed, model struggles with sequencing |
| Monitoring (3 tools) | **KEEP** as-is | Well-scoped, clear purposes |
| Adjustment (5 tools) | **CONSOLIDATE** to 3 | Several overlap in purpose |
| — | **ADD** `get_onboarding_status` | State check for multi-session onboarding |
| — | **ADD** `get_scout_dashboard` | Read-only overview the parent can ask for |

### Admin-Facing (Current: 12 → Proposed: 12-13)

| Action | Tools | Rationale |
|---|---|---|
| **KEEP** as-is | All sync tools (8) | Well-designed CRUD operations |
| **KEEP** | `scoutbook_init_quest` | Complex but necessary, dry_run is good |
| **REMOVE** | `scoutbook_get_rank_requirements` | Redundant with cached context |
| **ADD** | `rebuild_knowledge_cache` | Trigger Layer 1 re-distillation |
| **ADD** | `validate_graph_integrity` | Post-sync health check |
| **ADD** | `corpus_update` | Process new/updated BSA documents into the pipeline |

---

## Interaction Patterns That Must Change

### Current pattern: Model as knowledge retriever

```
Scout: "What do I need to do for PM requirement 2c?"

Model thinks: "I need to look up PM 2c... which tool has this?
               Maybe advance_requirement? No, that changes state.
               Maybe log_budget_entry? That's for logging, not reading.
               I don't have a lookup tool... I'll try to answer from
               whatever I remember from the system prompt."

Model: [Gives a partially correct answer, or hallucinates details]
```

### New pattern: Model as knowledgeable advisor

```
Scout: "What do I need to do for PM requirement 2c?"

Model thinks: "I know this from my BSA knowledge. PM Req 2c is:
               'Keep track of your income, expenses, and savings
               for 13 weeks.' No tool needed."

Model: "For Personal Management requirement 2c, you need to track
        your income, expenses, and savings every week for 13 weeks.
        You've already got your budget set up — want me to check
        how many weeks you've logged so far?"

Scout: "Yeah, where am I?"

Model calls: get_my_status(scope="specific_badge", badge_name="Personal Management")

Model: "You've logged 7 out of 13 weeks. You're on track —
        6 more weeks to go. Want to log this week's entry now?"
```

The difference: the model answers the knowledge question from cached context (instant, no tool call, no latency) and only calls a tool when it needs to check or change scout-specific state. This is faster, more accurate, and scales to any badge without new tools.

### Current pattern: Badge-specific tool selection

```
Scout: "I did my chores today"

Model thinks: "Chores → log_chore tool. What parameters?
               chores_completed is a string array..."

Model calls: log_chore(chores_completed=["dishes", "laundry", "trash"])
```

### New pattern: Generic evidence with contextual understanding

```
Scout: "I did my chores today"

Model thinks: "This scout is working on Family Life. Chore logging
               is part of FL Req 3. I know from my BSA knowledge
               that they need to track chores for 90 days. I'll log
               this as requirement work."

Model calls: log_requirement_work(
               badge_or_rank="Family Life",
               requirement_id="fl_3",
               evidence_type="log_entry",
               evidence={
                 "chores": ["dishes", "laundry", "trash"],
                 "date": "2026-03-17"
               })
```

The model uses its BSA knowledge to determine which requirement this work applies to, then uses a generic tool to record it. The server validates that the evidence payload matches what FL Req 3 expects (which it knows from the knowledge graph).

### Current pattern: Tool descriptions consume context budget

```
System prompt budget breakdown (estimated):
  Agent personality / instructions:    ~3,000 tokens
  11 tool definitions with schemas:    ~4,000 tokens
  BSA knowledge (what fits):           ~remaining
  Per-scout dynamic context:           ~2,000 tokens
  Conversation history:                ~varies

Problem: Tool definitions eat into the space available for BSA knowledge.
         More tools = less knowledge = more tool calls needed = worse answers.
```

### New pattern: Minimal tools, maximum knowledge

```
System prompt budget breakdown (target):
  Agent personality / instructions:    ~3,000 tokens
  7 tool definitions with schemas:     ~2,000 tokens
  BSA knowledge (cached, 150-200K):    ~150,000-200,000 tokens
  Per-scout dynamic context:           ~3,000 tokens
  Conversation history:                ~varies

Result: Tool definitions are a rounding error. BSA knowledge dominates.
        The model answers most questions from knowledge, rarely needs tools.
        When it does need a tool, there are fewer to choose from = better accuracy.
```

---

## Tool Description Writing Guidelines

Based on the failure modes observed, every tool description in the refactored system should follow these rules:

**1. Lead with the purpose, not the mechanism.**

Bad: "Move a requirement to the next state-machine status."
Good: "Record that a scout has made progress on a requirement. Use when a scout has completed work and you need to advance their tracking status."

The model doesn't need to know it's a state machine. It needs to know when to call it.

**2. Explicitly state when NOT to use it.**

Every tool should include: "Do NOT use this to [common misuse]. Instead, [correct approach]."

Example for `log_requirement_work`:
"Do NOT use this to check what a requirement involves — you already know BSA requirements. Do NOT use this to check the scout's progress — use get_my_status for that. Use this ONLY to record completed work."

**3. Keep parameter descriptions under 15 words each.**

The model reads parameter descriptions to decide what to fill in. Long descriptions add tokens and can confuse. If a parameter needs a long explanation, the logic should move server-side.

**4. Use enums aggressively.**

Constrained choices are easier for models than free text. `evidence_type: enum["completion_note", "log_entry", "document", "checklist"]` is much better than `evidence_type: string`.

**5. Make required vs. optional crystal clear.**

The current tools do this well. Maintain it. But also: if a parameter is only required in certain conditions (like `badge_name` when `scope` is "specific_badge"), state the condition in the description. Models reliably follow "Required if scope is specific_badge" patterns.

**6. Include one concrete example in the tool description.**

Research consistently shows that a single example in the tool description improves call accuracy significantly. Keep it brief:

"Example: To log that a scout completed their chores for Family Life, call with badge_or_rank='Family Life', requirement_id='fl_3', evidence_type='log_entry', evidence={chores: ['dishes', 'laundry']}"

---

## Impact on the Memory Architecture

The tool refactoring and the memory system are deeply interdependent:

**Layer 1 (cached context) enables tool reduction.** Without BSA policy in context, the model needs tools to look things up. With it in context, knowledge tools disappear and only action tools remain. This is the primary mechanism for reducing tool count.

**Layer 3 (knowledge graph) enables tool generalization.** Without the graph, each badge needs its own tools because the validation logic has nowhere else to live. With the graph, the server can query what a requirement expects and validate accordingly, letting the tools be generic.

**Tool reduction improves Layer 1 effectiveness.** Fewer tokens spent on tool descriptions means more tokens available for cached BSA knowledge. More knowledge in context means fewer tool calls needed. This is a virtuous cycle.

**The target state:** A scout can have a long, productive conversation about advancement, policy, and planning where 80% of the model's responses require zero tool calls. Tools fire only for recording work, checking personalized progress, or sending communications. The model's value comes from its knowledge and conversational ability, not from its tool-calling ability.
