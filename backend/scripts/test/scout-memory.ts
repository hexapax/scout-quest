/**
 * Scout-memory test runner. Per-scenario isolated DB lifecycle:
 *   1. Generate test DB name (scoutquest_test_<scenario>_<runid>)
 *   2. Set MONGO_URI + SUMMARY_SWEEPER_DISABLED before any backend import
 *   3. Dynamic-import + connectDb()
 *   4. seed()
 *   5. run() with check() helpers
 *   6. Drop the test DB (unless --keep)
 *
 * Run:
 *   npx --prefix backend tsx scripts/test/scout-memory.ts            # all
 *   npx --prefix backend tsx scripts/test/scout-memory.ts --scenario cold-start
 *   npx --prefix backend tsx scripts/test/scout-memory.ts --keep    # debug
 *   npx --prefix backend tsx scripts/test/scout-memory.ts --list
 *
 * Override the Mongo cluster:
 *   MONGO_URI_ROOT=mongodb://other-host:27017 npx ...
 *
 * Module-load discipline: this runner sets env vars FIRST and then uses
 * dynamic import() so that scenarios + backend modules pick up the test
 * URI. Any static `import` of `./lib/test-db.js` is fine because it doesn't
 * touch the DB at module-load time.
 */

import { setupTestEnv, dropTestDb, dropAllCreatedTestDbs } from "./lib/test-db.js";
import { makeChecker } from "./lib/check.js";
import type { Scenario, ScenarioContext } from "./lib/scenario.js";

const ALL_SCENARIO_FILES = [
  "cold-start",
  "episode-roundtrip",
  "summary-write-roundtrip",
  "sweeper-selection",
  "scout-state-roundtrip",
  "event-extractor",
  "event-extractor-shapes",
  "rolling-summary-debounce",
];

interface Args {
  scenario: string | null;
  keep: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { scenario: null, keep: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario") out.scenario = argv[++i] || null;
    else if (a === "--keep") out.keep = true;
    else if (a === "--list") out.list = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: scout-memory.ts [--scenario NAME] [--keep] [--list]");
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

async function loadScenario(slug: string): Promise<Scenario> {
  const mod = (await import(`./scenarios/${slug}.js`)) as { scenario: Scenario };
  if (!mod.scenario || typeof mod.scenario.run !== "function") {
    throw new Error(`scenarios/${slug}.ts does not export a valid Scenario`);
  }
  return mod.scenario;
}

async function runOneScenario(slug: string, opts: { keep: boolean }): Promise<{
  scenario: string;
  failures: number;
  dbName: string;
  durationMs: number;
}> {
  const { dbName, uri } = setupTestEnv(slug);
  const startedAt = Date.now();
  console.log(`\n[${slug}] db=${dbName}`);

  // Dynamic imports AFTER env setup so backend modules bind to the test URI.
  // The db module is process-cached: a previous scenario may have set its
  // module-level `client`/`scoutquestDb`. resetDbState() clears that so
  // connectDb() picks up our new MONGO_URI cleanly.
  const { connectDb, getMongoClient, resetDbState } = await import("../../src/db.js");
  resetDbState();
  await connectDb();

  const scenario = await loadScenario(slug);
  console.log(`  ${scenario.description}`);

  const { check, result } = makeChecker(slug);
  const ctx: ScenarioContext = { dbName, check };

  let runError: unknown = null;
  try {
    await scenario.seed(ctx);
    await scenario.run(ctx);
  } catch (err) {
    runError = err;
    check(`scenario threw: ${err instanceof Error ? err.message : String(err)}`, false);
  } finally {
    // Close the backend's Mongo connection so dropping the DB doesn't race
    // against an open client. Each scenario gets a fresh connection.
    try {
      const client = getMongoClient();
      await client?.close();
    } catch {
      /* ignore */
    }
    if (!opts.keep) {
      await dropTestDb(dbName);
    } else {
      console.log(`  --keep: leaving ${dbName} (URI=${uri})`);
    }
  }

  const ctxResult = result();
  const durationMs = Date.now() - startedAt;
  console.log(`  → ${ctxResult.failures === 0 && !runError ? "PASS" : "FAIL"} (${durationMs}ms)`);
  return { scenario: slug, failures: ctxResult.failures, dbName, durationMs };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const s of ALL_SCENARIO_FILES) console.log(s);
    return;
  }

  if (!process.env.MONGO_URI_ROOT && !process.env.MONGO_URI) {
    console.log("MONGO_URI_ROOT not set — defaulting to mongodb://localhost:27017");
  }

  const slugs = args.scenario ? [args.scenario] : ALL_SCENARIO_FILES;
  const results: Array<{ scenario: string; failures: number; durationMs: number }> = [];

  for (const slug of slugs) {
    try {
      const r = await runOneScenario(slug, { keep: args.keep });
      results.push({ scenario: r.scenario, failures: r.failures, durationMs: r.durationMs });
    } catch (err) {
      console.error(`[${slug}] runner error:`, err instanceof Error ? err.stack || err.message : err);
      results.push({ scenario: slug, failures: 1, durationMs: 0 });
    }
  }

  // Final cleanup belt-and-suspenders: drop any DB the per-scenario finally{}
  // missed (e.g. if the runner crashed before reaching its finally block).
  if (!args.keep) {
    await dropAllCreatedTestDbs();
  }

  console.log("\n=== Summary ===");
  let totalFailures = 0;
  for (const r of results) {
    const mark = r.failures === 0 ? "PASS" : `FAIL (${r.failures})`;
    console.log(`  ${mark.padEnd(10)} ${r.scenario}  ${r.durationMs}ms`);
    totalFailures += r.failures;
  }
  console.log(`\nTotal: ${results.length} scenarios, ${totalFailures} failures`);
  process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  try {
    await dropAllCreatedTestDbs();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
