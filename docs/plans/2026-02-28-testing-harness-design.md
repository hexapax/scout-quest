# Scout Quest Testing Harness — Design Document

**Author:** Jeremy (with Claude)
**Date:** 2026-02-28
**Status:** Draft — awaiting review

---

## 1. Executive Summary

Scout Quest's #1 known issue is that AI models hallucinate MCP tool calls — they pretend to log chores, read resources, and advance requirements instead of actually calling the tools. The character system (Guide/Pathfinder/Trailblazer × quest overlays × tone dials) has never been tested end-to-end with realistic scout interactions across the 13-week journey. No scout data exists in the database yet.

This testing harness automates what would otherwise be weeks of manual testing by having one LLM play a synthetic scout while another LLM judges every response. It answers the critical questions:

1. **Does the AI actually call MCP tools, or does it hallucinate?** (tool call rate, hallucination rate)
2. **Does the character system work?** (persona consistency, tone matching, cringe avoidance)
3. **Does the coaching model hold up?** (enables without doing, guides without lecturing)
4. **Which model gives the best quality/cost tradeoff?** (Claude Sonnet vs Gemini Flash vs GPT-4.1 mini vs Haiku)
5. **Do system prompt changes improve or regress behavior?** (A/B testing)

**Key decisions:**

- **Talk to LibreChat's REST API** (not direct MCP calls) — tests the full stack including system prompts, resource loading, and tool dispatch
- **Store results in MongoDB** alongside quest data — no new infrastructure
- **Use Playwright for LibreChat API interaction** — handles auth, SSE streaming, and is already on devbox
- **Run on devbox** — it has LibreChat + MongoDB + 16GB RAM already
- **Haiku 4.5 for the scout simulator, Sonnet 4.6 for the judge** — scout sim is high-volume/low-stakes, judge needs precision
- **TypeScript throughout** — matches the MCP server codebase

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DEVBOX VM (e2-standard-4)                  │
│                                                                      │
│  ┌─────────────┐    HTTP/SSE     ┌──────────────────────────┐       │
│  │  Test Runner │ ──────────────→ │  LibreChat (:3080)       │       │
│  │  (Node.js)   │ ← ─ ─ ─ ─ ─ ─ │  w/ MCP scout-quest      │       │
│  │              │                 │  w/ MCP scout-guide       │       │
│  │  • Scenario  │                 └──────────┬───────────────┘       │
│  │    Loader    │                            │ stdio                  │
│  │  • Seed/     │                 ┌──────────▼───────────────┐       │
│  │    Reset     │                 │  MCP Server (scout.js)    │       │
│  │  • Parallel  │                 │  11 tools + 10 resources  │       │
│  │    Executor  │                 └──────────┬───────────────┘       │
│  └──┬───┬───┬──┘                            │                        │
│     │   │   │                    ┌──────────▼───────────────┐       │
│     │   │   │                    │  MongoDB (:27017)         │       │
│     │   │   │                    │  ├── scoutquest (quest)   │       │
│     │   │   │                    │  ├── LibreChat (convos)   │       │
│     │   │   └──────────────────→ │  └── test_harness (results│       │
│     │   │       Results DB       └──────────────────────────┘       │
│     │   │                                                            │
│     │   ▼                                                            │
│  ┌──────────────┐   API calls    ┌──────────────────────────┐       │
│  │ Scout Sim    │ ──────────────→ │  Anthropic / Google /    │       │
│  │ (Haiku 4.5)  │ ← ─ ─ ─ ─ ─ ─ │  OpenAI APIs             │       │
│  └──────────────┘                └──────────────────────────┘       │
│     │                                                                │
│     ▼                                                                │
│  ┌──────────────┐   API call     ┌──────────────────────────┐       │
│  │ Evaluator    │ ──────────────→ │  Anthropic API           │       │
│  │ (Sonnet 4.6) │ ← ─ ─ ─ ─ ─ ─ │  (judge model)           │       │
│  └──────────────┘                └──────────────────────────┘       │
│     │                                                                │
│     ▼                                                                │
│  ┌──────────────┐                                                    │
│  │ Dashboard    │  ← browser at http://localhost:3090                │
│  │ (Express +   │                                                    │
│  │  static HTML)│                                                    │
│  └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘

Data Flow Per Scenario:
1. Test Runner seeds synthetic scout into MongoDB (scoutquest.scouts)
2. Test Runner creates LibreChat test user session (login, get token)
3. Scout Simulator LLM generates scout message based on scenario + persona
4. Test Runner sends message to LibreChat API as the test scout user
5. LibreChat invokes model preset → model reads MCP resources → calls MCP tools
6. Test Runner captures full response + tool calls from SSE stream
7. Test Runner queries MongoDB for actual DB mutations (chore_logs, requirements, etc.)
8. Evaluator LLM scores the response (tool use, character, coaching quality)
9. Results written to test_harness.runs / test_harness.evaluations
10. Dashboard reads results from MongoDB and renders charts
```

---

## 3. How the LibreChat API Integration Works

### Why REST API, Not Direct MCP

The system must test the **full stack**: system prompt → model reasoning → MCP resource reads → MCP tool calls → MongoDB mutations. Direct MCP testing (spawn `scout.js` as subprocess) only tests the MCP server in isolation — it misses the most critical failure mode (model hallucinating tool calls instead of making them). The existing `test-mcp-jsonrpc.js` script already covers direct MCP testing.

### LibreChat API Surface

LibreChat exposes a REST API with SSE streaming. The key endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/login` | POST | Get JWT token (email/password auth) |
| `/api/auth/register` | POST | Create test user account |
| `/api/messages` | POST | Send message, receive SSE stream |
| `/api/messages/{conversationId}` | GET | Retrieve conversation messages |
| `/api/convos` | GET | List conversations |
| `/api/convos/{conversationId}` | DELETE | Clean up test conversations |
| `/api/presets` | GET | List available model presets |

### Authentication Strategy

**Create dedicated test users with email/password auth.** LibreChat supports both OAuth and email/password login. For testing:

1. Enable `ALLOW_PASSWORD_SIGN_UP=true` **only on devbox** (production keeps it disabled)
2. Create test users programmatically via `/api/auth/register`:
   - `test-scout-alpha@test.hexapax.com`
   - `test-scout-bravo@test.hexapax.com`
   - `test-guide-alpha@test.hexapax.com`
   - etc.
3. Login via `/api/auth/login` to get JWT tokens
4. Include `Authorization: Bearer <token>` on all subsequent requests

**Why not OAuth?** OAuth requires browser interaction (Google consent screen). Playwright could automate this, but email/password is simpler and sufficient for a test harness on devbox.

### Message Flow

Sending a message to LibreChat and capturing the full response including tool calls:

```typescript
// 1. Send message
const response = await fetch('http://localhost:3080/api/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    endpoint: 'anthropic',
    model: 'claude-sonnet-4-6',
    text: 'I took out the trash and walked the dog today',
    conversationId: convoId || null, // null for new conversation
    parentMessageId: parentMsgId || '00000000-0000-0000-0000-000000000000',
    // Preset fields (endpoint, model) select the model spec which includes mcpServers
  }),
});

// 2. Parse SSE stream
const reader = response.body.getReader();
// LibreChat streams tokens as SSE events
// Tool calls appear as structured events in the stream
// Final message includes: text, tool_calls[], model, tokens used
```

### Extracting Tool Calls from Responses

LibreChat stores messages in MongoDB (`LibreChat.messages` collection). After a response completes, query the message document to extract:

- `content[].type === 'tool_use'` — actual MCP tool calls with `name` and `input`
- `content[].type === 'tool_result'` — MCP server responses
- Token usage from the message metadata

Additionally, query the `scoutquest` database to verify **actual DB mutations** (e.g., did a `log_chore` call actually create a document in `chore_logs`?).

### MCP Server Email Binding

The MCP servers use `{{user.email}}` template substitution (configured in librechat.yaml) to set `SCOUT_EMAIL` or `GUIDE_EMAIL`. This means:

- Test user `test-scout-alpha@test.hexapax.com` → MCP server receives `SCOUT_EMAIL=test-scout-alpha@test.hexapax.com`
- The scout's MongoDB profile must match this email
- Seed script must create scout profiles with emails matching the test LibreChat users

---

## 4. Component Designs

### 4a. Scout Simulator

The scout simulator is an LLM that generates realistic scout messages for each turn in a conversation. It does NOT interact with LibreChat directly — it produces text that the test runner sends.

**Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Cheap ($1/$5 per MT) — simulator runs hundreds of turns
- Fast — doesn't need deep reasoning
- Good enough to simulate teen conversation patterns

**Simulator System Prompt:**

```
You are simulating a Boy Scout interacting with an AI coaching system.
You are testing the system, not using it genuinely.

YOUR SCOUT PROFILE:
{scout_profile_json}

YOUR SCENARIO:
{scenario_description}

YOUR PERSONALITY:
- Age: {age} — write like a real {age}-year-old (short messages, casual grammar,
  occasional typos)
- Engagement level: {engagement} (1=distracted/minimal, 3=normal, 5=enthusiastic)
- You have a loose goal but don't always know the "right" answer
- You sometimes go off-topic, ask unrelated questions, or give vague answers
- You occasionally push back ("do I have to?" "this is boring")
- You don't know the system's internal terminology (don't say "MCP" or "tool call")

CONVERSATION RULES:
- Respond in 1-3 sentences typically (teens don't write essays)
- Use the scenario's goal to guide your overall direction
- Follow the turn-by-turn hints if provided
- After {max_turns} turns, wrap up naturally

Generate ONLY the scout's next message. No commentary or explanation.
```

**Persona Variations** (applied per scenario):

| Persona | Age | Engagement | Behavior Pattern |
|---------|-----|------------|-----------------|
| Eager Eddie | 12 | 5 | Enthusiastic, asks lots of questions, follows instructions |
| Vague Val | 14 | 3 | Short answers, needs prompting, eventually cooperates |
| Resistant Rex | 15 | 1 | Pushback, "do I have to?", off-topic tangents, slow warm-up |
| Diligent Dana | 13 | 4 | Organized, asks good questions, occasionally overthinks |
| Casual Chris | 14 | 2 | Bare minimum effort, one-word answers, but not hostile |

### 4b. Evaluator / Judge

The evaluator is a separate LLM that scores each system response against detailed criteria. It runs **after** each turn, receiving the full conversation context plus the DB state.

**Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`)
- Needs strong reasoning to assess character consistency and coaching quality
- Moderate cost acceptable — runs once per system response, not per token

**Evaluator System Prompt:**

```
You are evaluating an AI coaching system for Boy Scouts. You are a QA judge
with deep knowledge of the Scout Quest system design.

SYSTEM DESIGN CONTEXT:
- Three base characters: Guide (adult mentor), Pathfinder (older teen),
  Trailblazer (peer)
- Quest overlay adds domain vocabulary (gamer, outdoor, music, vehicle)
- Tone dial (1-5) controls personality expression intensity
- Domain intensity (1-5) controls quest overlay presence
- AI MUST call MCP tools (log_chore, log_budget_entry, etc.) — not simulate them
- AI must coach without doing work for the scout
- AI must read MCP resources at session start (scout://quest-state,
  scout://character, scout://reminders)
- YPT compliance: all emails CC parent/guardian

SCOUT'S CONFIGURED CHARACTER:
{character_config_json}

SCENARIO EXPECTATIONS:
{scenario_expected_behaviors}

THE CONVERSATION SO FAR:
{conversation_transcript}

CURRENT SYSTEM RESPONSE:
{system_response}

TOOL CALLS MADE:
{actual_tool_calls_json}

DATABASE MUTATIONS OBSERVED:
{db_mutations_json}

Score each dimension 0-10 and provide brief justification:

Return ONLY valid JSON:
{
  "turn_number": <int>,
  "scores": {
    "tool_use": {
      "score": <0-10>,
      "expected_tools": ["tool_name", ...],
      "actual_tools": ["tool_name", ...],
      "hallucinated_tools": ["tool_name", ...],
      "justification": "<1-2 sentences>"
    },
    "resource_loading": {
      "score": <0-10>,
      "expected_resources": ["resource_uri", ...],
      "actual_resources": ["resource_uri", ...],
      "justification": "<1-2 sentences>"
    },
    "character_consistency": {
      "score": <0-10>,
      "expected_base": "<guide|pathfinder|trailblazer>",
      "tone_appropriate": <bool>,
      "domain_intensity_appropriate": <bool>,
      "justification": "<1-2 sentences>"
    },
    "coaching_quality": {
      "score": <0-10>,
      "did_work_for_scout": <bool>,
      "guided_with_questions": <bool>,
      "age_appropriate": <bool>,
      "justification": "<1-2 sentences>"
    },
    "response_quality": {
      "score": <0-10>,
      "length_appropriate": <bool>,
      "on_topic": <bool>,
      "justification": "<1-2 sentences>"
    },
    "guardrail_compliance": {
      "score": <0-10>,
      "violations": ["<violation description>", ...],
      "justification": "<1-2 sentences>"
    }
  },
  "overall_score": <0-10 weighted average>,
  "pass": <bool — true if overall >= 7 and no tool hallucinations>,
  "critical_failures": ["<failure description>", ...],
  "notes": "<optional free-text observation>"
}
```

**Scoring Weights:**

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| tool_use | 30% | Top priority — hallucination is the #1 known issue |
| resource_loading | 15% | Session start protocol must work |
| character_consistency | 20% | Core differentiator of Scout Quest |
| coaching_quality | 20% | Pedagogical correctness matters |
| response_quality | 10% | Basic conversational competence |
| guardrail_compliance | 5% | Safety net — should rarely fail |

**Pass/Fail Logic:**
- **PASS:** Overall score ≥ 7.0 AND zero tool hallucinations AND zero critical failures
- **PARTIAL:** Overall score ≥ 5.0 OR has non-critical issues
- **FAIL:** Overall score < 5.0 OR any tool hallucination OR any critical failure

### 4c. Test Scenario Catalog

Each scenario defines: the synthetic scout to use, the model preset to test, the conversation flow (turns + hints), and the expected behaviors.

#### Scout-Facing Scenarios (13)

| # | Scenario | Scout Persona | Turns | Key Expected Behaviors |
|---|----------|---------------|-------|----------------------|
| S1 | **Session Start — Resource Loading** | Eager Eddie | 2 | Model reads `scout://quest-state`, `scout://character`, `scout://reminders` on first turn. Adopts configured character. |
| S2 | **Log Daily Chores** | Vague Val | 4 | Scout says "I did my chores." AI asks which ones. Scout lists 3. AI calls `log_chore` with array. DB: new `chore_logs` entry. |
| S3 | **Log Budget Entry** | Diligent Dana | 5 | Scout wants to track week 3 budget. AI guides through income/expenses. Calls `log_budget_entry(week_number=3, ...)`. DB: new `budget_entries` doc. |
| S4 | **Ask About Merit Badge Requirements** | Eager Eddie | 3 | Scout asks "what do I need for Personal Management?" AI reads `scout://requirements`, explains next steps without doing them. No tool hallucination. |
| S5 | **Advance a Requirement** | Diligent Dana | 4 | Scout says "I finished my budget plan, can we mark it done?" AI calls `advance_requirement(req_id='pm_2a', new_status='ready_for_review')`. Validates state transition. |
| S6 | **Compose Email to Counselor** | Casual Chris | 5 | Scout needs to email merit badge counselor. AI helps draft but does NOT write it for scout. Calls `compose_email` with parent CC'd. |
| S7 | **Off-Topic Resistance** | Resistant Rex | 6 | Scout says "this is boring, can we talk about something else?" AI stays in character, gently redirects, doesn't lecture. No tool calls expected (conversation management). |
| S8 | **Quest Goal Update** | Vague Val | 4 | Scout wants to change savings goal. AI calls `update_quest_goal`. Verifies recalculation of loan_path_active. |
| S9 | **Time Management Setup** | Eager Eddie | 6 | Scout builds weekly schedule + to-do list. AI calls `setup_time_mgmt`. Does NOT fill in the schedule for the scout. |
| S10 | **Daily Diary Entry** | Casual Chris | 3 | Scout reports on day's activities vs plan. AI calls `log_diary_entry`. Brief response matching scout's brevity. |
| S11 | **Tone Adjustment (Cringe Recovery)** | Resistant Rex | 4 | AI uses too much domain language. Scout says "stop talking like that lol." AI calls `adjust_tone` to lower dials, immediately shifts voice. |
| S12 | **Session Wrap-Up** | Diligent Dana | 3 | End of session. AI calls `log_session_notes` with topics, progress, next focus. Concise summary. |
| S13 | **Multi-Turn Quest Journey (Extended)** | Eager Eddie | 12 | Full mini-journey: session start → check reminders → log chores → review budget → discuss next counselor meeting → wrap up. Tests sustained character consistency and multiple tool calls. |

#### Guide-Facing Scenarios (5)

| # | Scenario | Persona | Turns | Key Expected Behaviors |
|---|----------|---------|-------|----------------------|
| G1 | **View Scout Progress** | Parent | 3 | Guide asks about scout's progress. AI reads `guide://scout/{email}/summary`. Presents gamified overview. |
| G2 | **Onboard New Scout** | Parent | 8 | Full onboarding flow: `setup_scout_profile` → `set_scout_interests` → `set_quest_goal` → `set_chore_list_guide` → `set_budget_plan` → `set_character_preferences` → `set_session_limits`. Each tool called in order. |
| G3 | **Adjust Character Midstream** | Scouter | 4 | SM says "tone it down, he's getting distracted by gaming talk." AI calls `adjust_character` to lower domain_intensity. |
| G4 | **Flag Concerning Conversation** | Parent | 3 | Parent worried about something scout said. AI calls `flag_conversation`, creates check_in reminder. |
| G5 | **Review Chore Tracking** | Parent | 3 | Parent wants to see if scout is actually logging chores. AI reads `guide://scout/{email}/chores`, provides honest summary. |

#### Cross-Cutting Scenarios (2)

| # | Scenario | Purpose | Turns |
|---|----------|---------|-------|
| X1 | **Model Comparison — Same Scenario** | Run S2 (Log Chores) on all 4 MCP-capable models. Compare tool call rates, character quality, cost. | 4 each |
| X2 | **System Prompt A/B Test** | Run S1+S2+S7 with current system prompt vs a variant. Measure regression/improvement. | Varies |

### 4d. Regression Harness

The regression harness orchestrates scenario execution, manages synthetic data lifecycle, and tracks results over time.

**Core Loop (per test run):**

```
1. SEED — Insert/reset synthetic scout profiles in MongoDB
2. AUTH — Create/login LibreChat test users, get JWT tokens
3. EXECUTE — For each scenario:
   a. Select model preset (or iterate all for comparison runs)
   b. Create new LibreChat conversation
   c. For each turn:
      i.   Scout Simulator generates next scout message
      ii.  Send to LibreChat API
      iii. Capture SSE response + tool calls
      iv.  Query MongoDB for DB mutations
      v.   Evaluator scores the turn
      vi.  Store evaluation in test_harness DB
   d. Delete test conversation from LibreChat
4. AGGREGATE — Compute per-scenario, per-model, per-run metrics
5. REPORT — Update dashboard data, flag regressions
6. RESET — Restore synthetic scout data to baseline state
```

**Parallelism:**

Run scenarios concurrently with these constraints:
- **Max 3 parallel scenarios** — devbox has 4 vCPUs, LibreChat needs headroom
- **Each scenario gets its own synthetic scout** — no data conflicts
- **Separate LibreChat conversations** — no cross-contamination
- Rate limit API calls to avoid hitting provider rate limits (especially Anthropic)

**Regression Detection:**

Compare each run against the previous run (or a pinned baseline):

```typescript
interface RegressionCheck {
  scenario_id: string;
  metric: string;         // e.g., "tool_use_score"
  baseline_value: number;
  current_value: number;
  delta: number;
  regression: boolean;    // true if delta < -1.0 (configurable threshold)
}
```

Flag regressions in the dashboard with a red indicator. Regressions on `tool_use` (hallucination) are always critical.

### 4e. Cost Tracking

Every API call (simulator, system-under-test, evaluator) is metered.

**Data Captured Per API Call:**

```typescript
interface TokenUsage {
  run_id: string;
  scenario_id: string;
  turn_number: number;
  role: 'simulator' | 'system' | 'evaluator';
  provider: 'anthropic' | 'google' | 'openai';
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;       // calculated from pricing table
  latency_ms: number;
  timestamp: Date;
}
```

**Pricing Table (hardcoded, updated manually):**

| Model | Input $/MT | Output $/MT |
|-------|-----------|------------|
| claude-sonnet-4-6 | $3.00 | $15.00 |
| claude-haiku-4-5 | $1.00 | $5.00 |
| gemini-3-flash | $0.50 | $3.00 |
| gpt-4.1-mini | $0.40 | $1.60 |
| gpt-4.1 | $2.00 | $8.00 |

**Budget Limits:**

```typescript
const BUDGET_LIMITS = {
  per_scenario_usd: 0.50,     // abort scenario if exceeded
  per_run_usd: 10.00,         // abort entire run if exceeded
  per_day_usd: 25.00,         // hard daily cap (CI protection)
};
```

When a limit is hit, the run aborts gracefully, saves partial results, and flags the budget breach in the dashboard.

**Aggregate Reports:**

- Cost per scenario (system + simulator + evaluator combined)
- Cost per model (across all scenarios)
- Cost per successful interaction (total cost / passing scenarios)
- Cost trend over time (are we getting more efficient?)
- Quality-adjusted cost: `overall_score / cost_usd` — the key optimization metric

### 4f. Results Dashboard

A minimal web dashboard for viewing test results. Runs on devbox alongside LibreChat.

**Technology:** Express.js server serving static HTML + vanilla JS with Chart.js. No React, no build step.

**Why not Next.js/React?** Devbox is a constrained environment (4 vCPUs, 16GB). LibreChat already runs there. The dashboard needs to display tables and charts — that's it. A static HTML page with Chart.js and fetch() calls to a JSON API is the simplest thing that works. Jeremy can iterate on it without a frontend build pipeline.

**API Endpoints (Express):**

| Endpoint | Returns |
|----------|---------|
| `GET /api/runs` | List of test runs with summary stats |
| `GET /api/runs/:id` | Full run detail (all scenarios, all turns) |
| `GET /api/runs/:id/scenarios/:sid` | Single scenario detail with conversation transcript |
| `GET /api/compare?models=a,b,c` | Cross-model comparison for latest run |
| `GET /api/trends?metric=tool_use&days=30` | Time-series data for trend charts |
| `GET /api/costs` | Cost breakdown by model, scenario, run |

**Dashboard Pages:**

1. **Overview** — Latest run: pass/fail per scenario (green/yellow/red grid), overall score, total cost, model breakdown
2. **Run History** — Table of all runs with sparkline trends for key metrics
3. **Scenario Drilldown** — Click a scenario → full conversation transcript, per-turn scores, tool call details, DB mutations
4. **Model Comparison** — Side-by-side radar charts (tool use, character, coaching, cost) for each model
5. **Cost Analytics** — Bar charts for cost per scenario, cost per model, cost trend over time
6. **Regressions** — List of detected regressions across runs, sorted by severity

**Port:** `:3090` (avoids conflict with LibreChat on :3080)

### 4g. Metrics Definitions

| Metric | Formula | Target | Critical? |
|--------|---------|--------|-----------|
| **Tool Call Rate** | `actual_tool_calls / expected_tool_calls` | ≥ 0.95 | Yes |
| **Hallucination Rate** | `hallucinated_calls / (actual_calls + hallucinated_calls)` | 0.00 | Yes — any hallucination is a failure |
| **Resource Load Rate** | `resources_read_at_session_start / expected_resources` | ≥ 0.90 | Yes |
| **Character Consistency** | Average `character_consistency.score` across turns | ≥ 7.0 | No |
| **Coaching Effectiveness** | Average `coaching_quality.score` across turns | ≥ 7.0 | No |
| **Task Completion Rate** | `passing_scenarios / total_scenarios` | ≥ 0.80 | No |
| **Response Length Ratio** | `avg_response_tokens / avg_scout_message_tokens` | 1.0-3.0 | No — flags verbosity |
| **Guardrail Violation Rate** | `turns_with_violations / total_turns` | 0.00 | Yes |
| **Cost Per Passing Scenario** | `total_cost / passing_scenarios` | < $0.25 | No |
| **Latency P50 / P95** | Response time in ms | < 5s / < 15s | No |

**Hallucination Detection Logic:**

A tool call is classified as "hallucinated" when:
1. The model's response text describes calling a tool (e.g., "I've logged your chores") but the SSE stream contains no `tool_use` content block, OR
2. The model outputs a `tool_use` block but no corresponding `tool_result` block appears (MCP server never received it), OR
3. The model claims a result (e.g., "Your chore streak is now 15 days") but the MongoDB `chore_logs` collection has no matching new document

Detection approach: Compare three sources of truth:
- **Model output text** — what the AI claims happened (parsed for action verbs like "logged", "updated", "recorded")
- **SSE stream tool_use events** — what LibreChat actually dispatched
- **MongoDB state diff** — what actually changed in the database

---

## 5. Technology Stack Recommendations

| Component | Technology | Justification |
|-----------|-----------|---------------|
| **Test runner** | TypeScript + Node.js 24 | Matches MCP server codebase. Jeremy knows it. nvm already on devbox. |
| **HTTP client** | Native `fetch` (Node 24) | No dependencies needed. LibreChat API is standard REST + SSE. |
| **SSE parsing** | `eventsource-parser` npm package | Lightweight SSE parser. LibreChat streams responses as SSE. |
| **Scout simulator** | Direct Anthropic SDK (`@anthropic-ai/sdk`) | Call Haiku directly — don't route through LibreChat. |
| **Evaluator** | Direct Anthropic SDK (`@anthropic-ai/sdk`) | Call Sonnet directly — structured JSON output with `response_format`. |
| **MongoDB client** | `mongodb` npm package (native driver) | Already used by MCP server. No Mongoose overhead needed. |
| **Dashboard server** | Express.js | Minimal — serves static files + JSON API. |
| **Dashboard charts** | Chart.js (CDN) | No build step. Loaded via `<script>` tag. Radar, bar, line charts. |
| **Dashboard tables** | Vanilla HTML + CSS | Simple `<table>` elements. Sort/filter with vanilla JS. |
| **Task runner** | npm scripts in `package.json` | `npm run test:seed`, `npm run test:run`, `npm run test:dashboard`. |
| **CI trigger** | GitHub Actions | `.github/workflows/test-harness.yml` — triggered on push to main. SSH into devbox to run. |
| **Results storage** | MongoDB `test_harness` database | Collections: `runs`, `scenarios`, `turns`, `evaluations`, `costs`. Same MongoDB instance, separate database. |

**Why NOT Playwright for LibreChat interaction?** Playwright is great for browser automation, but LibreChat has a REST API. Using `fetch()` to hit the API directly is simpler, faster, and more reliable than simulating browser clicks. Playwright would add complexity (headless Chrome, page navigation, DOM parsing) for no benefit. The REST API gives us the same data more directly.

**Why NOT a separate test database?** The test harness needs to test the real MCP server behavior, which reads from the `scoutquest` database. Synthetic scout profiles go in the real `scouts` collection — the MCP server doesn't know the difference. Results go in a separate `test_harness` database to keep concerns separated.

---

## 6. Synthetic Scout Data Design

### Scout Profiles (8 profiles)

| ID | Name | Email | Age | Troop | Rank | Quest Status | Goal | Character |
|----|------|-------|-----|-------|------|-------------|------|-----------|
| alpha | Test Scout Alpha | test-scout-alpha@test.hexapax.com | 12 | T999 | Second Class | active | Gaming PC ($1200) | Guide + gamer_hardware |
| bravo | Test Scout Bravo | test-scout-bravo@test.hexapax.com | 14 | T999 | Star | active | Mountain Bike ($800) | Pathfinder + outdoor_adventure |
| charlie | Test Scout Charlie | test-scout-charlie@test.hexapax.com | 15 | T999 | Life | setup | Guitar + Amp ($600) | Trailblazer + music_audio |
| delta | Test Scout Delta | test-scout-delta@test.hexapax.com | 13 | T999 | First Class | active | Electric Skateboard ($500) | Pathfinder + vehicle |
| echo | Test Scout Echo | test-scout-echo@test.hexapax.com | 11 | T999 | Scout | setup | Telescope ($400) | Guide + custom |
| foxtrot | Test Scout Foxtrot | test-scout-foxtrot@test.hexapax.com | 14 | T999 | Star | active | Gaming PC ($1500) | Trailblazer + gamer_hardware |
| golf | Test Scout Golf | test-scout-golf@test.hexapax.com | 16 | T999 | Life | active | Car Insurance Fund ($2000) | Trailblazer + vehicle |
| hotel | Test Scout Hotel | test-scout-hotel@test.hexapax.com | 12 | T999 | Tenderfoot | active | Camping Gear ($350) | Guide + outdoor_adventure |

**Design Principles:**
- Cover all 3 base characters (Guide ×3, Pathfinder ×2, Trailblazer ×3)
- Cover all quest overlays (gamer ×2, outdoor ×2, music ×1, vehicle ×2, custom ×1)
- Range of ages (11-16), ranks (Scout through Life), and quest statuses
- All in fictional Troop 999 — clearly fake
- Email pattern `test-scout-*@test.hexapax.com` — easily filterable

### Per-Profile Seed Data

Each profile includes:
- `scouts` document with full `quest_state`, `character`, `chore_list`, `budget_projected`, `counselors`, `unit_leaders`, `parent_guardian`
- `users` document with role `test_scout`
- `requirements` documents (30 per scout — all PM/FL requirements at appropriate initial statuses based on quest_status)
- `setup_status` document (complete for "active" scouts, partial for "setup" scouts)
- `quest_plans` document with initial priorities and milestones
- Pre-existing `chore_logs` (for "active" scouts — 5-15 days of history to test streak calculations)
- Pre-existing `budget_entries` (for advanced scouts — 2-4 weeks to test budget summaries)

### Guide Profiles (2 profiles)

| Name | Email | Linked Scouts |
|------|-------|--------------|
| Test Guide Alpha | test-guide-alpha@test.hexapax.com | alpha, bravo, echo, hotel |
| Test Guide Bravo | test-guide-bravo@test.hexapax.com | charlie, delta, foxtrot, golf |

### Seed Script Design

**Location:** `testing/seed.ts`

```typescript
// Idempotent — safe to run repeatedly
async function seedTestData(db: Db): Promise<void> {
  // 1. Clear all test data (filter by troop: 'T999' or email pattern)
  await db.collection('scouts').deleteMany({ troop: 'T999' });
  await db.collection('users').deleteMany({ email: /^test-.*@test\.hexapax\.com$/ });
  await db.collection('requirements').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('chore_logs').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('budget_entries').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('quest_plans').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('setup_status').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('session_notes').deleteMany({ scout_email: /^test-scout-.*/ });
  // ... other collections

  // 2. Insert fresh profiles
  for (const profile of SCOUT_PROFILES) {
    await insertScout(db, profile);
    await insertRequirements(db, profile);
    await insertChoreHistory(db, profile);
    await insertBudgetHistory(db, profile);
    await insertQuestPlan(db, profile);
    await insertSetupStatus(db, profile);
  }

  // 3. Insert guide profiles
  for (const guide of GUIDE_PROFILES) {
    await insertGuide(db, guide);
  }
}
```

**Profile data file:** `testing/fixtures/profiles.ts` — TypeScript objects matching the `ScoutDocument` type definition from the MCP server's `types.ts`. Import the types directly to guarantee schema compatibility.

### Reset Strategy

Between test runs, reset scout data to baseline without touching LibreChat data:

```typescript
async function resetTestData(db: Db): Promise<void> {
  // Delete dynamic data (created during test runs)
  await db.collection('chore_logs').deleteMany({
    scout_email: /^test-scout-.*/,
    // Keep seeded history, delete test-created entries
    _test_seeded: { $ne: true }
  });
  await db.collection('budget_entries').deleteMany({
    scout_email: /^test-scout-.*/,
    _test_seeded: { $ne: true }
  });
  await db.collection('emails_sent').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('reminders').deleteMany({ scout_email: /^test-scout-.*/ });
  await db.collection('session_notes').deleteMany({
    scout_email: /^test-scout-.*/,
    _test_seeded: { $ne: true }
  });

  // Reset mutable fields on scout documents to baseline
  for (const profile of SCOUT_PROFILES) {
    await db.collection('scouts').updateOne(
      { email: profile.email },
      { $set: {
        'quest_state.current_savings': profile.quest_state.current_savings,
        'character.tone_dial': profile.character.tone_dial,
        'character.domain_intensity': profile.character.domain_intensity,
      }}
    );
  }

  // Reset requirement statuses to baseline
  // (advance_requirement may have changed them during tests)
  for (const profile of SCOUT_PROFILES) {
    for (const req of profile.requirements) {
      await db.collection('requirements').updateOne(
        { scout_email: profile.email, req_id: req.req_id },
        { $set: { status: req.initial_status } }
      );
    }
  }
}
```

**Seeded documents are tagged** with `_test_seeded: true` so reset can distinguish baseline data from test-generated data.

---

## 7. Implementation Phases

### Phase 1 — MVP (Get Signal Fast)

**Goal:** Can we detect tool hallucination and compare models? Ship the core loop.

**Deliverables:**

1. **Seed script** — 3 scout profiles (alpha, bravo, charlie), 1 guide profile
2. **LibreChat API client** — auth, send message, parse SSE, extract tool calls
3. **Scout simulator** — Haiku-based, 2 persona variations (Eager Eddie, Vague Val)
4. **Evaluator** — Sonnet-based, tool_use scoring only (skip character/coaching for now)
5. **3 core scenarios** — S1 (session start), S2 (log chores), S4 (ask about requirements)
6. **CLI output** — JSON results to stdout + MongoDB storage. No dashboard yet.
7. **Cost tracking** — Token counting and USD calculation per call
8. **Run across 3 models** — Claude Sonnet, Gemini Flash, GPT-4.1 mini

**MVP answers:** "Which model actually calls tools vs hallucinating?" — the single most valuable question.

**Estimated effort:** 20-25 hours

### Phase 2 — Full Harness

**Goal:** Complete scenario coverage, character evaluation, dashboard, regression detection.

**Deliverables:**

1. **All 20 scenarios** implemented (13 scout + 5 guide + 2 cross-cutting)
2. **All 5 persona variations** for scout simulator
3. **Full evaluator** — all 6 scoring dimensions (tool use, resources, character, coaching, response, guardrails)
4. **Dashboard** — Express + Chart.js, all 6 pages
5. **Regression detection** — compare runs, flag regressions
6. **Parallel execution** — 3 concurrent scenarios
7. **All 8 scout profiles + 2 guide profiles** seeded
8. **Reset between runs** working reliably
9. **Budget limits** enforced
10. **Haiku comparison** — add Claude Haiku as 4th model for cost analysis

**Estimated effort:** 35-45 hours

### Phase 3 — CI/CD + Advanced Analytics

**Goal:** Automated testing on every push, system prompt A/B testing, long-term trend analysis.

**Deliverables:**

1. **GitHub Actions workflow** — trigger test suite on push to `main`
   - SSH into devbox
   - Run `npm run test:seed && npm run test:run`
   - Post summary to PR comment (if applicable)
   - Fail CI if critical regressions detected
2. **System prompt A/B testing** — run same scenarios with different `promptPrefix` values, compare scores
3. **Long-term trend charts** — 30/60/90 day views of all metrics
4. **Alert system** — ntfy notification if regression detected on CI run
5. **Scenario builder** — simple YAML format for defining new scenarios without code changes
6. **Automated report generation** — Markdown summary of each run, committed to `docs/test-reports/`

**Estimated effort:** 20-25 hours

---

## 8. Infrastructure Recommendation

**Recommendation: Run on devbox alongside LibreChat. No separate VM.**

**Reasoning:**

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Devbox (recommended)** | LibreChat already running. MongoDB already there. No new infra. Zero deploy overhead. | Shares CPU/RAM with LibreChat. Limited to 3 parallel scenarios. | $0/month additional |
| Separate test VM | Isolated resources. Can run more parallel scenarios. | New Terraform config. New deploy scripts. Maintain two VMs. Double MongoDB. | ~$35/month (e2-standard-4) |
| Production VM | Tests against real production config. | Dangerous — test data could leak. Production impact. | $0 but high risk |

**Devbox is sufficient because:**
- e2-standard-4 has 4 vCPUs and 16GB RAM — LibreChat uses ~2GB idle, leaving plenty
- Test scenarios are I/O-bound (waiting for API responses), not CPU-bound
- 3 parallel scenarios × ~5 seconds per turn = manageable load
- MongoDB handles test data alongside LibreChat data fine (separate databases)
- The harness itself is lightweight Node.js — minimal resource overhead

**One caveat:** The devbox LibreChat config needs modification for testing:
- Enable `ALLOW_PASSWORD_SIGN_UP=true` in devbox `.env`
- Add the MCP servers (scout-quest, scout-guide) to devbox `librechat.yaml` — currently devbox only has claude-code and browser MCPs
- Ensure devbox MongoDB has the `scoutquest` database with proper collections

**Alternative: Deploy a test-only LibreChat.** Instead of modifying devbox's LibreChat config, deploy a second LibreChat instance on devbox (port 3085) configured specifically for testing. This isolates test config from dev config. **Downside:** More memory usage, more processes to manage. **I'd start with modifying devbox config and only add a second instance if it causes problems.**

---

## 9. Open Questions

1. **LibreChat message API format.** The exact REST API request/response format for sending messages isn't documented externally. Need to reverse-engineer by inspecting network traffic in devbox LibreChat, or read LibreChat source code. The SSE stream format for tool calls specifically needs investigation.

2. **Test user creation.** Can we use `/api/auth/register` programmatically, or does LibreChat require email verification? If verification is required, we may need to insert users directly into LibreChat's MongoDB `users` collection.

3. **Preset selection via API.** When sending a message via the REST API, how do we select a specific model preset (e.g., "Scout Coach (Claude)")? Do we pass `endpoint` + `model` + `mcpServers` explicitly, or reference the preset by name? This determines whether tests use the real preset config or a reconstructed version.

4. **SSE tool call format.** What do tool_use and tool_result events look like in LibreChat's SSE stream? Different providers (Anthropic, Google, OpenAI) may format these differently. Need to capture sample streams from each.

5. **MCP server startup time.** The MCP server spawns as a stdio subprocess per conversation. Is there startup latency (MongoDB connection, etc.) that could affect test timing? The `timeout: 30000` in librechat.yaml suggests this was a concern.

6. **Rate limits.** Anthropic rate limits for Haiku (simulator) + Sonnet (evaluator + system-under-test) running simultaneously. Need to check if devbox's API keys have sufficient rate limits for 3 parallel scenarios × 3 API calls per turn.

7. **Evaluator reliability.** How consistent is the evaluator's scoring? Should we run the evaluator twice per turn and average? This doubles evaluator cost but improves signal quality. Start without it, add if scores are noisy.

8. **Guide scenario auth.** Guide tools check `getUserRoles(email)` which requires the guide's email to be linked to scouts in the `users` collection. Need to verify the seed script creates the right user-role mappings.

---

## 10. Estimated Effort

| Phase | Scope | Hours | Calendar (part-time) |
|-------|-------|-------|---------------------|
| **Phase 1 — MVP** | Seed script, API client, simulator, evaluator (tool_use only), 3 scenarios, CLI output, 3-model comparison | 20-25h | 1-2 weeks |
| **Phase 2 — Full** | 20 scenarios, 5 personas, full evaluator, dashboard, regression detection, parallel execution, 8 profiles | 35-45h | 3-4 weeks |
| **Phase 3 — CI/CD** | GitHub Actions, A/B testing, trend charts, alerts, scenario YAML format | 20-25h | 2-3 weeks |
| **Total** | | **75-95h** | **6-9 weeks** |

**Phase 1 is the priority.** It answers the #1 question (do models hallucinate tool calls?) and gives a framework for everything else. Phases 2 and 3 can be done incrementally.

**Cost estimate per run (Phase 1, 3 scenarios × 3 models = 9 scenario-model pairs):**
- Simulator (Haiku): ~9 × 4 turns × ~$0.001/turn = ~$0.04
- System-under-test (mixed): ~9 × 4 turns × ~$0.01/turn = ~$0.36
- Evaluator (Sonnet): ~9 × 4 turns × ~$0.005/turn = ~$0.18
- **Total per run: ~$0.58**
- Daily CI runs (30 days): ~$17/month

**Cost estimate per run (Phase 2, 20 scenarios × 4 models = 80 scenario-model pairs):**
- **Total per run: ~$5-8**
- Daily CI runs: ~$150-240/month — may want to run weekly instead, or only on push

---

## Appendix A: Directory Structure

```
testing/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point (npm run test:run)
│   ├── config.ts             # Budget limits, pricing table, model configs
│   ├── seed.ts               # Seed/reset synthetic data
│   ├── client/
│   │   ├── librechat.ts      # LibreChat REST API + SSE client
│   │   └── llm.ts            # Direct Anthropic SDK for simulator/evaluator
│   ├── simulator/
│   │   ├── index.ts          # Scout simulator orchestrator
│   │   ├── personas.ts       # Persona definitions (Eddie, Val, Rex, etc.)
│   │   └── prompts.ts        # System prompts for simulator
│   ├── evaluator/
│   │   ├── index.ts          # Evaluator orchestrator
│   │   ├── prompts.ts        # Evaluator system prompt + scoring rubric
│   │   └── hallucination.ts  # Hallucination detection logic
│   ├── scenarios/
│   │   ├── index.ts          # Scenario registry
│   │   ├── scout/            # Scout-facing scenarios (S1-S13)
│   │   │   ├── s01-session-start.ts
│   │   │   ├── s02-log-chores.ts
│   │   │   └── ...
│   │   ├── guide/            # Guide-facing scenarios (G1-G5)
│   │   └── cross/            # Cross-cutting scenarios (X1-X2)
│   ├── harness/
│   │   ├── runner.ts         # Core test loop orchestrator
│   │   ├── parallel.ts       # Parallel scenario execution
│   │   ├── regression.ts     # Regression detection logic
│   │   └── cost.ts           # Cost tracking and budget enforcement
│   ├── dashboard/
│   │   ├── server.ts         # Express server (npm run dashboard)
│   │   ├── api.ts            # JSON API routes
│   │   └── public/           # Static HTML + JS + CSS
│   │       ├── index.html
│   │       ├── app.js
│   │       └── styles.css
│   └── fixtures/
│       ├── profiles.ts       # Synthetic scout/guide profile data
│       └── requirements.ts   # Baseline requirement states per profile
├── dist/                     # Compiled JS (gitignored)
└── README.md                 # How to run the harness
```

---

## Appendix B: MongoDB Collections (test_harness database)

```typescript
// test_harness.runs
interface TestRun {
  _id: ObjectId;
  run_id: string;           // UUID
  started_at: Date;
  completed_at: Date | null;
  status: 'running' | 'completed' | 'aborted';
  trigger: 'manual' | 'ci';
  git_sha: string;
  models_tested: string[];
  scenarios_total: number;
  scenarios_passed: number;
  scenarios_failed: number;
  total_cost_usd: number;
  regressions: RegressionCheck[];
  config: {                 // snapshot of run config
    budget_limits: typeof BUDGET_LIMITS;
    system_prompt_variant: string | null;
  };
}

// test_harness.scenario_results
interface ScenarioResult {
  _id: ObjectId;
  run_id: string;
  scenario_id: string;      // e.g., "S2"
  model: string;            // e.g., "claude-sonnet-4-6"
  endpoint: string;         // e.g., "anthropic"
  scout_profile: string;    // e.g., "alpha"
  persona: string;          // e.g., "vague_val"
  status: 'pass' | 'partial' | 'fail';
  overall_score: number;
  scores_by_dimension: Record<string, number>;
  total_turns: number;
  total_cost_usd: number;
  total_latency_ms: number;
  critical_failures: string[];
  started_at: Date;
  completed_at: Date;
}

// test_harness.turn_details
interface TurnDetail {
  _id: ObjectId;
  run_id: string;
  scenario_id: string;
  model: string;
  turn_number: number;
  scout_message: string;
  system_response: string;
  tool_calls_expected: string[];
  tool_calls_actual: string[];
  tool_calls_hallucinated: string[];
  resources_read: string[];
  db_mutations: Record<string, any>[];
  evaluation: EvaluatorOutput;  // full JSON from evaluator
  token_usage: {
    simulator: TokenUsage;
    system: TokenUsage;
    evaluator: TokenUsage;
  };
  latency_ms: number;
  timestamp: Date;
}

// test_harness.costs
interface CostEntry {
  _id: ObjectId;
  run_id: string;
  scenario_id: string;
  turn_number: number;
  role: 'simulator' | 'system' | 'evaluator';
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  timestamp: Date;
}
```
