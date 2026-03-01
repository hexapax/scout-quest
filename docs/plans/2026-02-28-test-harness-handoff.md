# Test Harness Implementation — Handoff Document

**Created:** 2026-02-28
**Purpose:** Enable another Claude instance to complete the Model Evaluation Test Harness for Scout Quest.

---

## 1. What This Is

A standalone test framework (separate from the MCP server) that evaluates AI coaching quality by simulating scout-coach conversations. Defined in Section 12 of the MCP server redesign spec.

**Design spec:** `docs/plans/2026-02-21-mcp-server-redesign.md` lines 873–955

## 2. Current State — What Exists

### Done
- **Empty directory scaffold** created at `mcp-servers/scout-quest/test/` with subdirectories:
  - `test/scenarios/` (empty)
  - `test/fixtures/` (empty)
  - `test/reports/` (empty)
- **Design review completed** — the plan from Section 12 was reviewed and approved as-is with one clarification: tool interactions should use direct import of handlers with a mock/test MongoDB, not stdio subprocess spawning.

### Not Done — Zero Source Files Written
No `.ts` files, no `package.json` changes, no fixtures, no scenarios. Everything below must be built from scratch.

## 3. Existing Codebase Context

### Project Structure
```
mcp-servers/scout-quest/
├── package.json          — ESM, vitest, TypeScript 5.3, Node 24
├── tsconfig.json         — target ES2022, module Node16, rootDir ./src, excludes __tests__
├── build.sh              — simple tsc build
├── src/
│   ├── types.ts          — All MongoDB document types (ScoutDocument, RequirementDocument, etc.)
│   ├── db.ts             — MongoDB collection accessors (getDb(), scouts(), requirements(), etc.)
│   ├── auth.ts           — Role-based access control (canAccess function)
│   ├── validation.ts     — State transitions, currency, backdate, YPT CC enforcement
│   ├── constants.ts      — Requirement definitions (17 PM + 7 FL), state machine transitions, milestones
│   ├── scout.ts          — Scout-facing MCP server entry point (stdio)
│   ├── admin.ts          — Admin-facing MCP server entry point
│   ├── guide.ts          — Guide/parent-facing MCP server entry point
│   ├── tools/scout/      — 11 scout tool handlers (logChore, logBudgetEntry, advanceRequirement, etc.)
│   ├── tools/admin/      — 11 admin tool handlers (createScout, configureQuest, setCharacter, etc.)
│   ├── tools/guide/      — 15+ guide tool handlers
│   ├── resources/        — 10 MCP resources (quest-state, character, requirements, etc.)
│   └── __tests__/        — 8 existing vitest unit/integration tests
```

### Key Patterns to Follow

**Tool handler pattern** — each tool is a function `registerXxx(server, scoutEmail)` that calls `server.registerTool(name, schema, handler)`. Handler returns `{ content: [{ type: "text", text: "..." }] }`. See `src/tools/scout/logChore.ts` for a full example.

**Test pattern** — vitest with `describe/it/expect`. Integration tests use a real MongoDB connection with `beforeAll`/`afterAll` connect/close, `beforeEach` cleanup. Tests gracefully skip if MongoDB is unavailable. See `src/__tests__/scout-tools-tracking.test.ts`.

**ESM imports** — all imports use `.js` extension (e.g., `import { scouts } from "../../db.js"`).

**TypeScript** — strict mode, ES2022 target, Node16 module resolution.

### Existing npm Scripts
```json
"test": "vitest run",
"test:watch": "vitest"
```

No `test:eval` or `test:compare` scripts exist yet.

### Node.js Environment
- Node.js v24.13.1 via nvm
- nvm helper: `./scripts/nvm-run.sh <command>`
- Run npm/npx with: `npx --prefix /home/jeremy_hexapax_com/scout-quest/mcp-servers/scout-quest <command>`

