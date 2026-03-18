#!/usr/bin/env node
/**
 * Load fresh Scoutbook JSON data into MongoDB.
 * Transforms the captured API responses into the scoutbook_* collection format
 * defined in mcp-servers/scout-quest/src/scoutbook/types.ts.
 *
 * Usage: nvm exec 24 node scripts/mongo/load-fresh-data.mjs [--mongo-uri URI]
 * Default mongo: mongodb://localhost:27017/scoutquest
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'scouting-org-research', 'data', 'fresh');
const MONGO_URI = process.argv.find(a => a.startsWith('--mongo-uri='))?.split('=')[1]
  || process.env.MONGO_URI
  || 'mongodb://localhost:27017/scoutquest';

const ORG_GUID = 'E1D07881-103D-43D8-92C4-63DEFDC05D48';
const UNIT_NUMBER = '2024';
const NOW = new Date();

async function main() {
  console.log(`Connecting to ${MONGO_URI}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  console.log(`Connected to database: ${db.databaseName}\n`);

  // === SCOUTS ===
  console.log('=== Loading Scouts ===');
  const rosterData = readJSON('org_units_youths.json');
  const scouts = rosterData.users || rosterData;
  const scoutsCol = db.collection('scoutbook_scouts');

  for (const s of scouts) {
    const actFile = `youth_${s.userId}_activitySummary.json`;
    const activity = fileExists(actFile) ? readJSON(actFile) : null;
    const highestRank = s.highestRanksAwarded?.filter(r => r.programId === 2)
      .sort((a, b) => b.level - a.level)[0] || null;

    const doc = {
      userId: String(s.userId),
      memberId: String(s.memberId),
      personGuid: s.personGuid,
      firstName: s.firstName,
      lastName: s.lastName,
      fullName: s.personFullName,
      nickName: s.nickName || undefined,
      dob: s.dateOfBirth,
      age: s.age,
      gender: s.gender,
      grade: s.grade,
      email: s.email,
      phone: s.mobilePhone || s.homePhone,
      address: s.address1 ? { line1: s.address1, city: s.city, state: s.state, zip: s.zip } : undefined,
      orgGuid: ORG_GUID,
      unitNumber: UNIT_NUMBER,
      patrol: s.positions?.[0]?.patrolId ? { id: s.positions[0].patrolId, name: s.positions[0].patrolName } : undefined,
      currentRank: highestRank ? { id: highestRank.id, name: highestRank.rank, level: highestRank.level, dateEarned: highestRank.dateEarned } : undefined,
      positions: (s.positions || []).map(p => ({ name: p.position, patrolId: p.patrolId, patrolName: p.patrolName })),
      dateJoined: s.dateJoinedBoyScouts,
      activitySummary: activity ? {
        memberId: String(activity.memberId || s.memberId),
        fullName: activity.fullName || s.personFullName,
        campingLogs: activity.campingLogs || { totalNumberOfDays: 0, totalNumberOfNights: 0, percentCompleteTowardGoal: 0 },
        hikingLogs: activity.hikingLogs || { totalNumberOfMiles: 0, percentCompleteTowardGoal: 0 },
        serviceLogs: activity.serviceLogs || { totalNumberOfHours: 0, percentCompleteTowardGoal: 0 },
        longCruiseLogs: activity.longCruiseLogs || { totalNumberOfDays: 0 },
      } : undefined,
      syncedAt: NOW,
    };

    await scoutsCol.updateOne({ userId: doc.userId }, { $set: doc }, { upsert: true });
  }
  console.log(`  ${scouts.length} scouts upserted`);

  // === ADULTS ===
  console.log('\n=== Loading Adults ===');
  const adultsData = readJSON('org_units_adults.json');
  const adults = adultsData.users || adultsData;
  const adultsCol = db.collection('scoutbook_adults');

  for (const a of adults) {
    const doc = {
      userId: String(a.userId),
      memberId: String(a.memberId),
      personGuid: a.personGuid,
      firstName: a.firstName,
      lastName: a.lastName,
      fullName: a.personFullName,
      email: a.email,
      phone: a.mobilePhone || a.homePhone,
      orgGuid: ORG_GUID,
      unitNumber: UNIT_NUMBER,
      positions: (a.positions || []).map(p => ({ name: p.position, code: p.positionId ? String(p.positionId) : undefined, isKey3: p.isKey3 })),
      syncedAt: NOW,
    };
    await adultsCol.updateOne({ userId: doc.userId }, { $set: doc }, { upsert: true });
  }
  console.log(`  ${adults.length} adults upserted`);

  // === PARENTS ===
  console.log('\n=== Loading Parents ===');
  const parentsData = readJSON('org_units_parents.json');
  const parentEntries = Array.isArray(parentsData) ? parentsData : (parentsData.parents || []);
  const parentsCol = db.collection('scoutbook_parents');
  const parentMap = new Map();

  for (const pe of parentEntries) {
    const pid = String(pe.parentUserId);
    if (!parentMap.has(pid)) {
      parentMap.set(pid, {
        userId: pid,
        memberId: pe.parentInformation?.memberId ? String(pe.parentInformation.memberId) : undefined,
        personGuid: pe.parentInformation?.personGuid,
        firstName: pe.parentInformation?.firstName,
        lastName: pe.parentInformation?.lastName,
        fullName: pe.parentInformation?.personFullName,
        email: pe.parentInformation?.email,
        phone: pe.parentInformation?.mobilePhone || pe.parentInformation?.homePhone,
        linkedYouthUserIds: [],
        syncedAt: NOW,
      });
    }
    parentMap.get(pid).linkedYouthUserIds.push(String(pe.youthUserId));
  }

  for (const doc of parentMap.values()) {
    await parentsCol.updateOne({ userId: doc.userId }, { $set: doc }, { upsert: true });
  }
  console.log(`  ${parentMap.size} parents upserted`);

  // === ADVANCEMENT ===
  console.log('\n=== Loading Advancement ===');
  const advCol = db.collection('scoutbook_advancement');
  let advCount = 0;

  for (const s of scouts) {
    const uid = String(s.userId);

    // Ranks
    const ranksFile = `youth_${s.userId}_ranks.json`;
    if (fileExists(ranksFile)) {
      const ranksData = readJSON(ranksFile);
      for (const prog of (ranksData.program || [])) {
        if (!prog.program?.includes('Scouts BSA')) continue;
        for (const rank of (prog.ranks || [])) {
          if ((rank.percentCompleted || 0) === 0 && rank.status !== 'Awarded') continue;
          const doc = {
            userId: uid,
            type: 'rank',
            advancementId: rank.id,
            name: rank.name,
            versionId: rank.versionId,
            status: rank.status,
            percentCompleted: rank.percentCompleted || 0,
            dateStarted: rank.dateEarned || undefined,
            dateCompleted: rank.status === 'Awarded' ? (rank.awardedDate || rank.dateEarned) : undefined,
            dateAwarded: rank.awardedDate || undefined,
            syncedAt: NOW,
          };
          await advCol.updateOne({ userId: uid, type: 'rank', advancementId: rank.id }, { $set: doc }, { upsert: true });
          advCount++;
        }
      }
    }

    // Merit Badges
    const mbFile = `youth_${s.userId}_meritBadges.json`;
    if (fileExists(mbFile)) {
      const mbData = readJSON(mbFile);
      const badges = Array.isArray(mbData) ? mbData : (mbData.meritBadges || []);
      for (const mb of badges) {
        if ((mb.percentCompleted || 0) === 0 && mb.status !== 'Completed' && !mb.awarded) continue;
        const doc = {
          userId: uid,
          type: 'meritBadge',
          advancementId: mb.id,
          name: mb.name,
          versionId: mb.versionId ? Number(mb.versionId) : undefined,
          status: mb.awarded ? 'Awarded' : mb.status,
          percentCompleted: mb.percentCompleted || 0,
          dateStarted: mb.dateStarted || undefined,
          dateCompleted: mb.dateCompleted || undefined,
          dateAwarded: mb.awardedDate || undefined,
          isEagleRequired: mb.isEagleRequired || false,
          counselorUserId: mb.assignedCounselorUserId ? String(mb.assignedCounselorUserId) : undefined,
          syncedAt: NOW,
        };
        await advCol.updateOne({ userId: uid, type: 'meritBadge', advancementId: mb.id }, { $set: doc }, { upsert: true });
        advCount++;
      }
    }

    // Awards
    const awardsFile = `youth_${s.userId}_awards.json`;
    if (fileExists(awardsFile)) {
      const awardsData = readJSON(awardsFile);
      const awards = Array.isArray(awardsData) ? awardsData : (awardsData.awards || []);
      for (const aw of awards) {
        if ((aw.percentCompleted || 0) === 0 && !aw.awarded) continue;
        const doc = {
          userId: uid,
          type: 'award',
          advancementId: aw.awardId || aw.id,
          name: aw.name,
          status: aw.awarded ? 'Awarded' : 'Started',
          percentCompleted: aw.percentCompleted || 0,
          dateCompleted: aw.dateEarned || undefined,
          dateAwarded: aw.awardedDate || undefined,
          syncedAt: NOW,
        };
        await advCol.updateOne({ userId: uid, type: 'award', advancementId: doc.advancementId }, { $set: doc }, { upsert: true });
        advCount++;
      }
    }
  }
  console.log(`  ${advCount} advancement records upserted`);

  // === REQUIREMENTS ===
  console.log('\n=== Loading Requirements ===');
  const reqCol = db.collection('scoutbook_requirements');
  let reqCount = 0;

  for (const s of scouts) {
    const uid = String(s.userId);
    // Find all requirement files for this scout
    const reqFiles = fs.readdirSync(DATA_DIR).filter(f =>
      f.startsWith(`youth_${s.userId}_rank_`) && f.endsWith('_requirements.json')
    );

    for (const rf of reqFiles) {
      const rankIdMatch = rf.match(/rank_(\d+)_requirements/);
      if (!rankIdMatch) continue;
      const rankId = parseInt(rankIdMatch[1]);

      const reqData = readJSON(rf);
      const reqs = Array.isArray(reqData) ? reqData : (reqData.requirements || []);

      for (const req of reqs) {
        const doc = {
          userId: uid,
          advancementType: 'rank',
          advancementId: rankId,
          reqId: req.id,
          reqNumber: req.requirementNumber || req.listNumber || '',
          reqName: req.short || req.name || '',
          parentReqId: req.parentRequirementId || null,
          completed: req.completed || false,
          started: req.started || false,
          dateCompleted: req.dateCompleted || undefined,
          dateStarted: req.dateStarted || undefined,
          leaderApprovedDate: req.leaderApprovedDate || undefined,
          percentCompleted: req.percentCompleted || 0,
          syncedAt: NOW,
        };
        await reqCol.updateOne(
          { userId: uid, advancementType: 'rank', advancementId: rankId, reqId: req.id },
          { $set: doc },
          { upsert: true }
        );
        reqCount++;
      }
    }
  }
  console.log(`  ${reqCount} requirement records upserted`);

  // === SYNC LOG ===
  console.log('\n=== Writing Sync Log ===');
  const syncLogCol = db.collection('scoutbook_sync_log');
  await syncLogCol.insertOne({
    timestamp: NOW,
    operation: 'all',
    orgGuid: ORG_GUID,
    result: 'success',
    counts: {
      scouts: scouts.length,
      adults: adults.length,
      parents: parentMap.size,
      advancement: advCount,
      requirements: reqCount,
    },
    source: 'json-import',
    durationMs: 0,
  });
  console.log('  Sync log entry written');

  // === SUMMARY ===
  console.log('\n=== Collection Counts ===');
  for (const col of ['scoutbook_scouts', 'scoutbook_adults', 'scoutbook_parents', 'scoutbook_advancement', 'scoutbook_requirements', 'scoutbook_sync_log']) {
    const c = await db.collection(col).countDocuments();
    console.log(`  ${col}: ${c}`);
  }

  await client.close();
  console.log('\nDone!');
}

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
}

function fileExists(filename) {
  return fs.existsSync(path.join(DATA_DIR, filename));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
