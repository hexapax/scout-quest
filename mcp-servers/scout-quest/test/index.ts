/**
 * CLI entry point for the Scout Quest test harness.
 *
 * Usage:
 *   npm run test:eval                          # Run MVP scenarios
 *   npm run test:eval -- --scenarios S1,S2,S4  # Run specific scenarios
 *   npm run test:eval -- --models claude-sonnet-4-6
 *   npm run test:eval -- --all                 # Run all scenarios
 *   npm run test:compare                       # Model comparison run
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — required for LLM calls
 *   MONGO_URI          — MongoDB connection (default: mongodb://localhost:27017/scoutquest)
 */

import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import { HarnessRunner, type TestRunResult } from "./harness/runner.js";
import { generateRunReport, generateConsoleSummary } from "./report.js";
import { buildDefaultConfig, type HarnessRunConfig } from "./config.js";
import { seedTestData, resetTestData } from "./seed.js";
import { MVP_SCENARIO_IDS, SCENARIO_IDS } from "./scenarios/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(): {
  scenarios: string[];
  models: string[];
  mode: "eval" | "compare" | "seed" | "reset";
  outputDir: string;
  noReport: boolean;
} {
  const args = process.argv.slice(2);
  let scenarios: string[] = [...MVP_SCENARIO_IDS];
  let models: string[] = [];
  let mode: "eval" | "compare" | "seed" | "reset" = "eval";
  const outputDir = join(__dirname, "reports");
  let noReport = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--scenarios":
      case "-s":
        scenarios = (args[++i] || "").split(",").filter(Boolean);
        break;
      case "--models":
      case "-m":
        models = (args[++i] || "").split(",").filter(Boolean);
        break;
      case "--all":
        scenarios = [...SCENARIO_IDS];
        break;
      case "--compare":
        mode = "compare";
        break;
      case "--seed":
        mode = "seed";
        break;
      case "--reset":
        mode = "reset";
        break;
      case "--no-report":
        noReport = true;
        break;
      default:
        // Allow bare scenario IDs
        if (args[i] && !args[i].startsWith("-")) {
          scenarios = args[i].split(",").filter(Boolean);
        }
    }
  }

  return { scenarios, models, mode, outputDir, noReport };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { scenarios, models, mode, outputDir, noReport } = parseArgs();
  const config = buildDefaultConfig();

  if (!config.anthropicApiKey && mode !== "seed" && mode !== "reset") {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    console.error("Set it via: export ANTHROPIC_API_KEY=sk-ant-...");
    process.exit(1);
  }

  if (models.length > 0) {
    config.modelsUnderTest = models;
  }

  // Seed/reset modes
  if (mode === "seed" || mode === "reset") {
    const client = new MongoClient(config.mongoUri);
    try {
      await client.connect();
      const db = client.db();
      if (mode === "seed") {
        const result = await seedTestData(db);
        console.log(`Seeded ${result.seeded} documents.`);
      } else {
        await resetTestData(db);
        console.log("Test data reset to baseline.");
      }
    } finally {
      await client.close();
    }
    return;
  }

  // Eval/compare modes
  const runId = randomUUID().slice(0, 8);
  console.log(`Starting test run: ${runId}`);
  console.log(`Scenarios: ${scenarios.join(", ")}`);
  console.log(`Models: ${config.modelsUnderTest.join(", ")}`);
  console.log("");

  const runner = new HarnessRunner(config);

  try {
    await runner.connect();

    // Seed test data before running
    console.log("Seeding test data...");
    const mongoClient = new MongoClient(config.mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db();
    await seedTestData(db);
    await mongoClient.close();
    console.log("Test data seeded.");
    console.log("");

    // Run scenarios
    const result = await runner.runAll({
      runId,
      scenarioIds: scenarios,
      models: config.modelsUnderTest,
    });

    // Print console summary
    console.log(generateConsoleSummary(result));

    // Generate and save markdown report
    if (!noReport) {
      await mkdir(outputDir, { recursive: true });
      const reportPath = join(
        outputDir,
        `${new Date().toISOString().split("T")[0]}-${runId}.md`,
      );
      const reportContent = generateRunReport(result);
      await writeFile(reportPath, reportContent);
      console.log(`Report saved to: ${reportPath}`);
    }

    // Store results in MongoDB (test_harness database)
    try {
      const resultsClient = new MongoClient(config.mongoUri);
      await resultsClient.connect();
      const harnessDb = resultsClient.db("test_harness");

      await harnessDb.collection("runs").insertOne({
        run_id: runId,
        started_at: result.startedAt,
        completed_at: result.completedAt,
        status: "completed",
        trigger: "manual",
        scenarios_total: result.scenarioResults.length,
        scenarios_passed: result.scenarioResults.filter((r) => r.status === "pass").length,
        scenarios_failed: result.scenarioResults.filter((r) => r.status === "fail").length,
        total_cost_usd: result.totalCostUsd,
        cost_summary: result.costSummary,
      });

      for (const sr of result.scenarioResults) {
        await harnessDb.collection("scenario_results").insertOne({
          run_id: runId,
          scenario_id: sr.scenarioId,
          model: sr.model,
          status: sr.status,
          overall_score: sr.overallScore,
          scores_by_dimension: sr.scoresByDimension,
          total_turns: sr.totalTurns,
          total_cost_usd: sr.totalCostUsd,
          total_latency_ms: sr.totalLatencyMs,
          critical_failures: sr.criticalFailures,
          hallucinations: sr.hallucinations,
          started_at: sr.startedAt,
          completed_at: sr.completedAt,
        });
      }

      // Store cost entries
      const costEntries = runner.getCostTracker().getEntries();
      if (costEntries.length > 0) {
        await harnessDb.collection("costs").insertMany(costEntries);
      }

      await resultsClient.close();
      console.log(`Results stored in MongoDB (test_harness database).`);
    } catch (err) {
      console.error("Warning: Could not store results in MongoDB:", err);
    }

    // Exit with error code if any critical failures
    const hasCritical = result.scenarioResults.some(
      (r) => r.status === "fail" || r.criticalFailures.length > 0,
    );
    if (hasCritical) {
      process.exit(1);
    }
  } finally {
    await runner.disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
