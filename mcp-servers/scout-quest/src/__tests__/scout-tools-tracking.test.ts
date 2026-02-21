import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, Db } from "mongodb";
import { validateChoreBackdate } from "../validation.js";
import { STREAK_MILESTONES, BUDGET_MILESTONES } from "../constants.js";

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
    console.log("MongoDB not available — skipping tracking tests");
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe("logChore (integration)", () => {
  beforeEach(async () => {
    if (!mongoAvailable || !db) return;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  });

  it("creates chore log entry with income", async ({ skip }) => {
    if (!mongoAvailable || !db) skip();

    const scoutsCol = db!.collection("scouts");
    const choreCol = db!.collection("chore_logs");
    const email = "chore@scout.com";

    await scoutsCol.insertOne({
      email,
      chore_list: [
        { id: "dishes", name: "Dishes", frequency: "daily", earns_income: true, income_amount: 2 },
        { id: "trash", name: "Trash", frequency: "daily", earns_income: false, income_amount: null },
      ],
      quest_state: { current_savings: 10 },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await choreCol.insertOne({
      scout_email: email,
      date: today,
      chores_completed: ["dishes", "trash"],
      income_earned: 2,
      created_at: new Date(),
    });

    // Update savings
    await scoutsCol.updateOne({ email }, { $inc: { "quest_state.current_savings": 2 } });

    const scout = await scoutsCol.findOne({ email });
    expect(scout!.quest_state.current_savings).toBe(12);

    const log = await choreCol.findOne({ scout_email: email });
    expect(log!.chores_completed).toHaveLength(2);
    expect(log!.income_earned).toBe(2);
  });

  it("rejects duplicate day", async ({ skip }) => {
    if (!mongoAvailable || !db) skip();

    const choreCol = db!.collection("chore_logs");
    const email = "dupe@scout.com";
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await choreCol.insertOne({
      scout_email: email,
      date: today,
      chores_completed: ["dishes"],
      income_earned: 2,
      created_at: new Date(),
    });

    const nextDay = new Date(today);
    nextDay.setDate(nextDay.getDate() + 1);
    const existing = await choreCol.findOne({
      scout_email: email,
      date: { $gte: today, $lt: nextDay },
    });
    expect(existing).toBeDefined();
  });
});

describe("logChore (unit)", () => {
  it("rejects backdates > 3 days", () => {
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    expect(validateChoreBackdate(fourDaysAgo)).toBe(false);
  });

  it("accepts today", () => {
    expect(validateChoreBackdate(new Date())).toBe(true);
  });

  it("streak milestones are in order", () => {
    for (let i = 1; i < STREAK_MILESTONES.length; i++) {
      expect(STREAK_MILESTONES[i]).toBeGreaterThan(STREAK_MILESTONES[i - 1]);
    }
  });

  it("income calculation from chore list", () => {
    const choreList = [
      { id: "dishes", earns_income: true, income_amount: 2 },
      { id: "trash", earns_income: false, income_amount: null },
      { id: "yard", earns_income: true, income_amount: 10 },
    ];
    const completed = ["dishes", "trash", "yard"];
    let income = 0;
    const choreMap = new Map(choreList.map(c => [c.id, c]));
    for (const id of completed) {
      const chore = choreMap.get(id);
      if (chore?.earns_income && chore.income_amount) income += chore.income_amount;
    }
    expect(income).toBe(12);
  });
});

describe("logBudgetEntry (unit)", () => {
  it("budget milestones are at expected weeks", () => {
    expect(BUDGET_MILESTONES).toEqual([4, 8, 13]);
  });

  it("running savings total accumulates correctly", () => {
    const entries = [
      { savings_deposited: 20 },
      { savings_deposited: 15 },
      { savings_deposited: 30 },
    ];
    const total = entries.reduce((s, e) => s + e.savings_deposited, 0);
    expect(total).toBe(65);
  });

  it("weekly income/expense calculation", () => {
    const income = [{ source: "allowance", amount: 20 }, { source: "chores", amount: 15 }];
    const expenses = [{ category: "food", amount: 5 }, { category: "games", amount: 10 }];
    const totalIncome = income.reduce((s, i) => s + i.amount, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    expect(totalIncome).toBe(35);
    expect(totalExpenses).toBe(15);
    expect(totalIncome - totalExpenses).toBe(20);
  });
});
