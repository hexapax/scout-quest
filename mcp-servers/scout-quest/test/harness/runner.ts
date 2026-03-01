/**
 * Harness Runner — orchestrates the core test loop.
 *
 * For each scenario:
 *  1. Scout Simulator generates next scout message
 *  2. Message sent to model-under-test (with tools)
 *  3. Tool calls dispatched against MongoDB
 *  4. Multi-turn tool loop runs to completion
 *  5. Evaluator scores the response
 *  6. Results stored
 */

import { MongoClient, Db } from "mongodb";
import Anthropic from "@anthropic-ai/sdk";
import { LlmClient, type TokenUsage, type ModelResponse } from "../client/llm.js";
import { ScoutSimulator } from "../scout-simulator.js";
import { Evaluator, type EvaluationTurnResult } from "../evaluator/index.js";
import { SCOUT_TOOL_DEFINITIONS, dispatchToolCall } from "../tool-definitions.js";
import { buildSimulatorSystemPrompt } from "../scenarios/personas.js";
import { resolveScenario, type ScenarioWithPersona } from "../scenarios/index.js";
import { CostTracker } from "./cost.js";
import type { HarnessRunConfig } from "../config.js";
import type {
  ScenarioDefinition,
  TranscriptMessage,
  ToolCallRecord,
  EvaluationResult,
  HallucinationRecord,
} from "../types.js";
import {
  TEST_SCOUT,
  TEST_SCOUT_EMAIL,
} from "../fixtures/profiles.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioRunResult {
  scenarioId: string;
  model: string;
  status: "pass" | "partial" | "fail";
  overallScore: number;
  scoresByDimension: Record<string, number>;
  totalTurns: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  criticalFailures: string[];
  transcript: TranscriptMessage[];
  turnEvaluations: EvaluationTurnResult[];
  hallucinations: HallucinationRecord[];
  startedAt: Date;
  completedAt: Date;
}

export interface TestRunResult {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  scenarioResults: ScenarioRunResult[];
  totalCostUsd: number;
  costSummary: ReturnType<CostTracker["getSummary"]>;
}

// ---------------------------------------------------------------------------
// The system prompt used for the model-under-test
// (matches the real MCP server's SCOUT_INSTRUCTIONS from src/scout.ts)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Boy Scout coaching AI. You help scouts work toward their Personal Management and Family Life merit badges through a gamified quest system.

CRITICAL RULES:
1. You MUST use tools to record data (log_chore, log_budget_entry, etc.) — NEVER simulate or pretend to call tools
2. Read resources to understand the scout's current state before responding
3. Coach the scout — ask questions, guide, encourage — but do NOT do the work for them
4. Match your communication style to the scout's age and energy level
5. When wrapping up, call log_session_notes to record what happened
6. For emails, ALWAYS include the parent/guardian as CC (YPT compliance)

AVAILABLE RESOURCES:
- scout://quest-state — current quest progress, savings, goal
- scout://character — character configuration (base, overlay, tone)
- scout://reminders — pending reminders and deadlines
- scout://requirements — merit badge requirement statuses
- scout://chore-streak — daily chore logging streak
- scout://budget-summary — weekly budget tracking summary
- scout://quest-plan — coaching plan, priorities, milestones
- scout://last-session — notes from the previous session
- scout://quest-summary — overall quest overview

