/**
 * Report generator — produces markdown reports from evaluation results.
 *
 * Supports both the legacy EvaluationResult format and the new
 * TestRunResult format from the harness runner.
 */

import type { EvaluationResult, HarnessConfig, EvaluationCriterion } from "./types.js";
import type { TestRunResult, ScenarioRunResult } from "./harness/runner.js";

// ═══════════════════════════════════════════════════════════════════════════
// New harness report format (TestRunResult)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a full markdown report from a TestRunResult.
 */
export function generateRunReport(result: TestRunResult): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split("T")[0];

  lines.push(`# Test Harness Report — ${now}`);
  lines.push("");
  lines.push(`**Run ID:** ${result.runId}`);
  lines.push(`**Started:** ${result.startedAt.toISOString()}`);
  lines.push(`**Completed:** ${result.completedAt.toISOString()}`);
  lines.push(
    `**Duration:** ${formatDuration(result.completedAt.getTime() - result.startedAt.getTime())}`,
  );
  lines.push(`**Total Cost:** $${result.totalCostUsd.toFixed(4)}`);
  lines.push("");

  // Summary
  const passed = result.scenarioResults.filter((r) => r.status === "pass").length;
  const partial = result.scenarioResults.filter((r) => r.status === "partial").length;
  const failed = result.scenarioResults.filter((r) => r.status === "fail").length;

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Scenarios Run | ${result.scenarioResults.length} |`);
  lines.push(`| Passed | ${passed} |`);
  lines.push(`| Partial | ${partial} |`);
  lines.push(`| Failed | ${failed} |`);
  lines.push(`| Pass Rate | ${result.scenarioResults.length > 0 ? ((passed / result.scenarioResults.length) * 100).toFixed(0) : 0}% |`);
  lines.push(`| Total Cost | $${result.totalCostUsd.toFixed(4)} |`);
  lines.push("");

  // Scenario results table
  lines.push("## Scenario Results");
  lines.push("");
  lines.push(`| Scenario | Model | Status | Score | Cost | Turns | Critical Failures |`);
  lines.push(`|----------|-------|--------|-------|------|-------|-------------------|`);

  for (const sr of result.scenarioResults) {
    const statusLabel = sr.status === "pass" ? "PASS" : sr.status === "partial" ? "WARN" : "FAIL";
    lines.push(
      `| ${sr.scenarioId} | ${sr.model} | ${statusLabel} | ${sr.overallScore.toFixed(1)} | $${sr.totalCostUsd.toFixed(4)} | ${sr.totalTurns} | ${sr.criticalFailures.length > 0 ? sr.criticalFailures.join("; ") : "none"} |`,
    );
  }
  lines.push("");

  // Score dimensions breakdown
  lines.push("## Score Dimensions");
  lines.push("");
  lines.push(`| Scenario | Model | Tool Use | Resources | Character | Coaching | Response | Guardrails |`);
  lines.push(`|----------|-------|----------|-----------|-----------|----------|----------|------------|`);

  for (const sr of result.scenarioResults) {
    const d = sr.scoresByDimension;
    lines.push(
      `| ${sr.scenarioId} | ${sr.model} | ${(d.tool_use ?? 0).toFixed(1)} | ${(d.resource_loading ?? 0).toFixed(1)} | ${(d.character_consistency ?? 0).toFixed(1)} | ${(d.coaching_quality ?? 0).toFixed(1)} | ${(d.response_quality ?? 0).toFixed(1)} | ${(d.guardrail_compliance ?? 0).toFixed(1)} |`,
    );
  }
  lines.push("");

  // Hallucination report
  const allHallucinations = result.scenarioResults.flatMap((sr) => sr.hallucinations);
  if (allHallucinations.length > 0) {
    lines.push("## Hallucinations Detected");
    lines.push("");
    lines.push(`| Scenario | Turn | Type | Tool | Description |`);
    lines.push(`|----------|------|------|------|-------------|`);

    for (const sr of result.scenarioResults) {
      for (const h of sr.hallucinations) {
        lines.push(
          `| ${sr.scenarioId} | ${h.turnIndex} | ${h.type} | ${h.toolName || "—"} | ${h.description} |`,
        );
      }
    }
    lines.push("");
  }

  // Cost breakdown
  if (result.costSummary) {
    lines.push("## Cost Breakdown");
    lines.push("");

    lines.push("### By Model");
    lines.push("");
    lines.push(`| Model | Cost |`);
    lines.push(`|-------|------|`);
    for (const [model, cost] of Object.entries(result.costSummary.byModel)) {
      lines.push(`| ${model} | $${cost.toFixed(4)} |`);
    }
    lines.push("");

    lines.push("### By Role");
    lines.push("");
    lines.push(`| Role | Cost |`);
    lines.push(`|------|------|`);
    for (const [role, cost] of Object.entries(result.costSummary.byRole)) {
      lines.push(`| ${role} | $${cost.toFixed(4)} |`);
    }
    lines.push("");

    lines.push("### By Scenario");
    lines.push("");
    lines.push(`| Scenario | Cost |`);
    lines.push(`|----------|------|`);
    for (const [scenario, cost] of Object.entries(result.costSummary.byScenario)) {
      lines.push(`| ${scenario} | $${cost.toFixed(4)} |`);
    }
    lines.push("");

    lines.push(`**Total Tokens:** ${result.costSummary.totalInputTokens.toLocaleString()} input, ${result.costSummary.totalOutputTokens.toLocaleString()} output`);
    lines.push("");
  }

  // Detailed transcripts
  lines.push("## Detailed Transcripts");
  lines.push("");

  for (const sr of result.scenarioResults) {
    lines.push(`### ${sr.scenarioId} (${sr.model})`);
    lines.push("");
    lines.push(`**Status:** ${sr.status} | **Score:** ${sr.overallScore.toFixed(1)} | **Cost:** $${sr.totalCostUsd.toFixed(4)}`);
    lines.push("");

    for (const msg of sr.transcript) {
      const label = msg.role === "scout" ? "Scout" : "Coach";
      lines.push(`**${label}:** ${msg.content.slice(0, 500)}${msg.content.length > 500 ? "..." : ""}`);
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push("");
        for (const tc of msg.toolCalls) {
          lines.push(`> Tool: \`${tc.name}\` → ${tc.result.slice(0, 200)}`);
        }
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a compact summary for console output.
 */
export function generateConsoleSummary(result: TestRunResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("  SCOUT QUEST TEST HARNESS — RESULTS");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");

  const passed = result.scenarioResults.filter((r) => r.status === "pass").length;
  const total = result.scenarioResults.length;

  lines.push(`  Run ID:     ${result.runId}`);
  lines.push(`  Pass Rate:  ${passed}/${total} (${total > 0 ? ((passed / total) * 100).toFixed(0) : 0}%)`);
  lines.push(`  Total Cost: $${result.totalCostUsd.toFixed(4)}`);
  lines.push(
    `  Duration:   ${formatDuration(result.completedAt.getTime() - result.startedAt.getTime())}`,
  );
  lines.push("");

  for (const sr of result.scenarioResults) {
    const icon = sr.status === "pass" ? "[PASS]" : sr.status === "partial" ? "[WARN]" : "[FAIL]";
    const pad = sr.scenarioId.padEnd(25);
    const modelPad = sr.model.padEnd(30);
    lines.push(
      `  ${icon} ${pad} ${modelPad} score=${sr.overallScore.toFixed(1)}  cost=$${sr.totalCostUsd.toFixed(4)}`,
    );
    if (sr.criticalFailures.length > 0) {
      for (const f of sr.criticalFailures) {
        lines.push(`         └── ${f}`);
      }
    }
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy report format (EvaluationResult[])
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a markdown report from legacy EvaluationResult[].
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

    const toolsCalled = r.transcript.messages
      .flatMap((m) => m.toolCalls || [])
      .map((tc) => tc.name);
    const uniqueTools = [...new Set(toolsCalled)];

    lines.push(
      `| ${r.scenarioId} | ${r.overallScore.toFixed(1)} | ${status} | ${r.hallucinations.length} | ${uniqueTools.join(", ") || "none"} |`,
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

    if (r.scores.length > 0) {
      lines.push(`| Criterion | Score | Reasoning |`);
      lines.push(`|-----------|-------|-----------|`);
      for (const s of r.scores) {
        lines.push(`| ${s.criterion} | ${s.score} | ${s.reasoning.replace(/\|/g, "/")} |`);
      }
      lines.push(``);
    }

    // Transcript excerpt
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

  const scenarioIds = new Set<string>();
  for (const results of allResults.values()) {
    for (const r of results) scenarioIds.add(r.scenarioId);
  }

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
      const flag = result.hallucinations.length > 0 ? " !!" : result.overallScore >= 7 ? "" : " ?";
      return `${result.overallScore.toFixed(1)}${flag}`;
    });
    lines.push(`| ${scenarioId} | ${scores.join(" | ")} |`);
  }

  lines.push(``);

  const avgScores = models.map((model) => {
    const results = allResults.get(model) || [];
    if (results.length === 0) return "—";
    const avg = results.reduce((s, r) => s + r.overallScore, 0) / results.length;
    return avg.toFixed(1);
  });
  lines.push(`| **Average** | ${avgScores.join(" | ")} |`);
  lines.push(``);

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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
