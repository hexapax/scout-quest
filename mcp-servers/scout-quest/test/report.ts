/**
 * Report generator — produces markdown reports from evaluation results.
 */

import type { EvaluationResult, HarnessConfig, EvaluationCriterion } from "./types.js";

/**
 * Generate a markdown report from a set of evaluation results.
 */
export function generateReport(
  results: EvaluationResult[],
  config: HarnessConfig,
): string {
  const now = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  lines.push(`# Scout Quest Test Harness Report`);
  lines.push(``);
  lines.push(`**Date:** ${now}`);
  lines.push(`**Model under test:** ${config.modelUnderTest}`);
  lines.push(`**Simulator model:** ${config.simulatorModel}`);
  lines.push(`**Evaluator model:** ${config.evaluatorModel}`);
  lines.push(`**Scenarios run:** ${results.length}`);
  lines.push(``);

  // Summary table
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Scenario | Score | Status | Hallucinations | Tools Called |`);
  lines.push(`|----------|-------|--------|----------------|-------------|`);

  let totalScore = 0;
  let totalHallucinations = 0;

  for (const r of results) {
    const status =
      r.hallucinations.length > 0 ? "FAIL" : r.overallScore >= 7 ? "PASS" : r.overallScore >= 5 ? "PARTIAL" : "FAIL";
    const statusEmoji = status === "PASS" ? "PASS" : status === "PARTIAL" ? "PARTIAL" : "FAIL";

    const toolsCalled = r.transcript.messages
      .flatMap((m) => m.toolCalls || [])
      .map((tc) => tc.name);
    const uniqueTools = [...new Set(toolsCalled)];

    lines.push(
      `| ${r.scenarioId} | ${r.overallScore.toFixed(1)} | ${statusEmoji} | ${r.hallucinations.length} | ${uniqueTools.join(", ") || "none"} |`,
    );

    totalScore += r.overallScore;
    totalHallucinations += r.hallucinations.length;
  }

  lines.push(``);

  const avgScore = results.length > 0 ? totalScore / results.length : 0;
  const passed = results.filter((r) => r.overallScore >= 7 && r.hallucinations.length === 0).length;

  lines.push(`**Average Score:** ${avgScore.toFixed(1)}/10`);
  lines.push(`**Pass Rate:** ${passed}/${results.length} (${((passed / Math.max(results.length, 1)) * 100).toFixed(0)}%)`);
  lines.push(`**Total Hallucinations:** ${totalHallucinations}`);
  lines.push(``);

  // Per-criterion averages
  lines.push(`## Criterion Averages`);
  lines.push(``);

  const criteria: EvaluationCriterion[] = [
    "requirement_accuracy",
    "socratic_method",
    "character_consistency",
    "ypt_compliance",
    "scope_adherence",
    "engagement_quality",
    "state_management",
  ];

  lines.push(`| Criterion | Average Score |`);
  lines.push(`|-----------|--------------|`);

  for (const criterion of criteria) {
    const scores = results.flatMap((r) =>
      r.scores.filter((s) => s.criterion === criterion).map((s) => s.score),
    );
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    lines.push(`| ${criterion} | ${avg.toFixed(1)} |`);
  }

  lines.push(``);

  // Hallucination details
  if (totalHallucinations > 0) {
    lines.push(`## Hallucinations`);
    lines.push(``);

    for (const r of results) {
      if (r.hallucinations.length === 0) continue;
      lines.push(`### ${r.scenarioId}`);
      for (const h of r.hallucinations) {
        lines.push(`- **Turn ${h.turnIndex}** (${h.type}): ${h.description}`);
        if (h.toolName) lines.push(`  - Tool: \`${h.toolName}\``);
      }
      lines.push(``);
    }
  }

  // Scenario details
  lines.push(`## Scenario Details`);
  lines.push(``);

  for (const r of results) {
    lines.push(`### ${r.scenarioId} — ${r.overallScore.toFixed(1)}/10`);
    lines.push(``);

    // Per-criterion scores
    if (r.scores.length > 0) {
      lines.push(`| Criterion | Score | Reasoning |`);
      lines.push(`|-----------|-------|-----------|`);
      for (const s of r.scores) {
        lines.push(`| ${s.criterion} | ${s.score} | ${s.reasoning.replace(/\|/g, "/")} |`);
      }
      lines.push(``);
    }

    // Transcript excerpt (first 3 turns)
    lines.push(`**Transcript excerpt:**`);
    lines.push(``);
    const excerpt = r.transcript.messages.slice(0, 6);
    for (const msg of excerpt) {
      const role = msg.role.toUpperCase();
      const text = msg.content.length > 200 ? msg.content.substring(0, 200) + "..." : msg.content;
      lines.push(`> **[${role}]** ${text}`);
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          lines.push(`> *Tool: ${tc.name}(${JSON.stringify(tc.args).substring(0, 80)}...)*`);
        }
      }
    }
    if (r.transcript.messages.length > 6) {
      lines.push(`> *... ${r.transcript.messages.length - 6} more messages*`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Generate a comparison table for multiple model results.
 */
export function generateComparisonReport(
  allResults: Map<string, EvaluationResult[]>,
): string {
  const lines: string[] = [];
  const models = Array.from(allResults.keys());
  const now = new Date().toISOString().split("T")[0];

  lines.push(`# Scout Quest Model Comparison Report`);
  lines.push(``);
  lines.push(`**Date:** ${now}`);
  lines.push(`**Models compared:** ${models.join(", ")}`);
  lines.push(``);

  // Get all scenario IDs
  const scenarioIds = new Set<string>();
  for (const results of allResults.values()) {
    for (const r of results) scenarioIds.add(r.scenarioId);
  }

  // Comparison table
  lines.push(`## Score Comparison`);
  lines.push(``);

  const header = `| Scenario | ${models.join(" | ")} |`;
  const separator = `|----------|${models.map(() => "-------").join("|")}|`;
  lines.push(header);
  lines.push(separator);

  for (const scenarioId of scenarioIds) {
    const scores = models.map((model) => {
      const results = allResults.get(model) || [];
      const result = results.find((r) => r.scenarioId === scenarioId);
      if (!result) return "—";
      const status = result.hallucinations.length > 0 ? " !!" : result.overallScore >= 7 ? " " : " ?";
      return `${result.overallScore.toFixed(1)}${status}`;
    });
    lines.push(`| ${scenarioId} | ${scores.join(" | ")} |`);
  }

  lines.push(``);

  // Averages row
  const avgScores = models.map((model) => {
    const results = allResults.get(model) || [];
    if (results.length === 0) return "—";
    const avg = results.reduce((s, r) => s + r.overallScore, 0) / results.length;
    return avg.toFixed(1);
  });
  lines.push(`| **Average** | ${avgScores.join(" | ")} |`);
  lines.push(``);

  // Hallucination comparison
  lines.push(`## Hallucination Rates`);
  lines.push(``);
  lines.push(`| Model | Total Hallucinations | Scenarios Affected |`);
  lines.push(`|-------|---------------------|-------------------|`);

  for (const model of models) {
    const results = allResults.get(model) || [];
    const total = results.reduce((s, r) => s + r.hallucinations.length, 0);
    const affected = results.filter((r) => r.hallucinations.length > 0).length;
    lines.push(`| ${model} | ${total} | ${affected}/${results.length} |`);
  }

  lines.push(``);
  lines.push(`*Legend: !! = hallucination detected, ? = partial pass*`);

  return lines.join("\n");
}
