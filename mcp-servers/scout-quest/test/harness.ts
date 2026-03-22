#!/usr/bin/env node
/**
 * Scout Quest Test Harness — main CLI entry point.
 *
 * Orchestrates: seed → run scenarios → evaluate → report.
 *
 * Usage:
 *   npx tsx test/harness.ts --model claude-sonnet-4-6 --scenarios all
 *   npx tsx test/harness.ts --model claude-sonnet-4-6 --scenarios daily-chore,off-topic
 *   npx tsx test/harness.ts --model claude-sonnet-4-6 --scenarios daily-chore --dry-run
 */

import { parseArgs } from "node:util";
import { MongoClient, Db } from "mongodb";
import Anthropic from "@anthropic-ai/sdk";

import type {
  HarnessConfig,
  TranscriptMessage,
  TranscriptResult,
  EvaluationResult,
  ToolCallRecord,
  HallucinationRecord,
  EvaluationCriterion,
  TestRunCapture,
  AnthropicToolDef,
  ChainStep,
  ChainStepResult,
  ChainRunResult,
  ScenarioDefinition,
  DEFAULT_WEIGHTS,
} from "./types.js";
import { DEFAULT_WEIGHTS as WEIGHTS } from "./types.js";
import { SCENARIOS, SCENARIO_IDS } from "./scenarios/index.js";
import { CHAINS, CHAIN_IDS } from "./chains/index.js";
import { ScoutSimulator } from "./scout-simulator.js";
import { Evaluator, EVALUATOR_SYSTEM_PROMPT } from "./evaluator.js";
import { SCOUT_TOOL_DEFINITIONS, dispatchToolCall } from "./tool-definitions.js";
import { GUIDE_TOOL_DEFINITIONS, dispatchGuideToolCall } from "./tool-definitions-guide.js";
import { analyzeTranscript } from "./hallucination.js";
import { captureSnapshot, diffSnapshots } from "./db-snapshot.js";
import {
  TEST_SCOUT_EMAIL,
  TEST_GUIDE_EMAIL,
  TEST_SCOUT,
  TEST_SCOUT_USER,
  TEST_GUIDE_USER,
  buildTestRequirements,
  buildTestChoreHistory,
  buildTestBudgetHistory,
} from "./fixtures/profiles.js";
import { generateReport } from "./report.js";

// ---------------------------------------------------------------------------
// SCOUT_INSTRUCTIONS — copied from src/scout.ts to provide as system prompt
// to the model-under-test.
// ---------------------------------------------------------------------------

const SCOUT_INSTRUCTIONS = `SCOUT QUEST MCP — SESSION PROTOCOL

You have access to the Scout Quest system for guiding scouts through
Personal Management and Family Life merit badges.

TOOL DISCIPLINE — READ THIS FIRST:
1. CONFIRM before you act. Ask the scout what they did BEFORE calling any tool.
   Do NOT assume or guess — get explicit confirmation of the details first.
2. Call each tool ONCE per action. If you already called log_chore this session
   and it succeeded, do NOT call it again — chores are done for today.
3. If a tool returns an error (e.g., "already logged", "duplicate"), STOP.
   Tell the scout what happened and move on. NEVER retry a failed tool call.
4. TRACK what you've already done. Before calling any tool, ask yourself:
   "Did I already call this tool for this action in this conversation?"
   If yes, do NOT call it again. The data is already recorded.
5. Read the tool result carefully. The tool response contains the real data
   (streak count, savings total, etc.). Use THAT data in your reply — do not
   make up numbers or ignore what the tool returned.
6. NEVER simulate, fake, or pretend to call a tool. If a tool call fails,
   report the error honestly. If no profile is found, say so.
7. If you need data, READ the resource. If you need to record something,
   CALL the tool. One call, then use the result.

READ TOOLS (use these to check state before acting):
- read_quest_state — goal, savings, target budget, progress percentage
- read_requirements — all requirement statuses (or pass req_id for one)
- read_budget_summary — weeks tracked, projected vs actual, savings toward goal
- read_chore_streak — current streak, total earned, FL Req 3 progress
- read_last_session — most recent session notes from prior session
- read_quest_plan — coaching plan, milestones, observations

SESSION START PROTOCOL — DO THIS FIRST, EVERY SESSION:
1. Call read_quest_state AND read_requirements AND read_last_session in parallel
2. Use the last session notes to pick up where you left off (pending items, next focus)
3. Greet the scout with awareness of their current situation

Use read tools whenever you need data — do NOT guess or make up numbers.
The read tools return the real DB state.

MUTATION TOOLS (call ONCE per action, never retry on error):
- log_chore — when scout confirms which chores they completed. ASK FIRST, log ONCE.
- log_budget_entry — weekly budget tracking
- advance_requirement — move requirements through states
- compose_email — generate mailto: links. ALWAYS includes parent CC (YPT)
- log_diary_entry — PM Req 8 daily diary
- send_notification — push alerts via ntfy (use sparingly)
- adjust_tone — when scout signals cringe or wants more personality
- setup_time_mgmt — initialize the 1-week PM Req 8 exercise
- update_quest_goal — if the scout's goal changes
- update_quest_plan — when your coaching strategy changes
- log_session_notes — capture what happened this session

TOOL CALL FLOW (follow this for every mutation):
1. LISTEN — let the scout tell you what they did or want
2. CLARIFY — ask if anything is unclear ("Which chores?" / "How much?")
3. CONFIRM — repeat back what you'll log ("So dishes and trash today?")
4. CALL — make ONE tool call with the confirmed details
5. REPORT — share the tool result with the scout (streak, savings, etc.)
If the tool returns an error, explain it and ask what to do next. Do NOT retry.

CHARACTER — THIS IS NOT OPTIONAL:
- The scout's profile below defines your persona.
- base character: your core personality (Guide, Pathfinder, or Trailblazer)
- quest overlay: your domain vocabulary (e.g., gamer_hardware, outdoor_gear).
  USE domain terms naturally in conversation. At domain_intensity 3+, weave
  in 1-2 domain references per response (e.g., "nice combo — that's like
  upgrading your RAM and GPU in the same build").
- tone_dial: 1=minimal personality, 5=maximum personality. Match this level.
- avoid list: NEVER use words/phrases on the avoid list.
- Stay in character for the ENTIRE session. Don't drop it mid-conversation.

CRITICAL RULES:
- NEVER do the scout's work for them. Guide with questions, templates, review.
- NEVER write emails, budgets, or plans FOR the scout. Help them build it.
- NEVER pretend to call a tool or fabricate tool output. Actually call it.
- compose_email ALWAYS CCs the parent/guardian (YPT — automatic).
- Requirements must be met "as stated — no more and no less."
- Only counselors sign off requirements (you cannot mark signed_off).
- If the scout signals cringe, use adjust_tone immediately, then keep going.
- Celebrate milestones. Daily chore logs are a grind — make them worth it.
- For sensitive Family Life topics (Req 6b), drop tone to level 2 automatically.
- Match the scout's message length. Don't write paragraphs for "yeah."

SCOUT PROFILE (embedded for this test session):
{SCOUT_PROFILE}`;

