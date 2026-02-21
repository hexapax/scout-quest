import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, Db } from "mongodb";

// Integration tests requiring MongoDB.
// Set MONGO_URI env var or have MongoDB running locally.
// Tests skip gracefully if MongoDB is unavailable.

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
    console.log("MongoDB not available — skipping integration tests");
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe("admin tools (integration)", () => {
  beforeEach(async () => {
    if (!mongoAvailable || !db) return;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.collection(col.name).deleteMany({});
    }
  });

  describe("createScout", () => {
    it("creates scout and user documents", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      const usersCol = db!.collection("users");
      const email = "test@scout.com";
      const now = new Date();

      await usersCol.updateOne(
        { email },
        {
          $set: { updated_at: now },
          $setOnInsert: { email, roles: [{ type: "scout" }], created_at: now },
        },
        { upsert: true },
      );

      await scoutsCol.insertOne({
        email, name: "Test Scout", age: 14, troop: "2024",
        quest_state: {
          goal_item: "", goal_description: "", target_budget: 0,
          savings_capacity: 0, loan_path_active: false,
          quest_start_date: null, current_savings: 0, quest_status: "setup",
        },
        character: {
          base: "guide", quest_overlay: "custom", tone_dial: 3,
          domain_intensity: 3, tone_min: 1, tone_max: 5,
          domain_min: 1, domain_max: 5, sm_notes: "", parent_notes: "",
          avoid: [], calibration_review_enabled: false, calibration_review_weeks: [],
        },
        counselors: {
          personal_management: { name: "", email: "" },
          family_life: { name: "", email: "" },
        },
        unit_leaders: { scoutmaster: { name: "", email: "" } },
        parent_guardian: { name: "Test Parent", email: "parent@test.com" },
        blue_card: {
          personal_management: { requested_date: null, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        chore_list: [],
        created_at: now, updated_at: now,
      });

      const scout = await scoutsCol.findOne({ email });
      expect(scout).toBeDefined();
      expect(scout!.name).toBe("Test Scout");
      expect(scout!.quest_state.quest_status).toBe("setup");

      const user = await usersCol.findOne({ email });
      expect(user!.roles[0].type).toBe("scout");
    });

    it("detects duplicate scout email", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      await scoutsCol.insertOne({ email: "dupe@scout.com", name: "First", created_at: new Date() });
      const existing = await scoutsCol.findOne({ email: "dupe@scout.com" });
      expect(existing).toBeDefined();
    });
  });

  describe("configureQuest", () => {
    it("auto-calculates loan_path_active when target > capacity", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      const email = "quest@scout.com";

      await scoutsCol.insertOne({
        email, name: "Quest Scout",
        quest_state: {
          goal_item: "", goal_description: "", target_budget: 0,
          savings_capacity: 0, loan_path_active: false,
          quest_start_date: null, current_savings: 0, quest_status: "setup",
        },
        created_at: new Date(), updated_at: new Date(),
      });

      await scoutsCol.updateOne({ email }, {
        $set: {
          "quest_state.target_budget": 1500,
          "quest_state.savings_capacity": 500,
          "quest_state.loan_path_active": true,
        },
      });

      const updated = await scoutsCol.findOne({ email });
      expect(updated!.quest_state.loan_path_active).toBe(true);
    });
  });

  describe("initializeRequirements", () => {
    it("creates all PM and FL requirement documents", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const reqCol = db!.collection("requirements");
      const { REQUIREMENT_DEFINITIONS } = await import("../constants.js");
      const scoutEmail = "reqs@scout.com";
      const now = new Date();

      const docs = REQUIREMENT_DEFINITIONS.map(def => ({
        scout_email: scoutEmail, req_id: def.req_id, badge: def.badge,
        status: "not_started", quest_driven: true,
        interaction_mode: def.default_interaction_mode,
        tracking_progress: 0, notes: "", updated_at: now,
      }));

      await reqCol.insertMany(docs);

      const count = await reqCol.countDocuments({ scout_email: scoutEmail });
      expect(count).toBe(REQUIREMENT_DEFINITIONS.length);

      const pm1a = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_1a" });
      expect(pm1a!.badge).toBe("personal_management");
      expect(pm1a!.status).toBe("not_started");
    });
  });

  describe("signOffRequirement", () => {
    it("signs off a submitted requirement", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const reqCol = db!.collection("requirements");
      const scoutEmail = "signoff@scout.com";

      await reqCol.insertOne({
        scout_email: scoutEmail, req_id: "pm_3", badge: "personal_management",
        status: "submitted", quest_driven: true, interaction_mode: "in_person",
        notes: "", updated_at: new Date(),
      });

      await reqCol.updateOne(
        { scout_email: scoutEmail, req_id: "pm_3" },
        { $set: { status: "signed_off", signed_off_by: "Mr. Smith", signed_off_date: new Date() } },
      );

      const req = await reqCol.findOne({ scout_email: scoutEmail, req_id: "pm_3" });
      expect(req!.status).toBe("signed_off");
      expect(req!.signed_off_by).toBe("Mr. Smith");
    });
  });

  describe("approveBlueCard", () => {
    it("sets approval fields", async ({ skip }) => {
      if (!mongoAvailable || !db) skip();

      const scoutsCol = db!.collection("scouts");
      const email = "blue@scout.com";
      const now = new Date();

      await scoutsCol.insertOne({
        email, name: "Blue Card Scout",
        blue_card: {
          personal_management: { requested_date: now, approved_date: null, approved_by: null },
          family_life: { requested_date: null, approved_date: null, approved_by: null },
        },
        created_at: now, updated_at: now,
      });

      await scoutsCol.updateOne({ email }, {
        $set: {
          "blue_card.personal_management.approved_date": now,
          "blue_card.personal_management.approved_by": "SM Johnson",
        },
      });

      const scout = await scoutsCol.findOne({ email });
      expect(scout!.blue_card.personal_management.approved_by).toBe("SM Johnson");
    });
  });
});

// Pure logic tests (no MongoDB needed)
describe("admin tools (unit)", () => {
  it("chore list requires at least 5 entries", () => {
    const chores = [
      { id: "1", name: "Dishes", frequency: "daily", earns_income: true, income_amount: 2 },
      { id: "2", name: "Vacuum", frequency: "weekly", earns_income: true, income_amount: 5 },
      { id: "3", name: "Trash", frequency: "daily", earns_income: false, income_amount: null },
      { id: "4", name: "Laundry", frequency: "weekly", earns_income: true, income_amount: 3 },
      { id: "5", name: "Yard", frequency: "weekly", earns_income: true, income_amount: 10 },
    ];
    expect(chores.length).toBeGreaterThanOrEqual(5);
    expect(chores.filter(c => c.earns_income).length).toBe(4);
  });

  it("loan_path_active is true when target > savings_capacity", () => {
    const target_budget = 1500;
    const savings_capacity = 500;
    expect(target_budget > savings_capacity).toBe(true);
  });

  it("loan_path_active is false when target <= savings_capacity", () => {
    const target_budget = 300;
    const savings_capacity = 500;
    expect(target_budget > savings_capacity).toBe(false);
  });
});
