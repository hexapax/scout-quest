#!/bin/bash
# Create a deterministic mock scout in the backend MongoDB for eval testing.
# Runs on the VM via IAP tunnel.
#
# Mock scout:
#   email:     will@test.scoutquest.app
#   userId:    99000001
#   name:      Will TestScout
#   rank state: Tenderfoot earned, Second Class in progress (~40%)
#   clones advancement/requirement structure from an existing Life Scout template
#
# After running this, run the graph loader:
#   gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap \
#     --command='sudo -u scoutcoach docker exec scout-quest-backend node dist/graph-loader.js'

set -euo pipefail

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap --command='
sudo -u scoutcoach docker exec scout-quest-mongodb mongosh scoutquest --quiet --eval "
const TEST_USER_ID = \"99000001\";
const TEST_EMAIL = \"will@test.scoutquest.app\";

// --- 1. scoutbook_scouts ---
db.scoutbook_scouts.replaceOne(
  { userId: TEST_USER_ID },
  {
    userId: TEST_USER_ID,
    firstName: \"Will\",
    lastName: \"TestScout\",
    email: TEST_EMAIL,
    age: 13,
    dob: \"2012-06-15\",
    gender: \"M\",
    dateJoined: \"2024-09-01\",
    currentRank: { id: 2, name: \"Tenderfoot\", dateEarned: \"2025-01-15\" },
    patrol: { id: 999001, name: \"Test Patrol\" },
    orgGuid: \"E1D07881-103D-43D8-92C4-63DEFDC05D48\",
    personGuid: \"00000000-0000-0000-0000-000000000001\",
    memberId: \"TEST-001\",
    unitNumber: \"121894\",
    nickName: null,
    grade: 7,
    address: { line1: \"1 Test Way\", city: \"Atlanta\", state: \"GA\", zip: \"30306\" },
    phone: \"\",
    syncedAt: new Date(),
    lastSyncedAt: new Date(),
  },
  { upsert: true }
);
print(\"scoutbook_scouts: upserted test scout\");

// --- 2. scoutbook_advancement: clone ranks + a couple merit badges ---
// Use a real scout as the template for advancementId mapping
const template = db.scoutbook_advancement.find({ userId: \"11833244\" }).toArray();
print(\"template advancement records: \" + template.length);

// Wipe existing test scout advancement before re-inserting
db.scoutbook_advancement.deleteMany({ userId: TEST_USER_ID });
db.scoutbook_requirements.deleteMany({ userId: TEST_USER_ID });

const testAdv = [];
for (const t of template) {
  // Rank logic: Scout+Tenderfoot earned, Second Class in progress, higher ranks not started
  if (t.type === \"rank\") {
    let status, pct, dateAwarded, dateCompleted, dateStarted;
    if (t.advancementId === 1) { // Scout
      status = \"Awarded\"; pct = 1;
      dateAwarded = \"2024-10-01\"; dateCompleted = \"2024-10-01\"; dateStarted = \"2024-09-01\";
    } else if (t.advancementId === 2) { // Tenderfoot
      status = \"Awarded\"; pct = 1;
      dateAwarded = \"2025-01-15\"; dateCompleted = \"2025-01-15\"; dateStarted = \"2024-10-01\";
    } else if (t.advancementId === 3) { // Second Class
      status = \"Started\"; pct = 0.4;
      dateAwarded = null; dateCompleted = null; dateStarted = \"2025-01-20\";
    } else {
      // Higher ranks: not started
      status = \"NotStarted\"; pct = 0;
      dateAwarded = null; dateCompleted = null; dateStarted = null;
    }
    testAdv.push({
      ...t,
      _id: undefined,
      userId: TEST_USER_ID,
      status, percentCompleted: pct,
      dateAwarded, dateCompleted, dateStarted,
      syncedAt: new Date(),
    });
  } else if (t.type === \"meritBadge\") {
    // Give the test scout 2 earned + 1 in progress merit badges
    const EARNED = [\"First Aid\", \"Swimming\"];
    const IN_PROGRESS = [\"Camping\"];
    if (EARNED.includes(t.name)) {
      testAdv.push({
        ...t, _id: undefined, userId: TEST_USER_ID,
        status: \"Awarded\", percentCompleted: 1,
        dateStarted: \"2024-11-01\", dateCompleted: \"2025-02-01\", dateAwarded: \"2025-02-15\",
        syncedAt: new Date(),
      });
    } else if (IN_PROGRESS.includes(t.name)) {
      testAdv.push({
        ...t, _id: undefined, userId: TEST_USER_ID,
        status: \"Started\", percentCompleted: 0.3,
        dateStarted: \"2025-03-01\", dateCompleted: null, dateAwarded: null,
        syncedAt: new Date(),
      });
    }
  }
  // Skip awards for now — keep mock simple
}

if (testAdv.length > 0) {
  // Clean each doc: remove _id so Mongo generates new ones
  const cleaned = testAdv.map(d => { const c = {...d}; delete c._id; return c; });
  db.scoutbook_advancement.insertMany(cleaned);
}
print(\"scoutbook_advancement: inserted \" + testAdv.length + \" records\");

// --- 3. scoutbook_requirements: mark some requirements completed for earned/in-progress advancements ---
const reqTemplate = db.scoutbook_requirements.find({ userId: \"11833244\" }).toArray();
print(\"template requirements: \" + reqTemplate.length);

// Earned rank IDs (Scout, Tenderfoot) → all reqs completed
// In-progress rank (Second Class=3) → ~40% of reqs completed, a couple started
// All others → not started/completed
const EARNED_ADV_IDS = new Set([1, 2]);
const IN_PROGRESS_ADV_IDS = new Set([3]);
// Also earned merit badges
const EARNED_BADGE_NAMES = new Set([\"First Aid\", \"Swimming\"]);
const IN_PROGRESS_BADGE_NAMES = new Set([\"Camping\"]);

// Build a map: advancementId → advancement name (from template)
const advNameMap = {};
for (const t of template) advNameMap[t.advancementId] = { type: t.type, name: t.name };

const testReqs = [];
for (const r of reqTemplate) {
  const adv = advNameMap[r.advancementId];
  if (!adv) continue;

  let completed = false, dateCompleted = null, percentCompleted = 0, started = false, dateStarted = null;

  if (adv.type === \"rank\") {
    if (EARNED_ADV_IDS.has(r.advancementId)) {
      completed = true; dateCompleted = \"2024-12-15\"; percentCompleted = 1;
      started = true; dateStarted = \"2024-10-01\";
    } else if (IN_PROGRESS_ADV_IDS.has(r.advancementId)) {
      // Hash-based deterministic: ~40% completed, ~15% started
      const h = r.reqId % 10;
      if (h < 4) { completed = true; dateCompleted = \"2025-02-20\"; percentCompleted = 1; started = true; dateStarted = \"2025-01-20\"; }
      else if (h < 6) { started = true; dateStarted = \"2025-03-10\"; percentCompleted = 0.5; }
    }
  } else if (adv.type === \"meritBadge\") {
    if (EARNED_BADGE_NAMES.has(adv.name)) {
      completed = true; dateCompleted = \"2025-02-01\"; percentCompleted = 1;
      started = true; dateStarted = \"2024-11-01\";
    } else if (IN_PROGRESS_BADGE_NAMES.has(adv.name)) {
      const h = r.reqId % 10;
      if (h < 3) { completed = true; dateCompleted = \"2025-03-25\"; percentCompleted = 1; started = true; dateStarted = \"2025-03-01\"; }
    }
  }

  if (adv.type !== \"rank\" && adv.type !== \"meritBadge\") continue;
  if (adv.type === \"rank\" && r.advancementId > 3) continue;  // skip Star/Life/Eagle for test scout
  if (adv.type === \"meritBadge\" && !EARNED_BADGE_NAMES.has(adv.name) && !IN_PROGRESS_BADGE_NAMES.has(adv.name)) continue;

  testReqs.push({
    userId: TEST_USER_ID,
    advancementId: r.advancementId,
    reqId: r.reqId,
    advancementType: adv.type,
    completed, dateCompleted, percentCompleted, started, dateStarted,
    leaderApprovedDate: completed ? dateCompleted : null,
    parentReqId: r.parentReqId,
    reqName: r.reqName,
    reqNumber: r.reqNumber,
    syncedAt: new Date(),
  });
}

if (testReqs.length > 0) db.scoutbook_requirements.insertMany(testReqs);
print(\"scoutbook_requirements: inserted \" + testReqs.length + \" records\");

// --- 4. Verify ---
print(\"\\nVerification:\");
print(\"  scouts doc: \" + JSON.stringify(db.scoutbook_scouts.findOne({userId: TEST_USER_ID}, {firstName:1, lastName:1, email:1, currentRank:1, _id:0})));
print(\"  advancement count: \" + db.scoutbook_advancement.countDocuments({userId: TEST_USER_ID}));
print(\"  requirements count: \" + db.scoutbook_requirements.countDocuments({userId: TEST_USER_ID}));
"
'
