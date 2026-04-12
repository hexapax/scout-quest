#!/bin/bash
# Create deterministic mock scouts in the backend MongoDB for eval testing.
# Uses a local .js file SCP'd via IAP to sidestep shell quoting issues.
#
# Mock scouts (all @test.scoutquest.app, userId 99000001-99000005):
# Names deliberately chosen to NOT overlap with real Troop 2024 scouts/parents.
#   Kai TestScout    (99000001) — Tenderfoot earned, Second Class 40%
#   Mateo TestScout  (99000002) — Scout earned, Tenderfoot 20%
#   Aiden TestScout  (99000003) — Second Class earned, First Class 60%
#   Finn TestScout   (99000004) — First Class earned, Star 30%
#   Ethan TestScout  (99000005) — Star earned, Life 50%
#
# After running, reload the graph:
#   gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap \
#     --command='sudo -u scoutcoach docker exec scout-quest-backend node dist/graph-loader.js'

set -euo pipefail

SCRIPT_FILE=$(mktemp /tmp/mock-scouts-XXXX.js)
trap "rm -f $SCRIPT_FILE" EXIT

cat > "$SCRIPT_FILE" << 'MONGOJS'
const MOCK_SCOUTS = [
  {
    userId: "99000001", firstName: "Kai", lastName: "TestScout",
    email: "kai@test.scoutquest.app", age: 13, grade: 7, dob: "2012-06-15",
    currentRankId: 2, currentRankName: "Tenderfoot",
    currentRankEarned: "2025-01-15",
    ranksEarned: [1, 2],
    rankInProgress: { id: 3, name: "Second Class", pct: 0.4, started: "2025-01-20" },
    badgesEarned: ["First Aid", "Swimming"],
    badgesInProgress: ["Camping"],
    patrol: { id: 999001, name: "Test Eagles" },
    campingNights: 4, hikingMiles: 8, serviceHours: 3,
  },
  {
    userId: "99000002", firstName: "Mateo", lastName: "TestScout",
    email: "mateo@test.scoutquest.app", age: 12, grade: 6, dob: "2013-09-02",
    currentRankId: 1, currentRankName: "Scout",
    currentRankEarned: "2025-02-01",
    ranksEarned: [1],
    rankInProgress: { id: 2, name: "Tenderfoot", pct: 0.2, started: "2025-02-10" },
    badgesEarned: [],
    badgesInProgress: [],
    patrol: { id: 999001, name: "Test Eagles" },
    campingNights: 1, hikingMiles: 3, serviceHours: 0,
  },
  {
    userId: "99000003", firstName: "Aiden", lastName: "TestScout",
    email: "aiden@test.scoutquest.app", age: 14, grade: 8, dob: "2011-11-11",
    currentRankId: 3, currentRankName: "Second Class",
    currentRankEarned: "2024-12-10",
    ranksEarned: [1, 2, 3],
    rankInProgress: { id: 4, name: "First Class", pct: 0.6, started: "2024-12-15" },
    badgesEarned: ["First Aid", "Swimming", "Cooking"],
    badgesInProgress: ["Communication"],
    patrol: { id: 999001, name: "Test Eagles" },
    campingNights: 8, hikingMiles: 15, serviceHours: 6,
  },
  {
    userId: "99000004", firstName: "Finn", lastName: "TestScout",
    email: "finn@test.scoutquest.app", age: 15, grade: 9, dob: "2010-08-20",
    currentRankId: 4, currentRankName: "First Class",
    currentRankEarned: "2024-09-15",
    ranksEarned: [1, 2, 3, 4],
    rankInProgress: { id: 5, name: "Star Scout", pct: 0.3, started: "2024-09-20" },
    badgesEarned: ["First Aid", "Swimming", "Cooking", "Camping", "Hiking", "Environmental Science"],
    badgesInProgress: ["Personal Management", "Family Life"],
    patrol: { id: 999002, name: "Test Dragons" },
    campingNights: 12, hikingMiles: 28, serviceHours: 14,
  },
  {
    userId: "99000005", firstName: "Ethan", lastName: "TestScout",
    email: "ethan@test.scoutquest.app", age: 16, grade: 10, dob: "2009-03-05",
    currentRankId: 5, currentRankName: "Star Scout",
    currentRankEarned: "2024-06-01",
    ranksEarned: [1, 2, 3, 4, 5],
    rankInProgress: { id: 6, name: "Life Scout", pct: 0.5, started: "2024-06-10" },
    badgesEarned: [
      "First Aid", "Swimming", "Cooking", "Camping", "Hiking", "Environmental Science",
      "Citizenship in the Community", "Citizenship in the Nation", "Citizenship in the World",
      "Personal Fitness", "Emergency Preparedness", "Personal Management"
    ],
    badgesInProgress: ["Family Life", "Communication"],
    patrol: { id: 999002, name: "Test Dragons" },
    campingNights: 18, hikingMiles: 42, serviceHours: 22,
  },
];