// ---------------------------------------------------------------------------
// GUIDE_INSTRUCTIONS — system prompt for the guide (parent/scouter) endpoint
// ---------------------------------------------------------------------------

const GUIDE_INSTRUCTIONS = `SCOUT GUIDE — COACHING & MONITORING TOOLS

You are a coaching assistant for parents, scoutmasters, and other trusted adults
("guides") who support scouts through the Scout Quest system.

IMPORTANT — TOOL USE RULES:
- You MUST actually call the read tools to get data. NEVER fabricate or guess data.
- If a tool call fails, report the error honestly.
- If no profile is found, say so — do not fabricate data.

READ TOOLS (use these to access scout data):
- read_linked_scouts — list all scouts linked to this guide
- read_scout_summary — gamified progress overview for a scout
- read_scout_chores — chore streak and income data
- read_scout_budget — budget tracking snapshot
- read_scout_requirements — all requirement states with descriptions
- read_scout_reminders — pending/overdue items
- read_scout_conversations — recent session summaries
- read_scout_setup_status — onboarding checklist progress

SESSION START PROTOCOL:
1. Call read_linked_scouts to see all scouts linked to this guide
2. If no scouts found, explain the Scoutbook requirement
3. Use read tools to answer questions — never guess at numbers

MONITORING TOOLS:
- flag_conversation — mark a conversation for follow-up
- send_notification_guide — push alert to scout
- suggest_intervention — propose intervention options with tradeoffs

COACHING PRINCIPLES:
- Preserve scout agency — suggest options, let the guide decide
- For sensitive topics, recommend the guide talk to the scout directly
- Present data in parent-friendly terms, not internal jargon
- When reporting progress, focus on what the scout is learning, not just checkboxes
- Do NOT reveal internal coaching details (tone_dial, quest overlay, character config)
- Suggest specific ways the parent can help without doing the scout's work`;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "claude-sonnet-4-6" },
    scenarios: { type: "string", default: "all" },
    chain: { type: "string", default: "" },
    output: { type: "string", default: "test/reports/latest.md" },
    "simulator-model": { type: "string", default: "claude-haiku-4-5-20251001" },
    "evaluator-model": { type: "string", default: "claude-sonnet-4-6" },
    "dry-run": { type: "boolean", default: false },
    "skip-eval": { type: "boolean", default: false },
    "mongo-uri": { type: "string", default: "" },
    thinking: { type: "boolean", default: false },
    "thinking-budget": { type: "string", default: "2000" },
    "json-output": { type: "string", default: "" },
    layer: { type: "string", default: "full" },
  },
  allowPositionals: true,
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Scout Quest Test Harness ===\n");

  const chainMode = !!args.chain;

  // Validate chain or scenario selection
  if (chainMode) {
    if (!CHAINS.has(args.chain!)) {
      console.error(`Error: Unknown chain "${args.chain}". Available: ${CHAIN_IDS.join(", ")}`);
      process.exit(1);
    }
  } else {
    // Resolve scenario list
    var scenarioIds =
      args.scenarios === "all" ? SCENARIO_IDS : args.scenarios!.split(",").map((s) => s.trim());

    for (const id of scenarioIds) {
      if (!SCENARIOS.has(id)) {
        console.error(`Error: Unknown scenario "${id}". Available: ${SCENARIO_IDS.join(", ")}`);
        process.exit(1);
      }
    }
  }

  console.log(`Model under test: ${args.model}`);
  if (chainMode) {
    console.log(`Chain:            ${args.chain}`);
  } else {
    console.log(`Scenarios:        ${scenarioIds!.join(", ")}`);
  }
  console.log(`Dry run:          ${args["dry-run"]}`);
  console.log();

  // Dry run — no API key or MongoDB needed
  if (args["dry-run"]) {
    if (chainMode) {
      const chain = CHAINS.get(args.chain!)!;
      console.log(`Dry run — chain: ${chain.name}\n`);
      for (const step of chain.steps) {
        console.log(`  Step ${step.id}: ${step.description}`);
        console.log(`    maxTurns: ${step.maxTurns}, expected tools: ${(step.expectedTools || []).join(", ") || "none"}`);
        if (step.expectedMutations) console.log(`    expected mutations: ${step.expectedMutations.join(", ")}`);
      }
    } else {
      console.log("Dry run — listing scenarios and exiting.\n");
      for (const id of scenarioIds!) {
        const s = SCENARIOS.get(id)!;
        console.log(`  ${s.id}: ${s.name} (${s.maxTurns} turns, expected tools: ${(s.expectedTools || []).join(", ") || "none"})`);
      }
    }
    return;
  }

  // Resolve config (only needed for actual runs)
  const config: HarnessConfig = {
    mongoUri: args["mongo-uri"] || process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest_test",
    scoutEmail: TEST_SCOUT_EMAIL,
    evaluatorModel: args["evaluator-model"]!,
    simulatorModel: args["simulator-model"]!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    modelUnderTest: args.model!,
    budgetPerScenario: 0.50,
    budgetPerRun: 10.00,
    thinkingEnabled: args.thinking!,
    thinkingBudget: parseInt(args["thinking-budget"]!, 10),
  };

  if (!config.anthropicApiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  console.log(`Simulator model:  ${config.simulatorModel}`);
  console.log(`Evaluator model:  ${config.evaluatorModel}`);
  if (config.thinkingEnabled) {
    console.log(`Thinking:         enabled (budget: ${config.thinkingBudget} tokens)`);
  }
  console.log(`MongoDB:          ${config.mongoUri}`);
  console.log(`Output:           ${args.output}`);
  console.log();

  // Connect to MongoDB
  let client: MongoClient | null = null;
  let db: Db | null = null;
  try {
    client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db();
    console.log("Connected to MongoDB.\n");
  } catch (err) {
    console.error("Cannot connect to MongoDB:", err);
    console.error("Run with --dry-run to test without MongoDB, or set MONGO_URI.");
    process.exit(1);
  }

  try {
    if (chainMode) {
      await runChainMode(config, db);
    } else {
      await runScenarioMode(config, db, scenarioIds!);
    }
  } finally {
    await cleanupTestData(db);
    if (client) await client.close();
    console.log("\nDone.");
  }
}

