import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoClient } from "mongodb";

// This test requires a running MongoDB instance.
// Set MONGO_URI=mongodb://localhost:27017/scoutquest_test before running.

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest_test";
let mongoAvailable = false;
let client: MongoClient | null = null;

beforeAll(async () => {
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await client.connect();
    mongoAvailable = true;
  } catch {
    console.log("MongoDB not available — skipping db tests");
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe("db connection", () => {
  it("connects to MongoDB and returns a Db instance", async ({ skip }) => {
    if (!mongoAvailable || !client) skip();

    const db = client!.db();
    expect(db).toBeDefined();
    expect(db.databaseName).toBe("scoutquest_test");
  });
});
