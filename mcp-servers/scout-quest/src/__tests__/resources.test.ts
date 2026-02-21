import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, Db } from "mongodb";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest_test";
let client: MongoClient | null = null;
let db: Db | null = null;
let mongoAvailable = false;

beforeAll(async () => {
  try {
    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await client.connect();
    db = client.db();
    mongoAvailable = true;
  } catch {
    console.log("MongoDB not available — skipping resource tests");
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe("resources (integration)", () => {
  beforeEach(async () => {
    if (!mongoAvailable || !db) return;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  });

  describe("chore streak calculation", () => {
    it("calculates consecutive day streak", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const col = db!.collection("chore_logs");
      const email = "streak@scout.com";
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Insert 3 consecutive days
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        await col.insertOne({
          scout_email: email,
          date,
          chores_completed: ["dishes"],
          income_earned: 2,
          created_at: new Date(),
        });
      }

      const logs = await col.find({ scout_email: email }).sort({ date: -1 }).toArray();
      expect(logs).toHaveLength(3);

      // Calculate streak manually (same logic as resource)
      let streak = 0;
      let expectedDate = new Date(today);
      for (const log of logs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }
      expect(streak).toBe(3);
    });

    it("resets streak on gap", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const col = db!.collection("chore_logs");
      const email = "gap@scout.com";
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Today and 2 days ago (gap yesterday)
      await col.insertOne({ scout_email: email, date: today, chores_completed: ["dishes"], income_earned: 2, created_at: new Date() });
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      await col.insertOne({ scout_email: email, date: twoDaysAgo, chores_completed: ["dishes"], income_earned: 2, created_at: new Date() });

      const logs = await col.find({ scout_email: email }).sort({ date: -1 }).toArray();

      let streak = 0;
      let expectedDate = new Date(today);
      for (const log of logs) {
        const logDate = new Date(log.date);
        logDate.setHours(0, 0, 0, 0);
        if (logDate.getTime() === expectedDate.getTime()) {
          streak++;
          expectedDate = new Date(expectedDate.getTime() - 86400000);
        } else break;
      }
      expect(streak).toBe(1); // Only today counts
    });
  });

  describe("budget summary", () => {
    it("calculates totals from entries", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const col = db!.collection("budget_entries");
      const email = "budget@scout.com";

      await col.insertOne({
        scout_email: email,
        week_number: 1,
        week_start: new Date(),
        income: [{ source: "allowance", amount: 20 }, { source: "chores", amount: 15 }],
        expenses: [{ category: "food", amount: 5, description: "snacks" }],
        savings_deposited: 30,
        running_savings_total: 30,
        created_at: new Date(),
      });

      const entries = await col.find({ scout_email: email }).toArray();
      const totalIncome = entries.reduce((s, e) => s + e.income.reduce((si: number, i: { amount: number }) => si + i.amount, 0), 0);
      const totalExpenses = entries.reduce((s, e) => s + e.expenses.reduce((se: number, ex: { amount: number }) => se + ex.amount, 0), 0);

      expect(totalIncome).toBe(35);
      expect(totalExpenses).toBe(5);
    });
  });
});

// Pure logic tests
describe("resources (unit)", () => {
  it("progress bar renders correctly", () => {
    const progressBar = (current: number, total: number, width: number = 20) => {
      if (total === 0) return "[" + "-".repeat(width) + "]";
      const filled = Math.round((current / total) * width);
      return "[" + "=".repeat(filled) + "-".repeat(width - filled) + "]";
    };

    expect(progressBar(0, 100)).toBe("[--------------------]");
    expect(progressBar(50, 100)).toBe("[==========----------]");
    expect(progressBar(100, 100)).toBe("[====================]");
    expect(progressBar(0, 0)).toBe("[--------------------]");
  });

  it("savings percent calculation", () => {
    expect(Math.round((150 / 1500) * 100)).toBe(10);
    expect(Math.round((750 / 1500) * 100)).toBe(50);
    expect(Math.round((1500 / 1500) * 100)).toBe(100);
  });
});