// ---------------------------------------------------------------------------
// Scenario mode (original behavior)
// ---------------------------------------------------------------------------

async function runScenarioMode(config: HarnessConfig, db: Db, scenarioIds: string[]): Promise<void> {
  // 1. Seed test data
  await seedTestData(db);

  // 2. Run scenarios
  const results: EvaluationResult[] = [];
  const captures: TestRunCapture[] = [];

  for (const scenarioId of scenarioIds) {
    const scenario = SCENARIOS.get(scenarioId)!;
    console.log(`\n--- Running: ${scenario.name} (${scenario.id}) ---\n`);

    const { evaluation, capture } = await runScenario(config, db, scenario);
    results.push(evaluation);
    captures.push(capture);

    // Print quick summary
    const status = evaluation.hallucinations.length > 0
      ? "FAIL (hallucination)"
      : evaluation.overallScore >= 7
      ? "PASS"
      : evaluation.overallScore >= 5
      ? "PARTIAL"
      : "FAIL";

    console.log(`\n  Result: ${status} (score: ${evaluation.overallScore.toFixed(1)}/10)`);
    if (evaluation.hallucinations.length > 0) {
      console.log(`  Hallucinations detected: ${evaluation.hallucinations.length}`);
      for (const h of evaluation.hallucinations) {
        console.log(`    - Turn ${h.turnIndex}: ${h.type} — ${h.description}`);
      }
    }

    // Reset test data between scenarios
    await resetTestData(db);
  }

  // 3. Generate reports
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");

  // Markdown report (legacy)
  const report = generateReport(results, config);
  const outputPath = args.output!;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, "utf-8");
  console.log(`\nReport written to ${outputPath}`);

  // JSON captures — use --json-output if specified, otherwise timestamped subdirectory
  let runDir: string;
  if (args["json-output"]) {
    runDir = args["json-output"];
  } else {
    const outputDir = dirname(outputPath);
    const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    runDir = join(outputDir, "scenarios", runTimestamp);
  }
  mkdirSync(runDir, { recursive: true });
  for (const capture of captures) {
    const jsonPath = join(runDir, `${capture.scenario.id}.json`);
    writeFileSync(jsonPath, JSON.stringify(capture, null, 2), "utf-8");
    console.log(`Capture written to ${jsonPath}`);
  }

  // Print summary
  console.log("\n=== Summary ===\n");
  const passed = results.filter((r) => r.overallScore >= 7 && r.hallucinations.length === 0).length;
  const partial = results.filter((r) => r.overallScore >= 5 && r.overallScore < 7 && r.hallucinations.length === 0).length;
  const failed = results.length - passed - partial;
  console.log(`  Passed:  ${passed}/${results.length}`);
  console.log(`  Partial: ${partial}/${results.length}`);
  console.log(`  Failed:  ${failed}/${results.length}`);

  const avgScore = results.reduce((s, r) => s + r.overallScore, 0) / results.length;
  console.log(`  Average: ${avgScore.toFixed(1)}/10`);

  const totalHallucinations = results.reduce((s, r) => s + r.hallucinations.length, 0);
  if (totalHallucinations > 0) {
    console.log(`\n  !! ${totalHallucinations} total hallucination(s) detected !!`);
  }
}

