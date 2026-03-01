/**
 * Cost tracking and budget enforcement.
 *
 * Accumulates token usage across simulator, system, and evaluator calls.
 * Enforces per-scenario and per-run budget limits.
 */

import type { TokenUsage } from "../client/llm.js";
import { BUDGET_LIMITS, calculateCost } from "../config.js";

// ---------------------------------------------------------------------------
// Cost tracker
// ---------------------------------------------------------------------------

export interface CostEntry {
  runId: string;
  scenarioId: string;
  turnNumber: number;
  role: "simulator" | "system" | "evaluator";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  timestamp: Date;
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private limits: typeof BUDGET_LIMITS;

  constructor(limits?: typeof BUDGET_LIMITS) {
    this.limits = limits ?? { ...BUDGET_LIMITS };
  }

  /**
   * Record a cost entry from an API call.
   */
  record(opts: {
    runId: string;
    scenarioId: string;
    turnNumber: number;
    role: "simulator" | "system" | "evaluator";
    usage: TokenUsage;
  }): void {
    this.entries.push({
      runId: opts.runId,
      scenarioId: opts.scenarioId,
      turnNumber: opts.turnNumber,
      role: opts.role,
      model: opts.usage.model,
      inputTokens: opts.usage.inputTokens,
      outputTokens: opts.usage.outputTokens,
      costUsd: opts.usage.costUsd,
      latencyMs: opts.usage.latencyMs,
      timestamp: new Date(),
    });
  }

  /**
   * Check if a scenario has exceeded its budget.
   */
  isScenarioOverBudget(scenarioId: string): boolean {
    return this.getScenarioCost(scenarioId) >= this.limits.perScenarioUsd;
  }

  /**
   * Check if the entire run has exceeded its budget.
   */
  isRunOverBudget(runId: string): boolean {
    return this.getRunCost(runId) >= this.limits.perRunUsd;
  }

  /**
   * Get total cost for a scenario.
   */
  getScenarioCost(scenarioId: string): number {
    return this.entries
      .filter((e) => e.scenarioId === scenarioId)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Get total cost for a run.
   */
  getRunCost(runId: string): number {
    return this.entries
      .filter((e) => e.runId === runId)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Get cost breakdown by model.
   */
  getCostByModel(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const entry of this.entries) {
      result[entry.model] = (result[entry.model] || 0) + entry.costUsd;
    }
    return result;
  }

  /**
   * Get cost breakdown by role.
   */
  getCostByRole(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const entry of this.entries) {
      result[entry.role] = (result[entry.role] || 0) + entry.costUsd;
    }
    return result;
  }

  /**
   * Get all entries for serialization/storage.
   */
  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Get a summary of all costs.
   */
  getSummary(runId: string): {
    totalCostUsd: number;
    byModel: Record<string, number>;
    byRole: Record<string, number>;
    byScenario: Record<string, number>;
    totalInputTokens: number;
    totalOutputTokens: number;
  } {
    const runEntries = this.entries.filter((e) => e.runId === runId);
    const byScenario: Record<string, number> = {};
    let totalInput = 0;
    let totalOutput = 0;

    for (const entry of runEntries) {
      byScenario[entry.scenarioId] = (byScenario[entry.scenarioId] || 0) + entry.costUsd;
      totalInput += entry.inputTokens;
      totalOutput += entry.outputTokens;
    }

    return {
      totalCostUsd: this.getRunCost(runId),
      byModel: this.getCostByModel(),
      byRole: this.getCostByRole(),
      byScenario,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
    };
  }
}
