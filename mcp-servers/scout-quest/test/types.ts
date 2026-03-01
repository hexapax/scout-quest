/**
 * Test harness types for Scout Quest model evaluation.
 *
 * These types define the scenario, evaluation, transcript, and
 * configuration structures used by the harness runner, scout simulator,
 * and evaluator.
 */

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  /** System prompt for the scout simulator model */
  scoutSimPrompt: string;
  /** First message from the scout sim */
  initialMessage: string;
  /** Max conversation turns */
  maxTurns: number;
  /** Override default evaluation weights */
  evaluationWeights?: Partial<Record<EvaluationCriterion, number>>;
  /** Expected tool calls (for hallucination detection) */
  expectedTools?: string[];
  /** Expected resource reads */
  expectedResources?: string[];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type EvaluationCriterion =
  | "requirement_accuracy"
  | "socratic_method"
  | "character_consistency"
  | "ypt_compliance"
  | "scope_adherence"
  | "engagement_quality"
  | "state_management";

export const DEFAULT_WEIGHTS: Record<EvaluationCriterion, number> = {
  requirement_accuracy: 0.15,
  socratic_method: 0.20,
  character_consistency: 0.15,
  ypt_compliance: 0.10,
  scope_adherence: 0.10,
  engagement_quality: 0.15,
  state_management: 0.15,
};

export interface EvaluationScore {
  criterion: EvaluationCriterion;
  /** 0-10 for most, or 0/10 for pass/fail (ypt_compliance) */
  score: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface TranscriptMessage {
  role: "scout" | "coach";
  content: string;
  toolCalls?: ToolCallRecord[];
  timestamp: Date;
}

export interface TranscriptResult {
  scenarioId: string;
  model: string;
  messages: TranscriptMessage[];
  startTime: Date;
  endTime: Date;
}

// ---------------------------------------------------------------------------
// Evaluation result
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  scenarioId: string;
  model: string;
  scores: EvaluationScore[];
  overallScore: number;
  transcript: TranscriptResult;
  hallucinations: HallucinationRecord[];
}

export interface HallucinationRecord {
  turnIndex: number;
  type: "claimed_not_called" | "called_no_result" | "fabricated_data";
  description: string;
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ComparisonReport {
  models: string[];
  scenarios: string[];
  results: EvaluationResult[];
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  mongoUri: string;
  scoutEmail: string;
  evaluatorModel: string;
  simulatorModel: string;
  anthropicApiKey: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  /** Model under test */
  modelUnderTest: string;
  /** Max cost per scenario in USD */
  budgetPerScenario: number;
  /** Max cost per run in USD */
  budgetPerRun: number;
}

// ---------------------------------------------------------------------------
// Tool definition (Anthropic API format)
// ---------------------------------------------------------------------------

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