// ---------------------------------------------------------------------------
// Chain mode — multi-session progression testing
// ---------------------------------------------------------------------------

async function runChainMode(config: HarnessConfig, db: Db): Promise<void> {
  const chain = CHAINS.get(args.chain!)!;
  const chainStart = new Date();

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Chain: ${chain.name.padEnd(40)}║`);
  console.log(`║  Steps: ${String(chain.steps.length).padEnd(40)}║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  // Seed once — no reset between steps
  await seedTestData(db);

  // For guide endpoint, seed additional data the parent would see
  const endpoint = chain.endpoint || "scout";
  if (endpoint === "guide") {
    await seedGuideTestData(db);
  }

  // Build endpoint config for non-scout endpoints
  let endpointConfig: EndpointConfig | undefined;
  if (endpoint === "guide") {
    const linkedEmails = [config.scoutEmail];
    endpointConfig = {
      endpoint: "guide",
      systemPrompt: GUIDE_INSTRUCTIONS,
      toolDefinitions: GUIDE_TOOL_DEFINITIONS,
      dispatch: (d: Db, name: string, a: Record<string, unknown>) =>
        dispatchGuideToolCall(d, TEST_GUIDE_EMAIL, linkedEmails, name, a),
    };
  }

  const stepResults: ChainStepResult[] = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    console.log(`\n┌─── Step ${i + 1}/${chain.steps.length}: ${step.id} ───`);
    console.log(`│ ${step.description}`);
    if (step.expectedMutations) {
      console.log(`│ Expected: ${step.expectedMutations.join(", ")}`);
    }
    console.log(`└${"─".repeat(50)}\n`);

    // Apply pre-step mutations (e.g., counselor sign-off)
    if (step.preStepMutations) {
      for (const mut of step.preStepMutations) {
        await db.collection(mut.collection).updateOne(mut.filter, mut.update);
      }
      console.log(`  [SETUP] Applied ${step.preStepMutations.length} pre-step mutation(s)`);
    }

    // Snapshot DB before
    const dbBefore = await captureSnapshot(db, config.scoutEmail);

    // Convert ChainStep → ScenarioDefinition for runScenario
    const scenarioDef: ScenarioDefinition = {
      id: `${chain.id}/${step.id}`,
      name: `${chain.name} — ${step.id}`,
      description: step.description + (step.evaluatorContext ? `\n\nEVALUATOR CONTEXT: ${step.evaluatorContext}` : ""),
      scoutSimPrompt: step.scoutSimPrompt,
      initialMessage: step.initialMessage,
      maxTurns: step.maxTurns,
      expectedTools: step.expectedTools,
      evaluationWeights: step.evaluationWeights,
    };

    const { evaluation, capture } = await runScenario(config, db, scenarioDef, endpointConfig);

    // Snapshot DB after
    const dbAfter = await captureSnapshot(db, config.scoutEmail);
    const changes = diffSnapshots(dbBefore, dbAfter);

    stepResults.push({ stepId: step.id, evaluation, capture, dbBefore, dbAfter });

    // Print step result
    const status = evaluation.hallucinations.length > 0
      ? "FAIL (hallucination)"
      : evaluation.overallScore >= 7
      ? "PASS"
      : evaluation.overallScore >= 5
      ? "PARTIAL"
      : "FAIL";

    console.log(`\n  Step result: ${status} (score: ${evaluation.overallScore.toFixed(1)}/10)`);
    if (changes.length > 0) {
      console.log(`  DB changes: ${changes.join(", ")}`);
    } else {
      console.log(`  DB changes: none`);
    }

    if (evaluation.hallucinations.length > 0) {
      console.log(`  Hallucinations: ${evaluation.hallucinations.length}`);
      for (const h of evaluation.hallucinations) {
        console.log(`    - Turn ${h.turnIndex}: ${h.type} — ${h.description}`);
      }
    }

    // Do NOT reset between steps — this is the key difference from scenario mode.
    // Replace coach-generated session notes with a Haiku-generated summary that
    // captures the full conversation context (the coach only sees tool calls,
    // Haiku sees the entire transcript).
    await db.collection("session_notes").deleteMany({
      scout_email: config.scoutEmail,
      _test_seeded: { $ne: true },
    });

    // Generate rich session notes via Haiku from the full transcript
    const haikuNotes = await generateSessionNotes(
      config.anthropicApiKey,
      config.simulatorModel, // Haiku
      capture.transcript,
      step,
    );
    if (haikuNotes) {
      await db.collection("session_notes").insertOne({
        scout_email: config.scoutEmail,
        session_date: new Date(),
        source: "reviewer",
        ...haikuNotes,
        created_at: new Date(),
      });
      console.log(`  [NOTES] Haiku session summary: ${haikuNotes.topics_discussed.join(", ")}`);
    }
  }

  // Write chain results
  const chainEnd = new Date();
  const overallScore = stepResults.reduce((s, r) => s + r.evaluation.overallScore, 0) / stepResults.length;

  const chainResult: ChainRunResult = {
    chainId: chain.id,
    chainName: chain.name,
    steps: stepResults,
    overallScore,
    startTime: chainStart.toISOString(),
    endTime: chainEnd.toISOString(),
    durationMs: chainEnd.getTime() - chainStart.getTime(),
  };

  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");

  // Use --json-output if specified, otherwise derive from --output
  let chainDir: string;
  if (args["json-output"]) {
    chainDir = args["json-output"];
  } else {
    const outputDir = dirname(args.output!);
    const runTimestamp = chainStart.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    chainDir = join(outputDir, chain.id, runTimestamp);
  }
  mkdirSync(chainDir, { recursive: true });

  // Write chain summary JSON
  const chainJsonPath = join(chainDir, "chain-result.json");
  writeFileSync(chainJsonPath, JSON.stringify(chainResult, null, 2), "utf-8");
  console.log(`\nChain result written to ${chainJsonPath}`);

  // Write per-step capture JSONs
  for (const sr of stepResults) {
    const stepPath = join(chainDir, `${sr.stepId}.json`);
    writeFileSync(stepPath, JSON.stringify(sr.capture, null, 2), "utf-8");
    console.log(`Step capture written to ${stepPath}`);
  }

  // Symlink latest for convenience (only when using default output path)
  if (!args["json-output"]) {
    const baseDir = dirname(args.output!);
    const runTimestamp = chainStart.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const latestLink = join(baseDir, chain.id, "latest");
    try {
      const { unlinkSync, symlinkSync } = await import("node:fs");
      try { unlinkSync(latestLink); } catch {}
      symlinkSync(runTimestamp, latestLink);
    } catch {}
  }

  // Print chain summary
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Chain Summary: ${chain.name.padEnd(33)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);

  for (const sr of stepResults) {
    const icon = sr.evaluation.hallucinations.length > 0 ? "✗" :
      sr.evaluation.overallScore >= 7 ? "✓" :
      sr.evaluation.overallScore >= 5 ? "~" : "✗";
    const pad = sr.stepId.padEnd(25);
    console.log(`║  ${icon} ${pad} ${sr.evaluation.overallScore.toFixed(1)}/10${" ".repeat(15)}║`);
  }

  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Overall: ${overallScore.toFixed(1)}/10${" ".repeat(35)}║`);
  const dur = chainEnd.getTime() - chainStart.getTime();
  const durStr = dur < 60000 ? `${(dur / 1000).toFixed(0)}s` : `${Math.floor(dur / 60000)}m ${Math.floor((dur % 60000) / 1000)}s`;
  console.log(`║  Duration: ${durStr.padEnd(38)}║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

