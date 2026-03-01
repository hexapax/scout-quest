/**
 * Regression detection — compares current run scores against a baseline.
 */

export interface RegressionCheck {
  scenarioId: string;
  metric: string;
  baselineValue: number;
  currentValue: number;
  delta: number;
  regression: boolean;
}

/**
 * Compare two run results and detect regressions.
 *
 * A regression is flagged when any metric drops by more than the threshold
 * (default: 1.0 points on a 0-10 scale).
 */
export function detectRegressions(
  baseline: Record<string, Record<string, number>>,
  current: Record<string, Record<string, number>>,
  threshold: number = 1.0,
): RegressionCheck[] {
  const checks: RegressionCheck[] = [];

  for (const [scenarioId, currentScores] of Object.entries(current)) {
    const baselineScores = baseline[scenarioId];
    if (!baselineScores) continue;

    for (const [metric, currentValue] of Object.entries(currentScores)) {
      const baselineValue = baselineScores[metric];
      if (baselineValue === undefined) continue;

      const delta = currentValue - baselineValue;
      checks.push({
        scenarioId,
        metric,
        baselineValue,
        currentValue,
        delta,
        regression: delta < -threshold,
      });
    }
  }

  return checks;
}

/**
 * Check if any regressions are critical (tool_use dimension).
 */
export function hasCriticalRegressions(checks: RegressionCheck[]): boolean {
  return checks.some(
    (c) => c.regression && c.metric === "tool_use",
  );
}

/**
 * Format regressions for display.
 */
export function formatRegressions(checks: RegressionCheck[]): string {
  const regressions = checks.filter((c) => c.regression);
  if (regressions.length === 0) return "No regressions detected.";

  const lines = regressions.map((r) => {
    const icon = r.metric === "tool_use" ? "CRITICAL" : "WARNING";
    return `[${icon}] ${r.scenarioId}/${r.metric}: ${r.baselineValue.toFixed(1)} → ${r.currentValue.toFixed(1)} (${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)})`;
  });

  return lines.join("\n");
}