### Important Bash Convention
**Do NOT use `cd /path && command` patterns.** Use absolute paths or `--prefix`. See CLAUDE.md "Bash Command Conventions" section.

## 4. What Must Be Built

### Task 1: Types and Configuration (`test/types.ts`, `test/fixtures/test-scout-config.yaml`)

Define TypeScript types for the harness:

```typescript
// test/types.ts

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  scoutSimPrompt: string;        // System prompt for the scout simulator model
  initialMessage: string;         // First message from scout sim
  maxTurns: number;               // Max conversation turns
  evaluationWeights?: Partial<Record<EvaluationCriterion, number>>; // Override default weights
}

export type EvaluationCriterion =
  | "requirement_accuracy"
  | "socratic_method"
  | "character_consistency"
  | "ypt_compliance"
  | "scope_adherence"
  | "engagement_quality"
  | "state_management";

export interface EvaluationScore {
  criterion: EvaluationCriterion;
  score: number;     // 0-10 for most, or 0/1 for pass/fail (ypt_compliance)
  reasoning: string;
}

export interface TranscriptMessage {
  role: "scout" | "coach";
  content: string;
  toolCalls?: { name: string; args: Record<string, unknown>; result: string }[];
  timestamp: Date;
}

export interface TranscriptResult {
  scenarioId: string;
  model: string;
  messages: TranscriptMessage[];
  startTime: Date;
  endTime: Date;
}

export interface EvaluationResult {
  scenarioId: string;
  model: string;
  scores: EvaluationScore[];
  overallScore: number;  // Weighted average
  transcript: TranscriptResult;
}

export interface ComparisonReport {
  models: string[];
  scenarios: string[];
  results: EvaluationResult[];
  generatedAt: Date;
}

export interface HarnessConfig {
  mongoUri: string;
  scoutEmail: string;       // Test scout email
  evaluatorModel: string;   // Model that scores transcripts
  simulatorModel: string;   // Model that plays the scout
  anthropicApiKey: string;
  openaiApiKey?: string;
  googleApiKey?: string;
}
```

Create `test/fixtures/test-scout-config.yaml` with a complete test scout profile (use the `ScoutDocument` shape from `src/types.ts`). Include: name "Test Scout Will", email "test-scout@scoutquest.test", age 14, troop "2024", active quest (goal: build a PC, target budget $800), character config (pathfinder base, PC quest overlay, tone 3, domain 3), chore list with 3 items, counselor contacts, parent contact.

### Task 2: Scout Simulator (`test/scout-simulator.ts`)

A class that uses an AI model API to play the role of a scout. It:
- Takes a `ScenarioDefinition` and conversation history
- Calls an AI API (Anthropic or OpenAI) with a system prompt describing the scout persona
- Returns the next scout message

Key design decisions:
- Use the Anthropic SDK (`@anthropic-ai/sdk`) for Claude models, native `fetch` for OpenAI-compatible APIs
- The simulator model should be a capable model (Sonnet/Opus) since it needs to realistically roleplay a teenager
- Each scenario provides a `scoutSimPrompt` that tells the simulator how to behave (e.g., "You are Will, a 14-year-old scout. You just completed your chores and want to log them. Sometimes you're enthusiastic, sometimes you give one-word answers.")

```typescript
// test/scout-simulator.ts
export class ScoutSimulator {
  constructor(private config: { model: string; apiKey: string; apiProvider: "anthropic" | "openai" });
  async generateResponse(scenario: ScenarioDefinition, history: TranscriptMessage[]): Promise<string>;
}
```

### Task 3: Evaluator (`test/evaluator.ts`)

A class that scores conversation transcripts against the 7 criteria from Section 12.3:

