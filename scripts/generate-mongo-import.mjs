#!/usr/bin/env node
/**
 * Generate mongosh-compatible JS script to load Scoutbook data.
 * Output: a .js file that can be piped into mongosh.
 *
 * Usage: nvm exec 24 node scripts/generate-mongo-import.mjs > /tmp/scoutbook-import.js
 * Then: mongosh scoutquest < /tmp/scoutbook-import.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'scouting-org-research', 'data', 'fresh');
const ORG_GUID = 'E1D07881-103D-43D8-92C4-63DEFDC05D48';
const UNIT_NUMBER = '2024';

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
}
function fileExists(filename) {
  return fs.existsSync(path.join(DATA_DIR, filename));
}

const lines = [];
function emit(line) { lines.push(line); }

emit('// Auto-generated Scoutbook data import');
emit(`const NOW = new Date("${new Date().toISOString()}");`);
emit('');

// === SCOUTS ===
const rosterData = readJSON('org_units_youths.json');
const scouts = rosterData.users || rosterData;

emit('// --- Scouts ---');
emit('db.scoutbook_scouts.createIndex({ userId: 1 }, { unique: true });');
for (const s of scouts) {
  const actFile = `youth_${s.userId}_activitySummary.json`;
  const activity = fileExists(actFile) ? readJSON(actFile) : null;
  const highestRank = (s.highestRanksAwarded || []).filter(r => r.programId === 2)
    .sort((a, b) => b.level - a.level)[0] || null;

  const doc = {
    userId: String(s.userId),
    memberId: String(s.memberId),
    personGuid: s.personGuid,
    firstName: s.firstName,
    lastName: s.lastName,
    fullName: s.personFullName,
    nickName: s.nickName || null,
    dob: s.dateOfBirth,
    age: s.age,
    gender: s.gender,
    grade: s.grade,
    email: s.email,
    phone: s.mobilePhone || s.homePhone,
    orgGuid: ORG_GUID,
    unitNumber: UNIT_NUMBER,
    currentRank: highestRank ? { id: highestRank.id, name: highestRank.rank, level: highestRank.level, dateEarned: highestRank.dateEarned } : null,
    positions: (s.positions || []).map(p => ({ name: p.position, patrolId: p.patrolId, patrolName: p.patrolName })),
    dateJoined: s.dateJoinedBoyScouts,
    activitySummary: activity || null,
  };
  emit(`db.scoutbook_scouts.updateOne({userId:"${doc.userId}"},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
}
emit(`print("Scouts: ${scouts.length}");`);

// === ADULTS ===
const adultsData = readJSON('org_units_adults.json');
const adults = adultsData.users || adultsData;
emit('\n// --- Adults ---');
emit('db.scoutbook_adults.createIndex({ userId: 1 }, { unique: true });');
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
    positions: (a.positions || []).map(p => ({ name: p.position, isKey3: p.isKey3 })),
  };
  emit(`db.scoutbook_adults.updateOne({userId:"${doc.userId}"},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
}
emit(`print("Adults: ${adults.length}");`);

// === ADVANCEMENT ===
emit('\n// --- Advancement ---');
emit('db.scoutbook_advancement.createIndex({ userId: 1, type: 1, advancementId: 1 }, { unique: true });');
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
          userId: uid, type: 'rank', advancementId: rank.id, name: rank.name,
          versionId: rank.versionId, status: rank.status,
          percentCompleted: rank.percentCompleted || 0,
          dateAwarded: rank.awardedDate || null,
          isEagleRequired: false,
        };
        emit(`db.scoutbook_advancement.updateOne({userId:"${uid}",type:"rank",advancementId:${rank.id}},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
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
      if ((mb.percentCompleted || 0) === 0 && !mb.awarded) continue;
      const doc = {
        userId: uid, type: 'meritBadge', advancementId: mb.id,
        name: mb.name, status: mb.awarded ? 'Awarded' : mb.status,
        percentCompleted: mb.percentCompleted || 0,
        dateAwarded: mb.awardedDate || null,
        isEagleRequired: mb.isEagleRequired || false,
        counselorUserId: mb.assignedCounselorUserId ? String(mb.assignedCounselorUserId) : null,
      };
      emit(`db.scoutbook_advancement.updateOne({userId:"${uid}",type:"meritBadge",advancementId:${mb.id}},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
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
      const advId = aw.awardId || aw.id;
      const doc = {
        userId: uid, type: 'award', advancementId: advId, name: aw.name,
        status: aw.awarded ? 'Awarded' : 'Started',
        percentCompleted: aw.percentCompleted || 0,
        dateAwarded: aw.awardedDate || null,
      };
      emit(`db.scoutbook_advancement.updateOne({userId:"${uid}",type:"award",advancementId:${advId}},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
      advCount++;
    }
  }
}
emit(`print("Advancement: ${advCount}");`);

// === REQUIREMENTS ===
emit('\n// --- Requirements ---');
emit('db.scoutbook_requirements.createIndex({ userId: 1, advancementType: 1, advancementId: 1, reqId: 1 }, { unique: true });');
let reqCount = 0;

for (const s of scouts) {
  const uid = String(s.userId);
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
        userId: uid, advancementType: 'rank', advancementId: rankId,
        reqId: req.id, reqNumber: req.requirementNumber || req.listNumber || '',
        reqName: req.short || req.name || '',
        parentReqId: req.parentRequirementId || null,
        completed: req.completed || false, started: req.started || false,
        dateCompleted: req.dateCompleted || null,
        dateStarted: req.dateStarted || null,
        percentCompleted: req.percentCompleted || 0,
      };
      emit(`db.scoutbook_requirements.updateOne({userId:"${uid}",advancementType:"rank",advancementId:${rankId},reqId:${req.id}},{$set:${JSON.stringify(doc)},$set:{syncedAt:NOW}},{upsert:true});`);
      reqCount++;
    }
  }
}
emit(`print("Requirements: ${reqCount}");`);

// === SYNC LOG ===
emit('\n// --- Sync Log ---');
emit(`db.scoutbook_sync_log.insertOne({timestamp:NOW,operation:"all",orgGuid:"${ORG_GUID}",result:"success",source:"json-import",counts:{scouts:${scouts.length},adults:${adults.length},advancement:${advCount},requirements:${reqCount}}});`);
emit('print("Sync log written");');

// === SUMMARY ===
emit('\nprint("\\n=== Collection Counts ===");');
for (const col of ['scoutbook_scouts', 'scoutbook_adults', 'scoutbook_advancement', 'scoutbook_requirements', 'scoutbook_sync_log']) {
  emit(`print("  ${col}: " + db.${col}.countDocuments());`);
}

// Write output
const output = lines.join('\n');
process.stdout.write(output);
process.stderr.write(`\nGenerated ${lines.length} lines, ${advCount} advancement, ${reqCount} requirements\n`);
