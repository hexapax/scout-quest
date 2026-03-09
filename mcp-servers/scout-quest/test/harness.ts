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
  DEFAULT_WEIGHTS,
} from "./types.js";
import { DEFAULT_WEIGHTS as WEIGHTS } from "./types.js";
import { SCENARIOS, SCENARIO_IDS } from "./scenarios/index.js";
import { ScoutSimulator } from "./scout-simulator.js";
import { Evaluator } from "./evaluator.js";
import { SCOUT_TOOL_DEFINITIONS, dispatchToolCall } from "./tool-definitions.js";
import { analyzeTranscript } from "./hallucination.js";
import {
  TEST_SCOUT_EMAIL,
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

TOOLS (mutations — call ONCE per action, never retry on error):
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
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "claude-sonnet-4-6" },
    scenarios: { type: "string", default: "all" },
    output: { type: "string", default: "test/reports/latest.md" },
    "simulator-model": { type: "string", default: "claude-haiku-4-5-20251001" },
    "evaluator-model": { type: "string", default: "claude-sonnet-4-6" },
    "dry-run": { type: "boolean", default: false },
    "skip-eval": { type: "boolean", default: false },
    "mongo-uri": { type: "string", default: "" },
    thinking: { type: "boolean", default: false },
    "thinking-budget": { type: "string", default: "10000" },
  },
  allowPositionals: true,
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Scout Quest Test Harness ===\n");

  // Resolve scenario list
  const scenarioIds =
    args.scenarios === "all" ? SCENARIO_IDS : args.scenarios!.split(",").map((s) => s.trim());

  for (const id of scenarioIds) {
    if (!SCENARIOS.has(id)) {
      console.error(`Error: Unknown scenario "${id}". Available: ${SCENARIO_IDS.join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`Model under test: ${args.model}`);
  console.log(`Scenarios:        ${scenarioIds.join(", ")}`);
  console.log(`Dry run:          ${args["dry-run"]}`);
  console.log();

  // Dry run — no API key or MongoDB needed
  if (args["dry-run"]) {
    console.log("Dry run — listing scenarios and exiting.\n");
    for (const id of scenarioIds) {
      const s = SCENARIOS.get(id)!;
      console.log(`  ${s.id}: ${s.name} (${s.maxTurns} turns, expected tools: ${(s.expectedTools || []).join(", ") || "none"})`);
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
    // 1. Seed test data
    await seedTestData(db);

    // 2. Run scenarios
    const results: EvaluationResult[] = [];

    for (const scenarioId of scenarioIds) {
      const scenario = SCENARIOS.get(scenarioId)!;
      console.log(`\n--- Running: ${scenario.name} (${scenario.id}) ---\n`);

      const result = await runScenario(config, db, scenario);
      results.push(result);

      // Print quick summary
      const status = result.hallucinations.length > 0
        ? "FAIL (hallucination)"
        : result.overallScore >= 7
        ? "PASS"
        : result.overallScore >= 5
        ? "PARTIAL"
        : "FAIL";

      console.log(`\n  Result: ${status} (score: ${result.overallScore.toFixed(1)}/10)`);
      if (result.hallucinations.length > 0) {
        console.log(`  Hallucinations detected: ${result.hallucinations.length}`);
        for (const h of result.hallucinations) {
          console.log(`    - Turn ${h.turnIndex}: ${h.type} — ${h.description}`);
        }
      }

      // Reset test data between scenarios
      await resetTestData(db);
    }

    // 3. Generate report
    const report = generateReport(results, config);
    const outputPath = args.output!;

    // Write report using absolute path
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, report, "utf-8");
    console.log(`\nReport written to ${outputPath}`);

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
  } finally {
    // 4. Cleanup
    await cleanupTestData(db);
    if (client) await client.close();
    console.log("\nDone.");
  }
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

async function runScenario(
  config: HarnessConfig,
  db: Db,
  scenario: ReturnType<typeof SCENARIOS.get> & {},
): Promise<EvaluationResult> {
  const simulator = new ScoutSimulator({
    model: config.simulatorModel,
    apiKey: config.anthropicApiKey,
  });

  const evaluator = new Evaluator({
    model: config.evaluatorModel,
    apiKey: config.anthropicApiKey,
  });

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  // Build system prompt with scout profile embedded
  const scoutDoc = await db.collection("scouts").findOne({ email: config.scoutEmail });
  const systemPrompt = SCOUT_INSTRUCTIONS.replace("{SCOUT_PROFILE}", JSON.stringify(scoutDoc, null, 2));

  const transcript: TranscriptMessage[] = [];
  const startTime = new Date();

  // Conversation loop
  for (let turn = 0; turn < scenario.maxTurns; turn++) {
    // 1. Generate scout message
    const scoutMessage = await simulator.generateResponse(scenario, transcript);
    console.log(`  [SCOUT] ${scoutMessage}`);
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
      config.scoutEmail,
      config.thinkingEnabled ? { enabled: true, budget: config.thinkingBudget } : undefined,
    );

    if (coachResponse.thinkingText) {
      const thinkingPreview = coachResponse.thinkingText.substring(0, 150).replace(/\n/g, " ");
      console.log(`  [THINK] ${thinkingPreview}${coachResponse.thinkingText.length > 150 ? "..." : ""}`);
    }
    console.log(`  [COACH] ${coachResponse.content.substring(0, 120)}${coachResponse.content.length > 120 ? "..." : ""}`);
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
  let scores = evaluator.constructor.name === "Evaluator" && !args["skip-eval"]
    ? await evaluator.evaluate(transcriptResult, scenario, scoutDoc as Record<string, unknown> || {})
    : [];

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

  return {
    scenarioId: scenario.id,
    model: config.modelUnderTest,
    scores,
    overallScore,
    transcript: transcriptResult,
    hallucinations,
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
  scoutEmail: string,
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
      tools: SCOUT_TOOL_DEFINITIONS,
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
        const result = await dispatchToolCall(
          db,
          scoutEmail,
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
