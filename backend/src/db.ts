import { MongoClient, type Db } from "mongodb";

let client: MongoClient | null = null;
let scoutquestDb: Db | null = null;

/** Extract the database name from a Mongo URI's path, if any. Returns null
 *  for URIs with no path (e.g. mongodb://host:27017). Used so tests can
 *  point MONGO_URI at an isolated DB without a backend env var hack. */
function dbNameFromUri(uri: string): string | null {
  try {
    // mongodb://host[:port]/<db>?args — only the path component
    const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
    if (!m) return null;
    const name = decodeURIComponent(m[1]).trim();
    return name.length ? name : null;
  } catch {
    return null;
  }
}

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGO_URI || "mongodb://mongodb:27017/scoutquest";
  client = new MongoClient(uri);
  await client.connect();
  // Honor the DB name from the URI path when present; default to "scoutquest"
  // for prod URIs without a path.
  const dbName = dbNameFromUri(uri) || "scoutquest";
  scoutquestDb = client.db(dbName);
  console.log(`MongoDB connected (db=${dbName})`);
}

export function getScoutQuestDb(): Db {
  if (!scoutquestDb) throw new Error("DB not connected — call connectDb() first");
  return scoutquestDb;
}

/** Returns the underlying MongoClient, or null if connectDb() hasn't run.
 *  Test runners use this to close the connection cleanly between scenarios. */
export function getMongoClient(): MongoClient | null {
  return client;
}

/** Reset module state — used by tests that re-run connectDb() against a
 *  different URI within the same process. Safe to call without an open
 *  connection. */
export function resetDbState(): void {
  client = null;
  scoutquestDb = null;
}