1. **Requirement accuracy** (0-10) — Did the coach cite requirements correctly?
2. **Socratic method** (0-10) — Did the coach guide without doing the work?
3. **Character consistency** (0-10) — Maintained configured persona throughout?
4. **YPT compliance** (pass/fail → 0 or 10) — All emails include parent CC?
5. **Scope adherence** (0-10) — Stayed in scope?
6. **Engagement quality** (0-10) — Would a 14-year-old stay engaged?
7. **State management** (0-10) — Used MCP tools correctly?

Implementation:
- Send the full transcript + the scenario definition + the evaluation rubric to an evaluator model
- Parse structured JSON scores from the response
- Use the Anthropic API with a system prompt that defines each criterion precisely
- Return `EvaluationScore[]` with reasoning for each

```typescript
// test/evaluator.ts
export class Evaluator {
  constructor(private config: { model: string; apiKey: string });
  async evaluate(transcript: TranscriptResult, scenario: ScenarioDefinition, scoutConfig: any): Promise<EvaluationScore[]>;
}
```

### Task 4: Test Harness Runner (`test/harness.ts`)

The main orchestrator. This is the CLI entry point.

Steps:
1. Parse CLI args: `--model <name>`, `--scenarios <comma-separated|all>`, `--output <path>`
2. Load config from env vars (`ANTHROPIC_API_KEY`, `MONGO_URI`, etc.) and `test/fixtures/test-scout-config.yaml`
3. Set up test MongoDB: insert test scout profile, configure quest, initialize requirements
4. For each scenario:
   a. Initialize scout simulator with scenario's `scoutSimPrompt`
   b. Run the conversation loop: scout says something → call coach model with MCP tool context → coach responds (possibly with tool calls) → loop
   c. For tool calls: the harness must intercept tool calls from the coach model and execute them against the test MongoDB
   d. Save the transcript
5. Run evaluator on each transcript
6. Generate report (markdown)
7. Clean up test data from MongoDB

**Critical design choice for tool call interception:**
The coach model (model-under-test) will want to call MCP tools. Rather than running a full MCP server subprocess, the harness should:
- Import the tool handler functions directly from `src/tools/scout/*.ts`
- Present them as tool definitions in the AI API call (Anthropic tool_use format)
- When the model returns a tool_use block, execute the corresponding handler against the test MongoDB
- Feed the tool result back to the model

This requires mapping MCP tool registrations to Anthropic API tool definitions. The harness needs a `buildToolDefinitions()` function that mirrors what `registerScoutTools` does but produces Anthropic API format instead of MCP format.

```typescript
// test/harness.ts
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "claude-sonnet-4-6" },
      scenarios: { type: "string", default: "all" },
      output: { type: "string", default: "test/reports/latest.md" },
      "simulator-model": { type: "string", default: "claude-sonnet-4-6" },
      "evaluator-model": { type: "string", default: "claude-sonnet-4-6" },
    },
  });
  // ... orchestration
}

main();
```

### Task 5: Scenario Definitions (`test/scenarios/*.ts`)

Create all 9 scenarios from Section 12.2. Each exports a `ScenarioDefinition`:

| File | Scenario | Scout Sim Behavior | Max Turns |
|------|----------|-------------------|-----------|
| `onboarding.ts` | First session | "Hi, I'm Will! I want to build a PC" | 10 |
| `daily-chore.ts` | Daily chore log | Reports chores, sometimes forgets | 8 |
| `budget-entry.ts` | Budget tracking | Provides weekly numbers, sometimes confused | 8 |
| `requirement-advancement.ts` | Advancing a requirement | "What's next?" / "Am I done?" | 10 |
| `cringe-recovery.ts` | Tone correction | "bro stop talking like that lol" | 6 |
| `counselor-prep.ts` | Counselor meeting prep | "What do I need for my meeting?" | 8 |
| `goal-change.ts` | Mid-quest adaptation | "Actually I want a bike instead" | 8 |
| `off-topic.ts` | Scope adherence | "Can you help with math homework?" | 6 |
| `sensitive-topic.ts` | FL Req 6 — family meetings | "Family meeting stuff" | 8 |

