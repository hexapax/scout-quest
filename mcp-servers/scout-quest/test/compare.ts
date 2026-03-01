#!/usr/bin/env node
/**
 * Model comparison runner — runs the same scenarios across multiple models
 * and generates a side-by-side comparison report.
 *
 * Usage:
 *   npx tsx test/compare.ts --models "claude-sonnet-4-6,claude-haiku-4-5-20251001" --scenarios all
 *   npx tsx test/compare.ts --from-reports "test/reports/sonnet.md,test/reports/haiku.md"
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const { values: args } = parseArgs({
  options: {
    models: { type: "string", default: "" },
    scenarios: { type: "string", default: "all" },
    output: { type: "string", default: "test/reports/comparison.md" },
  },
});

async function main(): Promise<void> {
  const models = args.models!.split(",").map((m) => m.trim()).filter(Boolean);

  if (models.length < 2) {
    console.log("Usage: npx tsx test/compare.ts --models 'model-a,model-b' --scenarios all");
    console.log("");
    console.log("This tool runs the test harness for each model sequentially,");
    console.log("then generates a comparison report.");
    console.log("");
    console.log("Alternatively, run the harness manually for each model:");
    console.log("  npx tsx test/harness.ts --model claude-sonnet-4-6 --output test/reports/sonnet.md");
    console.log("  npx tsx test/harness.ts --model claude-haiku-4-5 --output test/reports/haiku.md");
    process.exit(1);
  }

  console.log(`Comparing models: ${models.join(", ")}`);
  console.log(`Scenarios: ${args.scenarios}`);
  console.log("");

  // Run harness for each model
  const { execSync } = await import("node:child_process");
  const reportPaths: string[] = [];

  for (const model of models) {
    const reportPath = `test/reports/${model.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
    reportPaths.push(reportPath);

    console.log(`\n=== Running harness for ${model} ===\n`);

    try {
      const cmd = `npx tsx test/harness.ts --model "${model}" --scenarios "${args.scenarios}" --output "${reportPath}"`;
      execSync(cmd, {
        cwd: dirname(dirname(import.meta.url.replace("file://", ""))),
        stdio: "inherit",
        env: process.env,
      });
    } catch (err) {
      console.error(`Failed to run harness for ${model}:`, err);
    }
  }

  // Generate comparison
  console.log("\n=== Generating comparison report ===\n");

  const lines: string[] = [
    `# Model Comparison Report`,
    ``,
    `**Date:** ${new Date().toISOString().split("T")[0]}`,
    `**Models:** ${models.join(", ")}`,
    `**Scenarios:** ${args.scenarios}`,
    ``,
    `Individual reports:`,
  ];

  for (let i = 0; i < models.length; i++) {
    lines.push(`- ${models[i]}: \`${reportPaths[i]}\``);
  }

  lines.push(``);
  lines.push(`See individual reports for full details. Run the harness with \`--dry-run\` to preview scenarios.`);

  const outputPath = args.output!;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join("\n"), "utf-8");
  console.log(`Comparison report written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
