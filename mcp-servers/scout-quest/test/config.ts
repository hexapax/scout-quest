/**
 * Test harness configuration — budget limits, pricing table, model configs.
 *
 * All cost calculations use this pricing table. Update manually when
 * provider pricing changes.
 */

// ---------------------------------------------------------------------------
// Model pricing (per million tokens)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPerMT: number;
  outputPerMT: number;
}

export const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-sonnet-4-6":       { inputPerMT: 3.00, outputPerMT: 15.00 },
  "claude-haiku-4-5-20251001": { inputPerMT: 1.00, outputPerMT: 5.00 },
  "gemini-2.5-flash":        { inputPerMT: 0.15, outputPerMT: 0.60 },
  "gpt-4.1-mini":            { inputPerMT: 0.40, outputPerMT: 1.60 },
  "gpt-4.1":                 { inputPerMT: 2.00, outputPerMT: 8.00 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING_TABLE[model];
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMT +
    (outputTokens / 1_000_000) * pricing.outputPerMT
  );
}

// ---------------------------------------------------------------------------
// Budget limits
// ---------------------------------------------------------------------------

export const BUDGET_LIMITS = {
  perScenarioUsd: 0.50,
  perRunUsd: 10.00,
  perDayUsd: 25.00,
};

// ---------------------------------------------------------------------------
// Model identifiers
// ---------------------------------------------------------------------------

export const SIMULATOR_MODEL = "claude-haiku-4-5-20251001";
export const EVALUATOR_MODEL = "claude-sonnet-4-6";

/** Models to test against (Phase 1: 3 models) */
export const MODELS_UNDER_TEST = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

// ---------------------------------------------------------------------------
// Scoring weights (from plan Section 4b)
// ---------------------------------------------------------------------------

export const SCORING_WEIGHTS = {
  tool_use: 0.30,
  resource_loading: 0.15,
  character_consistency: 0.20,
  coaching_quality: 0.20,
  response_quality: 0.10,
  guardrail_compliance: 0.05,
} as const;

export type ScoringDimension = keyof typeof SCORING_WEIGHTS;

// ---------------------------------------------------------------------------
// Default config builder
// ---------------------------------------------------------------------------

export interface HarnessRunConfig {
  mongoUri: string;
  anthropicApiKey: string;
  simulatorModel: string;
  evaluatorModel: string;
  modelsUnderTest: string[];
  budgetLimits: typeof BUDGET_LIMITS;
  maxParallel: number;
  scenarioFilter?: string[];
}

export function buildDefaultConfig(): HarnessRunConfig {
  return {
    mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    simulatorModel: SIMULATOR_MODEL,
    evaluatorModel: EVALUATOR_MODEL,
    modelsUnderTest: [...MODELS_UNDER_TEST],
    budgetLimits: { ...BUDGET_LIMITS },
    maxParallel: 3,
  };
}