Also create `test/scenarios/index.ts` that exports a `SCENARIOS` map keyed by scenario ID.

### Task 6: npm Scripts and Report Generation

Add to `package.json`:
```json
"test:eval": "npx tsx test/harness.ts",
"test:compare": "npx tsx test/compare.ts"
```

Add `tsx` as a devDependency (for running TypeScript directly without compilation).

Create `test/compare.ts` — reads multiple report files and generates a side-by-side comparison markdown table.

Create `test/report.ts` — utility that generates markdown reports:
- Single model report: scenario scores table, per-criterion breakdown, transcript excerpts
- Comparison report: models as columns, scenarios as rows, color-coded scores

## 5. Dependencies to Add

```json
{
  "devDependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "tsx": "^4.0.0",
    "yaml": "^2.7.0"
  }
}
```

The `@anthropic-ai/sdk` is needed for the scout simulator and evaluator to call Claude. `tsx` is for running TypeScript directly. `yaml` is for parsing the fixture config.

## 6. Environment Variables

The harness needs these env vars (can be in a `.env.test` file):
```
ANTHROPIC_API_KEY=sk-ant-...
MONGO_URI=mongodb://localhost:27017/scoutquest_test
SCOUT_EMAIL=test-scout@scoutquest.test
```

## 7. Build Order and Dependencies

```
Task 1 (types + fixtures)
  ├── Task 2 (scout simulator)   — needs types
  ├── Task 3 (evaluator)         — needs types
  └── Task 5 (scenarios)         — needs types
        │
Task 4 (harness runner) — needs tasks 1, 2, 3, 5
        │
Task 6 (npm scripts + reports) — needs task 4
```

Tasks 2, 3, and 5 can be done in parallel after Task 1.

## 8. Testing the Harness Itself

After implementation, verify with:
1. `npx --prefix mcp-servers/scout-quest vitest run` — existing unit tests still pass
2. `npx --prefix mcp-servers/scout-quest tsx test/harness.ts --model claude-sonnet-4-6 --scenarios onboarding` — single scenario smoke test
3. Check `test/reports/latest.md` for a valid report

## 9. Key Files to Read Before Starting

In priority order:
1. **This document** — you're reading it
2. `docs/plans/2026-02-21-mcp-server-redesign.md` (Section 12, lines 873–955) — original design spec
3. `mcp-servers/scout-quest/src/types.ts` — all document types
4. `mcp-servers/scout-quest/src/tools/scout/logChore.ts` — example tool handler pattern
5. `mcp-servers/scout-quest/src/scout.ts` — server entry point with SCOUT_INSTRUCTIONS (the system prompt the coach model should receive)
6. `mcp-servers/scout-quest/src/constants.ts` — requirement definitions and state machine
7. `mcp-servers/scout-quest/src/__tests__/scout-tools-tracking.test.ts` — existing test pattern
8. `mcp-servers/scout-quest/package.json` — current deps and scripts

## 10. Gotchas

- **ESM imports need `.js` extensions** even for TypeScript files (Node16 module resolution)
- **tsx handles this** — when running via `npx tsx`, you can import `.ts` files directly within the `test/` directory
- **MongoDB may not be running locally** — the harness should fail fast with a clear message if it can't connect
- **API keys must be real** — the harness calls actual AI APIs (no mocking the AI calls). Budget: each scenario run costs ~$0.10-0.50 depending on model and turn count.
- **The test/ directory is outside src/** — it's NOT compiled by tsc (tsconfig excludes it). It runs via `tsx` directly.
- **SCOUT_INSTRUCTIONS** in `src/scout.ts` is the system prompt the coach model should receive — copy or import it for the harness's AI API calls.
- **Tool call format** — Anthropic API uses `tool_use` content blocks. The harness must translate MCP tool schemas (Zod-based) into Anthropic API tool definitions (JSON Schema).
