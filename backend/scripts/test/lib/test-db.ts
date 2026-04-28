/**
 * Test-DB lifecycle primitives for scout-memory tests.
 *
 * Three invariants enforced here so tests can never touch prod:
 *   1. DB name MUST start with `scoutquest_test_` — `assertTestDbName` rejects everything else
 *   2. Tests never read from `scoutquest` — they bind a fresh URI per run
 *   3. DBs created via `createIsolatedTestDb` track themselves so a single
 *      `dropAllCreatedTestDbs()` cleans up even when a test crashes
 *
 * Module-load order rule (same as scripts/verify-role-lookup.ts): set
 * MONGO_URI before any backend module imports `db.ts`. Dynamic-import all
 * backend modules from the runner after `setupTestEnv()`.
 */

// Note: `mongodb` is dynamically imported below. tsx run via `npx --prefix
// backend` resolves modules relative to the script path, so a static
// `import { MongoClient } from "mongodb"` from outside backend/ fails to
// find the package. Same gotcha that scripts/verify-role-lookup.ts works
// around. Functions that need MongoClient pull it via `await import()`.

const TEST_DB_PREFIX = "scoutquest_test_";
const createdDbs = new Set<string>();

export function assertTestDbName(name: string): void {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `REFUSED: test DB name must start with "${TEST_DB_PREFIX}", got "${name}". ` +
        `This guard prevents tests from accidentally touching prod data.`,
    );
  }
}

/** Build a unique test DB name. Includes scenario tag, timestamp, and 6 random
 *  hex chars so parallel runs of the same scenario don't collide. */
export function generateTestDbName(scenarioTag: string): string {
  const safeTag = scenarioTag.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const name = `${TEST_DB_PREFIX}${safeTag}_${ts}_${rand}`;
  assertTestDbName(name);
  return name;
}

/** Compute a Mongo URI for a test DB, derived from MONGO_URI_ROOT (default
 *  localhost). The URI must end with the DB name — backend's connectDb()
 *  parses it from the URI path. */
export function buildTestUri(dbName: string): string {
  assertTestDbName(dbName);
  const root = process.env.MONGO_URI_ROOT || "mongodb://localhost:27017";
  // Strip any trailing slash from root, append our DB.
  return `${root.replace(/\/$/, "")}/${dbName}`;
}

/** Set MONGO_URI + safety knobs in process.env BEFORE any dynamic backend
 *  imports. Returns the test DB name and URI so the caller can clean up. */
export function setupTestEnv(scenarioTag: string): { dbName: string; uri: string } {
  const dbName = generateTestDbName(scenarioTag);
  const uri = buildTestUri(dbName);
  process.env.MONGO_URI = uri;
  // Tests drive the sweeper themselves — never let the in-process timer fire.
  process.env.SUMMARY_SWEEPER_DISABLED = "1";
  createdDbs.add(dbName);
  return { dbName, uri };
}

/** Drop a single test DB. Safe — refuses any name not in the test prefix. */
export async function dropTestDb(dbName: string): Promise<void> {
  assertTestDbName(dbName);
  const { MongoClient } = await import("mongodb");
  const root = process.env.MONGO_URI_ROOT || "mongodb://localhost:27017";
  const client = new MongoClient(root);
  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
    createdDbs.delete(dbName);
  }
}

/** Drop every test DB this process created. Used in finally{} blocks. */
export async function dropAllCreatedTestDbs(): Promise<void> {
  const dbs = Array.from(createdDbs);
  for (const db of dbs) {
    try {
      await dropTestDb(db);
    } catch (err) {
      console.error(`[test-db] failed to drop ${db}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** List names of test DBs this process is tracking. */
export function trackedTestDbs(): string[] {
  return Array.from(createdDbs);
}
