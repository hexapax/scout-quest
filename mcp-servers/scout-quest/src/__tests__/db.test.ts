import { describe, it, expect } from "vitest";
import { getDb } from "../db.js";

// These tests require a running MongoDB instance.
// Set MONGO_URI=mongodb://localhost:27017/scoutquest_test before running.

describe("db connection", () => {
  it("connects to MongoDB and returns a Db instance", async () => {
    const db = await getDb();
    expect(db).toBeDefined();
    expect(db.databaseName).toBe("scoutquest_test");
  });
});