interface ScenarioResult {
  evaluation: EvaluationResult;
  capture: TestRunCapture;
}

/** Endpoint-specific configuration for a test run. */
interface EndpointConfig {
  endpoint: "scout" | "guide" | "admin";
  systemPrompt: string;
  toolDefinitions: AnthropicToolDef[];
  dispatch: (db: Db, toolName: string, args: Record<string, unknown>) => Promise<string>;
}

async function runScenario(
  config: HarnessConfig,
  db: Db,
  scenario: ReturnType<typeof SCENARIOS.get> & {},
  endpointOverride?: EndpointConfig,
): Promise<ScenarioResult> {
  const simulator = new ScoutSimulator({
    model: config.simulatorModel,
    apiKey: config.anthropicApiKey,
  });

  const evaluator = new Evaluator({
    model: config.evaluatorModel,
    apiKey: config.anthropicApiKey,
  });

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  // Build system prompt — use endpoint override if provided, otherwise default to scout
  const scoutDoc = await db.collection("scouts").findOne({ email: config.scoutEmail });
  const layer = args.layer || "full";
  let systemPrompt: string;
  let toolDefs: AnthropicToolDef[];
  let toolDispatch: (d: Db, name: string, a: Record<string, unknown>) => Promise<string>;

  if (endpointOverride) {
    systemPrompt = endpointOverride.systemPrompt;
    toolDefs = endpointOverride.toolDefinitions;
    toolDispatch = endpointOverride.dispatch;
  } else if (layer === "persona-only") {
    // Strip tool instructions and knowledge — pure persona test
    systemPrompt = `You are Scout Coach — a warm, genuine coaching buddy for scouts.
Be encouraging, honest, and age-appropriate. Guide without doing work for the scout.
Policy → answer directly. Skills → be Socratic. Emotions → empathize first.

SCOUT PROFILE:
${JSON.stringify(scoutDoc, null, 2)}`;
    toolDefs = [];  // No tools available
    toolDispatch = async () => "Tools are not available in this configuration.";
  } else if (layer === "no-tools") {
    // Full knowledge prompt but no tools registered
    systemPrompt = SCOUT_INSTRUCTIONS.replace("{SCOUT_PROFILE}", JSON.stringify(scoutDoc, null, 2));
    toolDefs = [];
    toolDispatch = async () => "Tools are not available in this configuration.";
  } else {
    // "full" — default behavior
    systemPrompt = SCOUT_INSTRUCTIONS.replace("{SCOUT_PROFILE}", JSON.stringify(scoutDoc, null, 2));
    toolDefs = SCOUT_TOOL_DEFINITIONS;
    toolDispatch = (d: Db, name: string, a: Record<string, unknown>) => dispatchToolCall(d, config.scoutEmail, name, a);
  }

  const transcript: TranscriptMessage[] = [];
  const startTime = new Date();

  // Display labels depend on endpoint
  const userLabel = endpointOverride ? "USER" : "SCOUT";
  const modelLabel = endpointOverride ? "GUIDE" : "COACH";

  // Conversation loop
  for (let turn = 0; turn < scenario.maxTurns; turn++) {
    // 1. Generate user message (scout, parent, or admin)
    const scoutMessage = await simulator.generateResponse(scenario, transcript);
    console.log(`  [${userLabel}] ${scoutMessage}`);
    transcript.push({
      role: "scout",
      content: scoutMessage,
      timestamp: new Date(),
    });

    // 2. Send to model-under-test
    const coachResponse = await callModelUnderTest(
      anthropic,
      config.modelUnderTest,
      systemPrompt,
      transcript,
      db,
      toolDefs,
      toolDispatch,
      config.thinkingEnabled ? { enabled: true, budget: config.thinkingBudget } : undefined,
    );

    if (coachResponse.thinkingText) {
      const thinkingPreview = coachResponse.thinkingText.substring(0, 150).replace(/\n/g, " ");
      console.log(`  [THINK] ${thinkingPreview}${coachResponse.thinkingText.length > 150 ? "..." : ""}`);
    }
    console.log(`  [${modelLabel}] ${coachResponse.content.substring(0, 120)}${coachResponse.content.length > 120 ? "..." : ""}`);
    if (coachResponse.toolCalls.length > 0) {
      console.log(`  [TOOLS] ${coachResponse.toolCalls.map((tc) => tc.name).join(", ")}`);
    }
    if (coachResponse.usage && config.thinkingEnabled) {
      console.log(`  [USAGE] in=${coachResponse.usage.inputTokens} out=${coachResponse.usage.outputTokens} think≈${coachResponse.usage.thinkingTokens}`);
    }

    transcript.push({
      role: "coach",
      content: coachResponse.content,
      toolCalls: coachResponse.toolCalls,
      thinkingText: coachResponse.thinkingText,
      tokenUsage: coachResponse.usage ? {
        inputTokens: coachResponse.usage.inputTokens,
        outputTokens: coachResponse.usage.outputTokens,
        thinkingTokens: coachResponse.usage.thinkingTokens,
      } : undefined,
      timestamp: new Date(),
    });

    // Check if conversation seems complete (coach wrapping up)
    if (turn >= 2 && isConversationComplete(coachResponse.content)) {
      console.log("  [END] Conversation wrapped up naturally.");
      break;
    }
  }

  const transcriptResult: TranscriptResult = {
    scenarioId: scenario.id,
    model: config.modelUnderTest,
    messages: transcript,
    startTime,
    endTime: new Date(),
  };

  // 3. Detect hallucinations
  const hallucinations = analyzeTranscript(transcript);

  // 4. Evaluate
  let scores;
  let evaluatorUserPrompt = "";
  if (evaluator.constructor.name === "Evaluator" && !args["skip-eval"]) {
    const evalOutput = await evaluator.evaluate(transcriptResult, scenario, scoutDoc as Record<string, unknown> || {}, endpointOverride?.endpoint);
    scores = evalOutput.scores;
    evaluatorUserPrompt = evalOutput.evaluatorUserPrompt;
  } else {
    scores = [];
  }

  // 5. Calculate overall score
  const weights = { ...WEIGHTS, ...(scenario.evaluationWeights || {}) };
  let overallScore = 0;
  let totalWeight = 0;

  for (const score of scores) {
    const w = weights[score.criterion] || 0;
    overallScore += score.score * w;
    totalWeight += w;
  }
  if (totalWeight > 0) overallScore /= totalWeight;

  // Penalize for hallucinations
  if (hallucinations.length > 0) {
    overallScore = Math.min(overallScore, 4.0);
  }

  const endTime = new Date();

  const capture: TestRunCapture = {
    version: 1,
    capturedAt: endTime.toISOString(),
    config: {
      modelUnderTest: config.modelUnderTest,
      simulatorModel: config.simulatorModel,
      evaluatorModel: config.evaluatorModel,
      thinkingEnabled: config.thinkingEnabled,
      thinkingBudget: config.thinkingBudget,
    },
    scenario,
    scoutProfile: (scoutDoc as Record<string, unknown>) || {},
    systemPrompt,
    toolDefinitions: toolDefs,
    evaluator: {
      systemPrompt: EVALUATOR_SYSTEM_PROMPT,
      userPrompt: evaluatorUserPrompt,
    },
    transcript,
    evaluation: {
      scores,
      overallScore,
      hallucinations,
    },
    timing: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
    },
  };

  return {
    evaluation: {
      scenarioId: scenario.id,
      model: config.modelUnderTest,
      scores,
      overallScore,
      transcript: transcriptResult,
      hallucinations,
    },
    capture,
  };
}