// Template scout whose advancement/requirement structure we clone (Henry = Life Scout)
const TEMPLATE_USER_ID = "11833244";
const advTemplate = db.scoutbook_advancement.find({ userId: TEMPLATE_USER_ID }).toArray();
const reqTemplate = db.scoutbook_requirements.find({ userId: TEMPLATE_USER_ID }).toArray();
print("Template: " + advTemplate.length + " advancement records, " + reqTemplate.length + " requirement records");

// Wipe old mock scout data
const mockIds = MOCK_SCOUTS.map(s => s.userId);
db.scoutbook_scouts.deleteMany({ userId: { $in: mockIds } });
db.scoutbook_advancement.deleteMany({ userId: { $in: mockIds } });
db.scoutbook_requirements.deleteMany({ userId: { $in: mockIds } });
print("Cleaned up old mock scout data");

// Advancement name lookup
const advNameMap = {};
for (const t of advTemplate) advNameMap[t.advancementId] = { type: t.type, name: t.name };

let totalAdv = 0, totalReq = 0;

for (const cfg of MOCK_SCOUTS) {
  db.scoutbook_scouts.insertOne({
    userId: cfg.userId,
    firstName: cfg.firstName, lastName: cfg.lastName, email: cfg.email,
    age: cfg.age, grade: cfg.grade, dob: cfg.dob, gender: "M",
    dateJoined: "2024-09-01",
    currentRank: { id: cfg.currentRankId, name: cfg.currentRankName, dateEarned: cfg.currentRankEarned },
    patrol: cfg.patrol,
    orgGuid: "E1D07881-103D-43D8-92C4-63DEFDC05D48",
    personGuid: "00000000-0000-0000-0000-" + cfg.userId.padStart(12, "0"),
    memberId: "TEST-" + cfg.userId.slice(-3),
    unitNumber: "121894",
    nickName: null,
    address: { line1: "1 Test Way", city: "Atlanta", state: "GA", zip: "30306" },
    phone: "",
    campingNights: cfg.campingNights,
    hikingMiles: cfg.hikingMiles,
    serviceHours: cfg.serviceHours,
    syncedAt: new Date(),
    lastSyncedAt: new Date(),
  });

  // Advancement: clone ranks, cherry-pick merit badges
  const advRecords = [];
  const earnedMap = {};
  for (const id of cfg.ranksEarned) earnedMap[id] = true;

  for (const t of advTemplate) {
    if (t.type === "rank") {
      let status, pct, dateAwarded, dateCompleted, dateStarted;
      if (earnedMap[t.advancementId]) {
        status = "Awarded"; pct = 1;
        dateAwarded = cfg.currentRankEarned; dateCompleted = cfg.currentRankEarned;
        dateStarted = "2024-09-15";
      } else if (cfg.rankInProgress && cfg.rankInProgress.id === t.advancementId) {
        status = "Started"; pct = cfg.rankInProgress.pct;
        dateAwarded = null; dateCompleted = null; dateStarted = cfg.rankInProgress.started;
      } else {
        status = "NotStarted"; pct = 0;
        dateAwarded = null; dateCompleted = null; dateStarted = null;
      }
      const rec = Object.assign({}, t, {
        _id: undefined, userId: cfg.userId,
        status, percentCompleted: pct, dateAwarded, dateCompleted, dateStarted,
        syncedAt: new Date(),
      });
      delete rec._id;
      advRecords.push(rec);
    } else if (t.type === "meritBadge") {
      if (cfg.badgesEarned.indexOf(t.name) >= 0) {
        const rec = Object.assign({}, t, {
          _id: undefined, userId: cfg.userId,
          status: "Awarded", percentCompleted: 1,
          dateStarted: "2024-10-01", dateCompleted: "2025-01-15", dateAwarded: "2025-01-30",
          syncedAt: new Date(),
        });
        delete rec._id;
        advRecords.push(rec);
      } else if (cfg.badgesInProgress.indexOf(t.name) >= 0) {
        const rec = Object.assign({}, t, {
          _id: undefined, userId: cfg.userId,
          status: "Started", percentCompleted: 0.35,
          dateStarted: "2025-02-20", dateCompleted: null, dateAwarded: null,
          syncedAt: new Date(),
        });
        delete rec._id;
        advRecords.push(rec);
      }
    }
  }

  if (advRecords.length > 0) {
    db.scoutbook_advancement.insertMany(advRecords);
    totalAdv += advRecords.length;
  }

  // Requirements: mark completed for earned ranks/badges, partial for in-progress
  const earnedRankIds = new Set(cfg.ranksEarned);
  const inProgressRankId = cfg.rankInProgress ? cfg.rankInProgress.id : null;
  const inProgressPct = cfg.rankInProgress ? cfg.rankInProgress.pct : 0;
  const earnedBadges = new Set(cfg.badgesEarned);
  const inProgressBadges = new Set(cfg.badgesInProgress);

  const reqRecords = [];
  for (const r of reqTemplate) {
    const adv = advNameMap[r.advancementId];
    if (!adv) continue;
    let completed = false, dateCompleted = null, percentCompleted = 0, started = false, dateStarted = null;

    if (adv.type === "rank") {
      if (earnedRankIds.has(r.advancementId)) {
        completed = true; dateCompleted = cfg.currentRankEarned; percentCompleted = 1;
        started = true; dateStarted = "2024-09-15";
      } else if (r.advancementId === inProgressRankId) {
        const h = r.reqId % 100;
        const cutoff = Math.floor(inProgressPct * 100);
        if (h < cutoff) { completed = true; dateCompleted = "2025-02-20"; percentCompleted = 1; started = true; dateStarted = "2025-01-20"; }
        else if (h < cutoff + 15) { started = true; dateStarted = "2025-03-10"; percentCompleted = 0.5; }
      } else {
        continue;
      }
    } else if (adv.type === "meritBadge") {
      if (earnedBadges.has(adv.name)) {
        completed = true; dateCompleted = "2025-01-15"; percentCompleted = 1;
        started = true; dateStarted = "2024-10-01";
      } else if (inProgressBadges.has(adv.name)) {
        const h = r.reqId % 10;
        if (h < 3) { completed = true; dateCompleted = "2025-03-25"; percentCompleted = 1; started = true; dateStarted = "2025-02-20"; }
      } else {
        continue;
      }
    } else {
      continue;
    }

    reqRecords.push({
      userId: cfg.userId, advancementId: r.advancementId, reqId: r.reqId,
      advancementType: adv.type, completed, dateCompleted, percentCompleted, started, dateStarted,
      leaderApprovedDate: completed ? dateCompleted : null,
      parentReqId: r.parentReqId, reqName: r.reqName, reqNumber: r.reqNumber,
      syncedAt: new Date(),
    });
  }
  if (reqRecords.length > 0) {
    db.scoutbook_requirements.insertMany(reqRecords);
    totalReq += reqRecords.length;
  }

  print("  Inserted " + cfg.firstName + " " + cfg.lastName + ": " + advRecords.length + " adv, " + reqRecords.length + " reqs");
}

