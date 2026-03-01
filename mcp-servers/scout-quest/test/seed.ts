/**
 * Seed / reset synthetic test data in MongoDB.
 *
 * Idempotent — safe to run repeatedly. Uses the TEST_SCOUT_EMAIL pattern
 * and TEST_TROOP to identify test data.
 */

import { MongoClient, Db } from "mongodb";
import {
  TEST_SCOUT_EMAIL,
  TEST_GUIDE_EMAIL,
  TEST_TROOP,
  TEST_SCOUT,
  TEST_SCOUT_USER,
  TEST_GUIDE_USER,
  buildTestRequirements,
  buildTestChoreHistory,
  buildTestBudgetHistory,
} from "./fixtures/profiles.js";

// ---------------------------------------------------------------------------
// Test data patterns for cleanup
// ---------------------------------------------------------------------------

const TEST_EMAIL_PATTERN = /^test-(scout|guide).*@(test\.hexapax\.com|scoutquest\.test)$/;
const TEST_COLLECTIONS = [
  "scouts", "users", "requirements", "chore_logs", "budget_entries",
  "time_mgmt", "loan_analysis", "emails_sent", "reminders",
  "setup_status", "quest_plans", "session_notes", "plan_changelog",
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export async function seedTestData(db: Db): Promise<{ seeded: number }> {
  // 1. Clear all test data
  await clearTestData(db);

  let seeded = 0;

  // 2. Insert scout profile
  await db.collection("scouts").insertOne({ ...TEST_SCOUT });
  seeded++;

  // 3. Insert user docs
  await db.collection("users").insertOne({ ...TEST_SCOUT_USER });
  await db.collection("users").insertOne({ ...TEST_GUIDE_USER });
  seeded += 2;

  // 4. Insert requirements
  const reqs = buildTestRequirements();
  if (reqs.length > 0) {
    await db.collection("requirements").insertMany(reqs);
    seeded += reqs.length;
  }

  // 5. Insert chore history (tagged as seeded)
  const choreHistory = buildTestChoreHistory();
  if (choreHistory.length > 0) {
    await db.collection("chore_logs").insertMany(choreHistory);
    seeded += choreHistory.length;
  }

  // 6. Insert budget history (tagged as seeded)
  const budgetHistory = buildTestBudgetHistory();
  if (budgetHistory.length > 0) {
    await db.collection("budget_entries").insertMany(budgetHistory);
    seeded += budgetHistory.length;
  }

  // 7. Insert setup status (complete for this active scout)
  await db.collection("setup_status").insertOne({
    scout_email: TEST_SCOUT_EMAIL,
    guide_email: TEST_GUIDE_EMAIL,
    steps: [
      { id: "profile", label: "Scout Profile", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "interests", label: "Interests", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "quest_goal", label: "Quest Goal", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "chore_list", label: "Chore List", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "budget_plan", label: "Budget Plan", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "character", label: "Character", status: "complete", completed_at: new Date("2026-01-15") },
      { id: "session_limits", label: "Session Limits", status: "complete", completed_at: new Date("2026-01-15") },
    ],
    created_at: new Date("2026-01-15"),
    updated_at: new Date("2026-01-15"),
  });
  seeded++;

  // 8. Insert initial quest plan
  await db.collection("quest_plans").insertOne({
    scout_email: TEST_SCOUT_EMAIL,
    current_priorities: [
      "Continue 13-week budget tracking (week 5 of 13)",
      "Maintain daily chore streak",
      "Prepare for PM counselor meeting",
    ],
    strategy_notes: "Focus on consistency with daily chores and weekly budget entries. Schedule counselor meeting after week 8.",
    milestones: [
      { id: "streak_30", label: "30-day chore streak", category: "streak", target_metric: "30 days", status: "in_progress" },
      { id: "budget_w8", label: "Budget week 8 complete", category: "savings", target_metric: "8 weeks", status: "pending" },
      { id: "counselor_1", label: "First PM counselor meeting", category: "counselor", target_metric: "scheduled", status: "pending" },
    ],
    scout_observations: {
      engagement_patterns: "More engaged when discussing gaming PC progress",
      attention_notes: "Loses focus after 15 minutes on non-goal topics",
      motivation_triggers: "Savings progress visualization, streak milestones",
      tone_notes: "Responds well to Pathfinder voice, likes gaming references at level 3",
    },
    last_reviewed: new Date(),
    updated_at: new Date(),
    _test_seeded: true,
  });
  seeded++;

  return { seeded };
}

// ---------------------------------------------------------------------------
// Reset — restore to baseline without full re-seed
// ---------------------------------------------------------------------------

export async function resetTestData(db: Db): Promise<void> {
  // Delete dynamic data created during test runs (not seeded)
  const dynamicCollections = [
    "chore_logs", "budget_entries", "emails_sent", "reminders",
    "session_notes", "plan_changelog", "time_mgmt",
  ];

  for (const coll of dynamicCollections) {
    await db.collection(coll).deleteMany({
      scout_email: TEST_SCOUT_EMAIL,
      _test_seeded: { $ne: true },
    });
  }

  // Reset mutable scout fields to baseline
  await db.collection("scouts").updateOne(
    { email: TEST_SCOUT_EMAIL },
    {
      $set: {
        "quest_state.current_savings": TEST_SCOUT.quest_state.current_savings,
        "quest_state.goal_item": TEST_SCOUT.quest_state.goal_item,
        "quest_state.goal_description": TEST_SCOUT.quest_state.goal_description,
        "quest_state.target_budget": TEST_SCOUT.quest_state.target_budget,
        "quest_state.loan_path_active": TEST_SCOUT.quest_state.loan_path_active,
        "character.tone_dial": TEST_SCOUT.character.tone_dial,
        "character.domain_intensity": TEST_SCOUT.character.domain_intensity,
        updated_at: new Date(),
      },
    },
  );

  // Reset requirement statuses to baseline
  const baselineReqs = buildTestRequirements();
  for (const req of baselineReqs) {
    await db.collection("requirements").updateOne(
      { scout_email: req.scout_email, req_id: req.req_id },
      { $set: { status: req.status, updated_at: new Date() } },
    );
  }
}

// ---------------------------------------------------------------------------
// Clear — remove all test data
// ---------------------------------------------------------------------------

export async function clearTestData(db: Db): Promise<void> {
  for (const coll of TEST_COLLECTIONS) {
    // Match by troop or email pattern
    await db.collection(coll).deleteMany({
      $or: [
        { troop: TEST_TROOP },
        { email: TEST_EMAIL_PATTERN },
        { scout_email: TEST_EMAIL_PATTERN },
        { guide_email: TEST_EMAIL_PATTERN },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("seed.js") || process.argv[1]?.endsWith("seed.ts")) {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest";
  const client = new MongoClient(mongoUri);

  const action = process.argv[2] || "seed";

  try {
    await client.connect();
    const db = client.db();

    if (action === "seed") {
      const result = await seedTestData(db);
      console.log(`Seeded ${result.seeded} documents.`);
    } else if (action === "reset") {
      await resetTestData(db);
      console.log("Test data reset to baseline.");
    } else if (action === "clear") {
      await clearTestData(db);
      console.log("All test data cleared.");
    } else {
      console.error(`Unknown action: ${action}. Use seed, reset, or clear.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}