// ---------------------------------------------------------------------------
// Call model-under-test (Anthropic API with tool use)
// ---------------------------------------------------------------------------

interface CoachResponse {
  content: string;
  toolCalls: ToolCallRecord[];
  thinkingText?: string;
  usage?: { inputTokens: number; outputTokens: number; thinkingTokens: number };
}

async function callModelUnderTest(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  transcript: TranscriptMessage[],
  db: Db,
  toolDefinitions: AnthropicToolDef[],
  toolDispatcher: (db: Db, toolName: string, args: Record<string, unknown>) => Promise<string>,
  thinkingConfig?: { enabled: boolean; budget: number },
): Promise<CoachResponse> {
  // Build message history for the API, preserving tool_use and tool_result
  // blocks so the model can see its own prior tool calls and results.
  const messages: Anthropic.MessageParam[] = [];
  for (const msg of transcript) {
    if (msg.role === "scout") {
      messages.push({ role: "user", content: msg.content });
    } else {
      // Coach message: reconstruct content blocks including tool_use
      const contentBlocks: Anthropic.ContentBlock[] = [];
      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (let i = 0; i < msg.toolCalls.length; i++) {
          const tc = msg.toolCalls[i];
          const toolUseId = `prev_${messages.length}_${i}`;
          contentBlocks.push({
            type: "tool_use",
            id: toolUseId,
            name: tc.name,
            input: tc.args,
          });
        }
      }
      messages.push({ role: "assistant", content: contentBlocks as Anthropic.ContentBlock[] });

      // Add tool results as a user message (Anthropic API convention)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = msg.toolCalls.map((tc, i) => ({
          type: "tool_result" as const,
          tool_use_id: `prev_${messages.length - 1}_${i}`,
          content: tc.result,
        }));
        messages.push({ role: "user", content: toolResults });
      }
    }
  }

  const toolCalls: ToolCallRecord[] = [];
  let finalContent = "";
  let thinkingText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;

  // Build request params — extended thinking changes the API shape
  const useThinking = thinkingConfig?.enabled ?? false;
  const thinkingBudget = thinkingConfig?.budget ?? 10000;

  // Recursive tool-use loop: keep calling until model stops requesting tools
  let iterations = 0;
  const maxIterations = 5; // safety limit

  while (iterations < maxIterations) {
    iterations++;

    // Extended thinking requires higher max_tokens and uses a different param shape
    const requestParams: Record<string, unknown> = {
      model,
      system: systemPrompt,
      messages,
      tools: toolDefinitions,
    };

    if (useThinking) {
      // max_tokens must be strictly greater than thinking budget
      requestParams.max_tokens = thinkingBudget + 4000;
      requestParams.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget,
      };
    } else {
      requestParams.max_tokens = 1500;
    }

    const response = await client.messages.create(requestParams as Parameters<typeof client.messages.create>[0]);

    // Accumulate token usage
    const usage = response.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
    }
    // Count thinking tokens from content blocks
    for (const block of response.content) {
      if (block.type === "thinking") {
        const thinkingBlock = block as { type: "thinking"; thinking: string };
        // Rough estimate: ~4 chars per token for thinking text
        totalThinkingTokens += Math.ceil(thinkingBlock.thinking.length / 4);
      }
    }

    // Process response content blocks
    let hasToolUse = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "thinking") {
        thinkingText += (block as { type: "thinking"; thinking: string }).thinking + "\n";
      } else if (block.type === "text") {
        finalContent += block.text;
      } else if (block.type === "tool_use") {
        hasToolUse = true;
        // Execute the tool against test MongoDB
        const result = await toolDispatcher(
          db,
          block.name,
          block.input as Record<string, unknown>,
        );
        toolCalls.push({
          name: block.name,
          args: block.input as Record<string, unknown>,
          result,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    if (!hasToolUse) {
      break; // Model is done
    }

    // Feed tool results back for the next iteration
    messages.push({
      role: "assistant",
      content: response.content as Anthropic.ContentBlock[],
    });
    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  return {
    content: finalContent,
    toolCalls,
    thinkingText: thinkingText || undefined,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, thinkingTokens: totalThinkingTokens },
  };
}

// ---------------------------------------------------------------------------
// Conversation completion heuristic
// ---------------------------------------------------------------------------

function isConversationComplete(coachMessage: string): boolean {
  const endings = [
    /\bsee you next (?:time|session)\b/i,
    /\buntil next time\b/i,
    /\bhave a great\b/i,
    /\btake care\b/i,
    /\bgreat (?:work|job|session)\b.*\!/i,
    /\banything else\b.*\?/i,
    /\bgoodbye\b/i,
  ];
  return endings.some((p) => p.test(coachMessage));
}

// ---------------------------------------------------------------------------
// Haiku session note generator — post-step reviewer
// ---------------------------------------------------------------------------

interface SessionNoteFields {
  topics_discussed: string[];
  progress_made: string;
  pending_items: string[];
  next_session_focus: string;
  coach_issues: string[];
}

async function generateSessionNotes(
  apiKey: string,
  model: string,
  transcript: TranscriptMessage[],
  step: ChainStep,
): Promise<SessionNoteFields | null> {
  if (transcript.length === 0) return null;

  const client = new Anthropic({ apiKey });

  // Build a compact transcript representation for Haiku
  const lines: string[] = [];
  for (const msg of transcript) {
    const role = msg.role === "scout" ? "SCOUT" : "COACH";
    lines.push(`[${role}] ${msg.content}`);
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        lines.push(`  [TOOL] ${tc.name}(${JSON.stringify(tc.args)}) → ${tc.result.substring(0, 200)}`);
      }
    }
  }

  const response = await client.messages.create({
    model,
    max_tokens: 500,
    system: `You are a session note generator for a scout coaching system. Given a conversation transcript between a scout and their AI coach, extract structured session notes. Be precise and factual — only include what actually happened in the conversation.`,
    messages: [{
      role: "user",
      content: `Extract session notes from this coaching conversation.

STEP CONTEXT: ${step.description}

TRANSCRIPT:
${lines.join("\n")}

Respond with ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "topics_discussed": ["topic1", "topic2"],
  "progress_made": "What was accomplished this session",
  "pending_items": ["Things the scout committed to doing"],
  "next_session_focus": "What to focus on next session",
  "coach_issues": ["Any errors, missed data, wrong numbers, or failures by the coach — empty array if none"]
}`,
    }],
  });

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    // Strip potential markdown code fences
    const jsonStr = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as SessionNoteFields;
    return {
      topics_discussed: parsed.topics_discussed || [],
      progress_made: parsed.progress_made || "",
      pending_items: parsed.pending_items || [],
      next_session_focus: parsed.next_session_focus || "",
      coach_issues: parsed.coach_issues || [],
    };
  } catch {
    console.log("  [NOTES] Warning: Failed to parse Haiku session notes response");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed / reset / cleanup
// ---------------------------------------------------------------------------

async function seedTestData(db: Db): Promise<void> {
  console.log("Seeding test data...");

  // Clear any existing test data
  await cleanupTestData(db);

  // Insert scout profile
  await db.collection("scouts").insertOne({ ...TEST_SCOUT });
  await db.collection("users").insertOne({ ...TEST_SCOUT_USER });
  await db.collection("users").insertOne({ ...TEST_GUIDE_USER });

  // Insert requirements
  const reqs = buildTestRequirements();
  if (reqs.length > 0) {
    await db.collection("requirements").insertMany(reqs);
  }

  // Insert chore history
  const choreHistory = buildTestChoreHistory();
  if (choreHistory.length > 0) {
    await db.collection("chore_logs").insertMany(choreHistory);
  }

  // Insert budget history
  const budgetHistory = buildTestBudgetHistory();
  if (budgetHistory.length > 0) {
    await db.collection("budget_entries").insertMany(budgetHistory);
  }

  console.log(`  Seeded: 1 scout, ${reqs.length} requirements, ${choreHistory.length} chore logs, ${budgetHistory.length} budget entries.`);
}

async function seedGuideTestData(db: Db): Promise<void> {
  // Seed some session notes so the guide can see recent conversation history
  const now = new Date();
  await db.collection("session_notes").insertMany([
    {
      scout_email: TEST_SCOUT_EMAIL,
      session_date: new Date(now.getTime() - 2 * 86400000),
      source: "reviewer",
      topics_discussed: ["Budget tracking progress", "Week 4 budget entry", "Gaming PC savings update"],
      progress_made: "Logged week 4 budget entry. $84 saved through budget tracking, $120 total toward Gaming PC.",
      pending_items: ["Log week 5 budget entry next session"],
      next_session_focus: "Week 5 budget logging",
      created_at: new Date(now.getTime() - 2 * 86400000),
      _test_seeded: true,
    },
    {
      scout_email: TEST_SCOUT_EMAIL,
      session_date: new Date(now.getTime() - 5 * 86400000),
      source: "reviewer",
      topics_discussed: ["Chore logging", "Streak milestone", "FL Req 3 progress"],
      progress_made: "Logged daily chores (dishes, trash). Chore streak at 7 days — hit first milestone.",
      pending_items: ["Keep daily chore streak going", "Next milestone at 14 days"],
      next_session_focus: "Continue chore logging, check FL Req 3 progress",
      created_at: new Date(now.getTime() - 5 * 86400000),
      _test_seeded: true,
    },
  ]);
  console.log("  Seeded: 2 session notes for guide test.");
}

async function resetTestData(db: Db): Promise<void> {
  // Delete test-generated data (not seeded)
  await db.collection("chore_logs").deleteMany({ scout_email: TEST_SCOUT_EMAIL, _test_seeded: { $ne: true } });
  await db.collection("budget_entries").deleteMany({ scout_email: TEST_SCOUT_EMAIL, _test_seeded: { $ne: true } });
  await db.collection("emails_sent").deleteMany({ scout_email: TEST_SCOUT_EMAIL });
  await db.collection("session_notes").deleteMany({ scout_email: TEST_SCOUT_EMAIL });
  await db.collection("quest_plans").deleteMany({ scout_email: TEST_SCOUT_EMAIL });
  await db.collection("plan_changelog").deleteMany({ scout_email: TEST_SCOUT_EMAIL });
  await db.collection("time_mgmt").deleteMany({ scout_email: TEST_SCOUT_EMAIL });
  await db.collection("reminders").deleteMany({ scout_email: TEST_SCOUT_EMAIL });

  // Reset scout profile to baseline
  await db.collection("scouts").updateOne(
    { email: TEST_SCOUT_EMAIL },
    {
      $set: {
        "quest_state.current_savings": TEST_SCOUT.quest_state.current_savings,
        "quest_state.goal_item": TEST_SCOUT.quest_state.goal_item,
        "quest_state.goal_description": TEST_SCOUT.quest_state.goal_description,
        "quest_state.target_budget": TEST_SCOUT.quest_state.target_budget,
        "quest_state.loan_path_active": TEST_SCOUT.quest_state.loan_path_active,
        "character.tone_dial": TEST_SCOUT.character.tone_dial,
        "character.domain_intensity": TEST_SCOUT.character.domain_intensity,
      },
    },
  );

  // Reset requirement statuses to baseline
  const baselineReqs = buildTestRequirements();
  for (const req of baselineReqs) {
    await db.collection("requirements").updateOne(
      { scout_email: TEST_SCOUT_EMAIL, req_id: req.req_id },
      { $set: { status: req.status } },
    );
  }
}

async function cleanupTestData(db: Db): Promise<void> {
  const testFilter = { scout_email: TEST_SCOUT_EMAIL };
  const emailFilter = { email: TEST_SCOUT_EMAIL };
  const testEmailPattern = /^test-.*@scoutquest\.test$/;

  await db.collection("scouts").deleteMany({ troop: "T999" });
  await db.collection("users").deleteMany({ email: testEmailPattern });
  await db.collection("requirements").deleteMany(testFilter);
  await db.collection("chore_logs").deleteMany(testFilter);
  await db.collection("budget_entries").deleteMany(testFilter);
  await db.collection("emails_sent").deleteMany(testFilter);
  await db.collection("session_notes").deleteMany(testFilter);
  await db.collection("quest_plans").deleteMany(testFilter);
  await db.collection("plan_changelog").deleteMany(testFilter);
  await db.collection("time_mgmt").deleteMany(testFilter);
  await db.collection("reminders").deleteMany(testFilter);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