AVAILABLE TOOLS:
log_chore, log_budget_entry, advance_requirement, compose_email,
send_notification, adjust_tone, setup_time_mgmt, log_diary_entry,
update_quest_goal, update_quest_plan, log_session_notes`;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class HarnessRunner {
  private config: HarnessRunConfig;
  private llmClient: LlmClient;
  private simulator: ScoutSimulator;
  private evaluator: Evaluator;
  private costTracker: CostTracker;
  private db: Db | null = null;
  private mongoClient: MongoClient | null = null;

  constructor(config: HarnessRunConfig) {
    this.config = config;
    this.llmClient = new LlmClient(config.anthropicApiKey);
    this.simulator = new ScoutSimulator({
      model: config.simulatorModel,
      apiKey: config.anthropicApiKey,
    });
    this.evaluator = new Evaluator(this.llmClient, config.evaluatorModel);
    this.costTracker = new CostTracker(config.budgetLimits);
  }

  async connect(): Promise<void> {
    this.mongoClient = new MongoClient(this.config.mongoUri);
    await this.mongoClient.connect();
    this.db = this.mongoClient.db();
  }

  async disconnect(): Promise<void> {
    await this.mongoClient?.close();
  }

  /**
   * Run a single scenario against a specific model.
   */
  async runScenario(
    scenarioId: string,
    model: string,
    runId: string,
    opts?: { systemPromptOverride?: string },
  ): Promise<ScenarioRunResult> {
    const resolved = resolveScenario(scenarioId);
    if (!resolved) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
    if (!this.db) {
      throw new Error("Not connected to MongoDB — call connect() first");
    }

    const { scenario, persona, role } = resolved;
    const startedAt = new Date();
    const transcript: TranscriptMessage[] = [];
    const turnEvaluations: EvaluationTurnResult[] = [];
    const allHallucinations: HallucinationRecord[] = [];
    const criticalFailures: string[] = [];
    let totalLatencyMs = 0;

    // Build simulator prompt if scenario doesn't have one embedded
    const simPrompt = scenario.scoutSimPrompt || buildSimulatorSystemPrompt({
      persona,
      scoutProfileJson: JSON.stringify(TEST_SCOUT, null, 2),
      scenarioDescription: scenario.description,
      maxTurns: scenario.maxTurns,
    });

    // Create scenario with the sim prompt filled in
    const scenarioWithPrompt: ScenarioDefinition = {
      ...scenario,
      scoutSimPrompt: simPrompt,
    };

    // Conversation messages for the model-under-test
    const modelMessages: Anthropic.MessageParam[] = [];
    const systemPrompt = opts?.systemPromptOverride || SYSTEM_PROMPT;

    for (let turn = 0; turn < scenario.maxTurns; turn++) {
      // Check budget
      if (this.costTracker.isScenarioOverBudget(scenarioId)) {
        criticalFailures.push(
          `Budget exceeded for scenario ${scenarioId}: $${this.costTracker.getScenarioCost(scenarioId).toFixed(3)}`,
        );
        break;
      }
      if (this.costTracker.isRunOverBudget(runId)) {
        criticalFailures.push(
          `Run budget exceeded: $${this.costTracker.getRunCost(runId).toFixed(3)}`,
        );
        break;
      }

      // Step 1: Generate scout message
      let scoutMessage: string;
      if (turn === 0) {
        scoutMessage = scenarioWithPrompt.initialMessage;
      } else {
        scoutMessage = await this.simulator.generateResponse(
          scenarioWithPrompt,
          transcript,
        );
      }

      transcript.push({
        role: "scout",
        content: scoutMessage,
        timestamp: new Date(),
      });

      // Add scout message to model conversation
      modelMessages.push({ role: "user", content: scoutMessage });

      // Step 2: Send to model-under-test with tools
      const toolCallsThisTurn: ToolCallRecord[] = [];
      let modelResponseText = "";
      let turnLatencyMs = 0;

      try {
        // Multi-turn tool loop
        let pendingMessages = [...modelMessages];
        let loopCount = 0;
        const maxToolLoops = 5; // prevent infinite loops

        while (loopCount < maxToolLoops) {
          loopCount++;

          const response = await this.llmClient.completeWithTools({
            model,
            system: systemPrompt,
            messages: pendingMessages,
            tools: SCOUT_TOOL_DEFINITIONS,
            maxTokens: 4096,
          });

          turnLatencyMs += response.usage.latencyMs;
          this.costTracker.record({
            runId,
            scenarioId,
            turnNumber: turn,
            role: "system",
            usage: response.usage,
          });

          // Collect text
          if (response.text) {
            modelResponseText += (modelResponseText ? "\n" : "") + response.text;
          }

          // If no tool calls, we're done with this turn
          if (response.toolCalls.length === 0) {
            // Add the assistant response to ongoing conversation
            modelMessages.push({ role: "assistant", content: response.text });
            break;
          }

          // Dispatch tool calls
          const contentBlocks: Anthropic.ContentBlock[] = [];
          if (response.text) {
            contentBlocks.push({ type: "text" as const, text: response.text });
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tc of response.toolCalls) {
            const result = await dispatchToolCall(
              this.db,
              TEST_SCOUT_EMAIL,
              tc.name,
              tc.input,
            );
            toolCallsThisTurn.push({
              name: tc.name,
              args: tc.input,
              result,
            });

            contentBlocks.push({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });

            toolResults.push({
              type: "tool_result" as const,
              tool_use_id: tc.id,
              content: result,
            });
          }

          // Build the next messages for continued tool use
          pendingMessages = [
            ...pendingMessages,
            { role: "assistant" as const, content: contentBlocks },
            { role: "user" as const, content: toolResults },
          ];
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        criticalFailures.push(`Model error on turn ${turn}: ${errMsg}`);
        modelResponseText = `[ERROR: ${errMsg}]`;
      }

      totalLatencyMs += turnLatencyMs;

      // Record the coach response in transcript
      transcript.push({
        role: "coach",
        content: modelResponseText,
        toolCalls: toolCallsThisTurn.length > 0 ? toolCallsThisTurn : undefined,
        timestamp: new Date(),
      });

      // Update modelMessages with final assistant text for next turn
      // (already done in the loop above when no tool calls)

      // Step 3: Evaluate this turn
      try {
        const evalResult = await this.evaluator.evaluateTurn({
          turnNumber: turn,
          systemResponse: modelResponseText,
          toolCallsMade: toolCallsThisTurn,
          resourcesRead: [], // TODO: extract from tool calls if resource reads
          dbMutations: [], // TODO: diff MongoDB state
          conversationHistory: transcript,
          expectedTools: scenario.expectedTools || [],
          expectedResources: scenario.expectedResources || [],
          characterConfig: TEST_SCOUT.character as unknown as Record<string, unknown>,
          scenarioExpectations: scenario.description,
        });

        this.costTracker.record({
          runId,
          scenarioId,
          turnNumber: turn,
          role: "evaluator",
          usage: evalResult.usage,
        });

        turnEvaluations.push(evalResult);
        allHallucinations.push(...evalResult.hallucinations);
        criticalFailures.push(
          ...evalResult.evaluation.critical_failures,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Evaluator error on turn ${turn}: ${errMsg}`);
      }
    }

    // Aggregate scores
    const scoresByDimension: Record<string, number> = {};
    const dimensionSums: Record<string, { sum: number; count: number }> = {};

    for (const te of turnEvaluations) {
      const scores = te.evaluation.scores;
      for (const [dim, data] of Object.entries(scores)) {
        if (!dimensionSums[dim]) dimensionSums[dim] = { sum: 0, count: 0 };
        dimensionSums[dim].sum += (data as { score: number }).score;
        dimensionSums[dim].count++;
      }
    }

    for (const [dim, { sum, count }] of Object.entries(dimensionSums)) {
      scoresByDimension[dim] = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
    }

    const overallScore = turnEvaluations.length > 0
      ? Math.round(
          (turnEvaluations.reduce((s, te) => s + te.evaluation.overall_score, 0) /
            turnEvaluations.length) * 100,
        ) / 100
      : 0;

    // Determine status
    const hasHallucinations = allHallucinations.some(
      (h) => h.type === "claimed_not_called",
    );
    let status: "pass" | "partial" | "fail";
    if (overallScore >= 7.0 && !hasHallucinations && criticalFailures.length === 0) {
      status = "pass";
    } else if (overallScore >= 5.0) {
      status = "partial";
    } else {
      status = "fail";
    }

    return {
      scenarioId,
      model,
      status,
      overallScore,
      scoresByDimension,
      totalTurns: Math.floor(transcript.length / 2),
      totalCostUsd: this.costTracker.getScenarioCost(scenarioId),
      totalLatencyMs,
      criticalFailures,
      transcript,
      turnEvaluations,
      hallucinations: allHallucinations,
      startedAt,
      completedAt: new Date(),
    };
  }

  /**
   * Run the full test suite — all scenarios × all models.
   */
  async runAll(opts: {
    runId: string;
    scenarioIds?: string[];
    models?: string[];
    systemPromptOverride?: string;
  }): Promise<TestRunResult> {
    const startedAt = new Date();
    const scenarioIds = opts.scenarioIds ?? Object.keys((await import("../scenarios/index.js")).MVP_SCENARIO_IDS);
    const models = opts.models ?? this.config.modelsUnderTest;

    const results: ScenarioRunResult[] = [];

    for (const scenarioId of scenarioIds) {
      for (const model of models) {
        console.log(`\n--- Running ${scenarioId} with ${model} ---`);

        try {
          const result = await this.runScenario(
            scenarioId,
            model,
            opts.runId,
            { systemPromptOverride: opts.systemPromptOverride },
          );
          results.push(result);

          const icon = result.status === "pass" ? "PASS" : result.status === "partial" ? "WARN" : "FAIL";
          console.log(
            `[${icon}] ${scenarioId}/${model}: score=${result.overallScore.toFixed(1)} ` +
            `cost=$${result.totalCostUsd.toFixed(4)} turns=${result.totalTurns}`,
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] ${scenarioId}/${model}: ${errMsg}`);
        }

        // Check run budget
        if (this.costTracker.isRunOverBudget(opts.runId)) {
          console.error("\nRun budget exceeded — aborting remaining scenarios.");
          break;
        }
      }
    }

    return {
      runId: opts.runId,
      startedAt,
      completedAt: new Date(),
      scenarioResults: results,
      totalCostUsd: this.costTracker.getRunCost(opts.runId),
      costSummary: this.costTracker.getSummary(opts.runId),
    };
  }

  /**
   * Access cost tracker for external reporting.
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }
}
