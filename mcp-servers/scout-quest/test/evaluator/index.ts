/**
 * Evaluator — scores each system response using Sonnet 4.6.
 *
 * Receives the full conversation context, tool calls made, DB mutations,
 * and resources read. Returns structured scores per the plan's 6 dimensions.
 */

import { LlmClient, type TokenUsage } from "../client/llm.js";
import {
  buildEvaluatorSystemPrompt,
  buildTurnEvaluationPrompt,
  type EvaluatorOutput,
} from "./prompts.js";
import { detectHallucinations, hasCriticalHallucinations } from "./hallucination.js";
import { SCORING_WEIGHTS, type ScoringDimension } from "../config.js";
import type { ToolCallRecord, TranscriptMessage, HallucinationRecord } from "../types.js";

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface EvaluationTurnInput {
  turnNumber: number;
  systemResponse: string;
  toolCallsMade: ToolCallRecord[];
  resourcesRead: string[];
  dbMutations: Record<string, unknown>[];
  conversationHistory: TranscriptMessage[];
  expectedTools: string[];
  expectedResources: string[];
  characterConfig: Record<string, unknown>;
  scenarioExpectations: string;
}

export interface EvaluationTurnResult {
  evaluation: EvaluatorOutput;
  hallucinations: HallucinationRecord[];
  usage: TokenUsage;
}

export class Evaluator {
  private client: LlmClient;
  private model: string;

  constructor(client: LlmClient, model: string) {
    this.client = client;
    this.model = model;
  }

  /**
   * Evaluate a single turn of the conversation.
   */
  async evaluateTurn(input: EvaluationTurnInput): Promise<EvaluationTurnResult> {
    // Detect hallucinations programmatically
    const hallucinations = detectHallucinations({
      turnIndex: input.turnNumber,
      responseText: input.systemResponse,
      toolCallsMade: input.toolCallsMade,
      expectedTools: input.expectedTools,
    });

    // Build conversation transcript for the evaluator
    const transcript = input.conversationHistory
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n");

    // Build evaluator system prompt
    const systemPrompt = buildEvaluatorSystemPrompt({
      characterConfigJson: JSON.stringify(input.characterConfig, null, 2),
      scenarioExpectedBehaviors: input.scenarioExpectations,
    });

    // Build the turn evaluation prompt
    const userPrompt = buildTurnEvaluationPrompt({
      turnNumber: input.turnNumber,
      conversationTranscript: transcript,
      systemResponse: input.systemResponse,
      actualToolCallsJson: JSON.stringify(
        input.toolCallsMade.map((tc) => ({
          name: tc.name,
          args: tc.args,
          result: tc.result,
        })),
        null,
        2,
      ),
      dbMutationsJson: JSON.stringify(input.dbMutations, null, 2),
      resourcesReadJson: JSON.stringify(input.resourcesRead, null, 2),
    });

    // Call the evaluator LLM
    const { text, usage } = await this.client.complete({
      model: this.model,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2048,
    });

    // Parse the evaluator's JSON response
    let evaluation: EvaluatorOutput;
    try {
      // Strip any markdown fences the model might add despite instructions
      const cleaned = text
        .replace(/^```json?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      evaluation = JSON.parse(cleaned) as EvaluatorOutput;
    } catch {
      // If parsing fails, construct a default failure evaluation
      evaluation = buildDefaultFailureEvaluation(input.turnNumber, text);
    }

    // Override hallucination data with our programmatic detection
    if (hallucinations.length > 0) {
      evaluation.scores.tool_use.hallucinated_tools = hallucinations
        .filter((h) => h.toolName)
        .map((h) => h.toolName!);

      // If there are critical hallucinations, force fail
      if (hasCriticalHallucinations(hallucinations)) {
        evaluation.pass = false;
        evaluation.critical_failures = [
          ...evaluation.critical_failures,
          ...hallucinations
            .filter((h) => h.type === "claimed_not_called")
            .map((h) => `Hallucinated tool: ${h.toolName}`),
        ];
      }
    }

    // Recalculate weighted overall score
    evaluation.overall_score = calculateWeightedScore(evaluation);

    return { evaluation, hallucinations, usage };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateWeightedScore(evaluation: EvaluatorOutput): number {
  const dimensions: Array<[ScoringDimension, number]> = [
    ["tool_use", evaluation.scores.tool_use.score],
    ["resource_loading", evaluation.scores.resource_loading.score],
    ["character_consistency", evaluation.scores.character_consistency.score],
    ["coaching_quality", evaluation.scores.coaching_quality.score],
    ["response_quality", evaluation.scores.response_quality.score],
    ["guardrail_compliance", evaluation.scores.guardrail_compliance.score],
  ];

  let total = 0;
  for (const [dim, score] of dimensions) {
    total += score * SCORING_WEIGHTS[dim];
  }
  return Math.round(total * 100) / 100;
}

function buildDefaultFailureEvaluation(
  turnNumber: number,
  rawText: string,
): EvaluatorOutput {
  const defaultScore = {
    score: 0,
    justification: "Evaluator response could not be parsed as JSON",
  };

  return {
    turn_number: turnNumber,
    scores: {
      tool_use: {
        ...defaultScore,
        expected_tools: [],
        actual_tools: [],
        hallucinated_tools: [],
      },
      resource_loading: {
        ...defaultScore,
        expected_resources: [],
        actual_resources: [],
      },
      character_consistency: {
        ...defaultScore,
        expected_base: "unknown",
        tone_appropriate: false,
        domain_intensity_appropriate: false,
      },
      coaching_quality: {
        ...defaultScore,
        did_work_for_scout: false,
        guided_with_questions: false,
        age_appropriate: false,
      },
      response_quality: {
        ...defaultScore,
        length_appropriate: false,
        on_topic: false,
      },
      guardrail_compliance: {
        ...defaultScore,
        violations: ["Evaluator parse failure"],
      },
    },
    overall_score: 0,
    pass: false,
    critical_failures: [`Evaluator JSON parse failed. Raw: ${rawText.slice(0, 200)}`],
    notes: "Automatic failure due to evaluator response parse error",
  };
}