print("");
print("TOTALS: " + MOCK_SCOUTS.length + " scouts, " + totalAdv + " advancement records, " + totalReq + " requirement records");
print("");
print("Verification:");
for (const s of MOCK_SCOUTS) {
  const doc = db.scoutbook_scouts.findOne({userId: s.userId}, {firstName:1, lastName:1, currentRank:1, _id:0});
  const advCount = db.scoutbook_advancement.countDocuments({userId: s.userId});
  print("  " + s.userId + " " + doc.firstName + " " + doc.lastName + " @ " + doc.currentRank.name + " (" + advCount + " adv records)");
}
MONGOJS

echo "Staging JS file..."
gcloud compute scp --tunnel-through-iap --zone=us-east4-b --project=scout-assistant-487523 \
  "$SCRIPT_FILE" scout-coach-vm:/tmp/scout-config-scout-quest/mock-scouts.js 2>&1 | tail -3

echo "Running in MongoDB container..."
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap --command='
sudo cp /tmp/scout-config-scout-quest/mock-scouts.js /tmp/mock-scouts-ready.js
sudo chmod 644 /tmp/mock-scouts-ready.js
sudo -u scoutcoach docker cp /tmp/mock-scouts-ready.js scout-quest-mongodb:/tmp/mock-scouts.js
sudo -u scoutcoach docker exec scout-quest-mongodb mongosh scoutquest --quiet --file /tmp/mock-scouts.js
sudo rm -f /tmp/mock-scouts-ready.js
' 2>&1 | tail -25
