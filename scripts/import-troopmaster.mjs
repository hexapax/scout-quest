#!/usr/bin/env node
/**
 * import-troopmaster.mjs
 *
 * Imports TroopMaster tab-delimited export files into MongoDB.
 * Reads from inbox/troopmaster/*.txt, writes to scoutquest database.
 *
 * Usage:
 *   node scripts/import-troopmaster.mjs
 *
 * Environment:
 *   MONGO_URI  — MongoDB connection string (default: mongodb://localhost:27017/scoutquest)
 *   DATA_DIR   — Override data directory (default: inbox/troopmaster)
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve mongodb from the mcp-servers package where it's already installed
const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp-servers', 'scout-quest', 'package.json')
);
const { MongoClient } = require('mongodb');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/scoutquest';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || join(REPO_ROOT, 'inbox', 'troopmaster');

const FILES = {
  scouts: 'ScoutData.txt',
  advancement: 'ADVANCEMENTData.txt',
  meritBadges: 'MERITBADGEData.txt',
  partialBadges: 'PARTIALBADGEData.txt',
  adults: 'AdultData.txt',
  nova: 'NOAData.txt',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a MM/DD/YY date string to an ISO date string (YYYY-MM-DD).
 * Returns null for empty/invalid values.
 */
function parseDate(val) {
  if (!val || !val.trim()) return null;
  const trimmed = val.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  let [, mm, dd, yy] = match;
  let year = parseInt(yy, 10);
  // Two-digit year: 00–49 → 2000s, 50–99 → 1900s
  if (yy.length <= 2) {
    year = year < 50 ? 2000 + year : 1900 + year;
  }
  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a tab-delimited file. Returns { headers: string[], rows: object[] }.
 */
function parseTSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      obj[key] = (values[j] || '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Normalize BSAID field — handles "BSA ID#" vs "BSAID" naming.
 */
function getBsaId(row) {
  return (row['BSAID'] || row['BSA ID#'] || '').trim();
}

/**
 * Strip currency formatting from a string: "$ 123.45" → "123.45"
 */
function parseCurrency(val) {
  if (!val) return null;
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// File-specific parsers
// ---------------------------------------------------------------------------

function parseScoutData(filePath) {
  const { rows } = parseTSV(filePath);
  return rows.map((row) => {
    const bsaId = getBsaId(row);
    const parents = [];
    for (let i = 1; i <= 4; i++) {
      const last = row[`Parent ${i} Last Name`] || '';
      const first = row[`Parent ${i} First Name`] || '';
      if (!last && !first) continue;
      parents.push({
        name: `${first} ${last}`.trim(),
        firstName: first,
        lastName: last,
        homePhone: row[`Parent ${i} Home Phone`] || null,
        cellPhone: row[`Parent ${i} Cell Phone`] || null,
        workPhone: row[`Parent ${i} Work Phone`] || null,
        email: row[`Parent ${i} Email`] || null,
      });
    }

    return {
      bsaId,
      lastName: row['Last Name'] || '',
      firstName: row['First Name'] || '',
      middleName: row['Middle Name'] || null,
      nickname: row['Nickname'] || null,
      gender: row['Gender'] || null,
      dob: parseDate(row['DOB']),
      joinedUnit: parseDate(row['Joined Unit']),
      address: [row['Address Line 1'], row['Address Line 2'], row['Address Line 3']]
        .filter(Boolean)
        .join(', ') || null,
      mailingAddress: [row['Mailing Line 1'], row['Mailing Line 2'], row['Mailing Line 3']]
        .filter(Boolean)
        .join(', ') || null,
      homePhone: row['Home Phone'] || null,
      cellPhone: row['Cell Phone'] || null,
      workPhone: row['Work Phone'] || null,
      email: row['Email'] || null,
      remarks: row['Remarks'] || null,
      rank: row['Rank'] || null,
      rankDate: parseDate(row['Rank Date']),
      leadership: row['Leadership'] || null,
      healthFormA: row['Health Form A'] || null,
      healthFormB: row['Health Form B'] || null,
      healthFormC: row['Health Form C'] || null,
      healthFormD: row['Health Form D'] || null,
      tetanus: row['Tetanus'] || null,
      allergies: row['Allergies'] || null,
      emergencyContacts: [
        row['Em Contact #1'] ? { name: row['Em Contact #1'], phone: row['Em Phone #1'] || null } : null,
        row['Em Contact #2'] ? { name: row['Em Contact #2'], phone: row['Em Phone #2'] || null } : null,
      ].filter(Boolean),
      swimmingLevel: row['Swimming Level'] || null,
      swimmingDate: parseDate(row['Swimming Date']),
      ledgerBalance: parseCurrency(row['Ledger Balance']),
      reserveBalance: parseCurrency(row['Reserve Balance']),
      availableBalance: parseCurrency(row['Available Balance']),
      scheduleOwed: parseCurrency(row['Schedule Owed']),
      school: row['School'] || null,
      grade: row['Grade'] || null,
      patrol: row['Patrol'] || null,
      parents,
      importedAt: new Date(),
    };
  });
}

/**
 * Parse advancement data. Columns after Last/First/BSAID are requirement codes
 * with date values. Group them by rank prefix (Scout, Tenderfoot, etc.)
 */
function parseAdvancementData(filePath) {
  const { headers, rows } = parseTSV(filePath);
  // Requirement columns start at index 3 (after Last, First, BSAID)
  const reqColumns = headers.slice(3).filter(Boolean);

  // Known rank prefixes in order
  const RANK_ORDER = ['Scout', 'Tenderfoot', 'SecondClass', 'FirstClass', 'Star', 'Life', 'Eagle'];
  const RANK_DISPLAY = {
    Scout: 'Scout',
    Tenderfoot: 'Tenderfoot',
    SecondClass: 'Second Class',
    FirstClass: 'First Class',
    Star: 'Star',
    Life: 'Life',
    Eagle: 'Eagle',
  };

  return rows.map((row) => {
    const bsaId = getBsaId(row);

    // Build requirements map: { reqCode: dateString }
    const requirements = {};
    for (const col of reqColumns) {
      const dateVal = parseDate(row[col]);
      if (dateVal) {
        requirements[col] = dateVal;
      }
    }

    // Group by rank prefix and find earliest/latest dates per rank
    const rankProgress = {};
    for (const col of reqColumns) {
      const dateVal = parseDate(row[col]);
      if (!dateVal) continue;
      // Determine rank prefix
      let rankPrefix = null;
      for (const rp of RANK_ORDER) {
        if (col.startsWith(rp)) {
          rankPrefix = rp;
          break;
        }
      }
      if (!rankPrefix) continue;

      if (!rankProgress[rankPrefix]) {
        rankProgress[rankPrefix] = { total: 0, completed: 0, dates: [] };
      }
      rankProgress[rankPrefix].completed++;
      rankProgress[rankPrefix].dates.push(dateVal);
    }

    // Count total requirements per rank
    for (const col of reqColumns) {
      for (const rp of RANK_ORDER) {
        if (col.startsWith(rp)) {
          if (!rankProgress[rp]) {
            rankProgress[rp] = { total: 0, completed: 0, dates: [] };
          }
          rankProgress[rp].total++;
          break;
        }
      }
    }

    // Build ranks array with completion dates (latest date in the group = completion date)
    const ranks = RANK_ORDER.map((rp) => {
      const prog = rankProgress[rp];
      if (!prog || prog.completed === 0) return null;
      const sortedDates = [...prog.dates].sort();
      return {
        name: RANK_DISPLAY[rp],
        reqsCompleted: prog.completed,
        reqsTotal: prog.total,
        earliestDate: sortedDates[0],
        latestDate: sortedDates[sortedDates.length - 1],
        complete: prog.completed === prog.total,
      };
    }).filter(Boolean);

    return {
      bsaId,
      lastName: row['Last'] || '',
      firstName: row['First'] || '',
      requirements,
      ranks,
      importedAt: new Date(),
    };
  });
}

function parseMeritBadgeData(filePath) {
  const { rows } = parseTSV(filePath);
  return rows.map((row) => ({
    bsaId: getBsaId(row),
    lastName: row['Last'] || '',
    firstName: row['First'] || '',
    badge: (row['Badge'] || '').trim(),
    date: parseDate(row['Date']),
    importedAt: new Date(),
  }));
}

function parsePartialBadgeData(filePath) {
  const { rows } = parseTSV(filePath);
  return rows.map((row) => {
    const reqsRaw = (row['Reqts Complete'] || '').trim();
    return {
      bsaId: getBsaId(row),
      lastName: row['Last'] || '',
      firstName: row['First'] || '',
      badge: (row['Badge'] || '').trim(),
      completedReqs: reqsRaw ? reqsRaw.split(',').map((r) => r.trim()) : [],
      importedAt: new Date(),
    };
  });
}

function parseAdultData(filePath) {
  const { rows } = parseTSV(filePath);
  return rows.map((row) => {
    const bsaId = getBsaId(row);
    return {
      bsaId: bsaId || null,
      lastName: row['Last Name'] || '',
      firstName: row['First Name'] || '',
      middleName: row['Middle Name'] || null,
      nickname: row['Nickname'] || null,
      spouse: row['Spouse'] || null,
      gender: row['Gender'] || null,
      dob: parseDate(row['DOB']),
      address: [row['Address Line 1'], row['Address Line 2'], row['Address Line 3']]
        .filter(Boolean)
        .join(', ') || null,
      mailingAddress: [row['Mailing Line 1'], row['Mailing Line 2'], row['Mailing Line 3']]
        .filter(Boolean)
        .join(', ') || null,
      homePhone: row['Home Phone'] || null,
      cellPhone: row['Cell Phone'] || null,
      workPhone: row['Work Phone'] || null,
      email: row['Email'] || null,
      remarks: row['Remarks'] || null,
      leadership: row['Leadership'] || null,
      healthFormA: row['Health Form A'] || null,
      healthFormB: row['Health Form B'] || null,
      healthFormC: row['Health Form C'] || null,
      healthFormD: row['Health Form D'] || null,
      tetanus: row['Tetanus'] || null,
      allergies: row['Allergies'] || null,
      emergencyContacts: [
        row['Em Contact #1'] ? { name: row['Em Contact #1'], phone: row['Em Phone #1'] || null } : null,
        row['Em Contact #2'] ? { name: row['Em Contact #2'], phone: row['Em Phone #2'] || null } : null,
      ].filter(Boolean),
      swimmingLevel: row['Swimming Level'] || null,
      swimmingDate: parseDate(row['Swimming Date']),
      ledgerBalance: parseCurrency(row['Ledger Balance']),
      reserveBalance: parseCurrency(row['Reserve Balance']),
      availableBalance: parseCurrency(row['Available Balance']),
      scheduleOwed: parseCurrency(row['Schedule Owed']),
      importedAt: new Date(),
    };
  });
}

/**
 * Parse NOAData.txt — NOVA/Outdoor Award data.
 *
 * Format is unusual: each line has Last, First, BSAID, Award, then repeating
 * pairs of (Reqt, Date) for that scout+award combination. The header row only
 * defines the first 6 columns; remaining columns are positional Reqt/Date pairs.
 */
function parseNovaData(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map((c) => c.trim());
    const lastName = cols[0] || '';
    const firstName = cols[1] || '';
    const bsaId = cols[2] || '';
    const award = cols[3] || '';

    // Columns 4+ are Reqt/Date pairs
    const reqs = [];
    for (let j = 4; j < cols.length - 1; j += 2) {
      const reqName = cols[j] || '';
      const reqDate = parseDate(cols[j + 1]);
      if (reqName) {
        reqs.push({ req: reqName, date: reqDate });
      }
    }

    records.push({
      bsaId,
      lastName,
      firstName,
      award,
      requirements: reqs,
      importedAt: new Date(),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// MongoDB operations
// ---------------------------------------------------------------------------

/**
 * Upsert docs into a collection using bulkWrite, keyed on bsaId (+ badge/award for per-record collections).
 */
async function upsertCollection(db, collectionName, docs, keyFn) {
  if (docs.length === 0) {
    console.log(`  ${collectionName}: 0 records — skipped`);
    return 0;
  }

  const collection = db.collection(collectionName);
  const ops = docs.map((doc) => ({
    updateOne: {
      filter: keyFn(doc),
      update: { $set: doc },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(ops, { ordered: false });
  const upserted = result.upsertedCount;
  const modified = result.modifiedCount;
  const matched = result.matchedCount;
  console.log(`  ${collectionName}: ${docs.length} records — ${upserted} inserted, ${modified} modified, ${matched} matched`);
  return docs.length;
}

/**
 * Build the merged collection: one document per scout with all data joined by BSAID.
 */
async function buildMergedCollection(db) {
  const scouts = await db.collection('troopmaster_scouts').find({}).toArray();
  const advancementDocs = await db.collection('troopmaster_advancement').find({}).toArray();
  const badgeDocs = await db.collection('troopmaster_merit_badges').find({}).toArray();
  const partialDocs = await db.collection('troopmaster_partial_badges').find({}).toArray();
  const novaDocs = await db.collection('troopmaster_nova').find({}).toArray();

  // Index by bsaId
  const advByBsa = new Map();
  for (const doc of advancementDocs) {
    advByBsa.set(doc.bsaId, doc);
  }

  const badgesByBsa = new Map();
  for (const doc of badgeDocs) {
    if (!badgesByBsa.has(doc.bsaId)) badgesByBsa.set(doc.bsaId, []);
    badgesByBsa.get(doc.bsaId).push({ name: doc.badge, date: doc.date });
  }

  const partialsByBsa = new Map();
  for (const doc of partialDocs) {
    if (!partialsByBsa.has(doc.bsaId)) partialsByBsa.set(doc.bsaId, []);
    partialsByBsa.get(doc.bsaId).push({ name: doc.badge, completedReqs: doc.completedReqs });
  }

  const novaByBsa = new Map();
  for (const doc of novaDocs) {
    if (!novaByBsa.has(doc.bsaId)) novaByBsa.set(doc.bsaId, []);
    novaByBsa.get(doc.bsaId).push({
      award: doc.award,
      requirements: doc.requirements,
    });
  }

  const mergedDocs = scouts.map((scout) => {
    const adv = advByBsa.get(scout.bsaId);

    // Build parent info for merged doc
    const parents = (scout.parents || []).map((p) => ({
      name: p.name,
      email: p.email,
      phone: p.cellPhone || p.homePhone || p.workPhone || null,
    }));

    // Rank history from advancement data
    const ranks = adv?.ranks
      ? adv.ranks
          .filter((r) => r.complete)
          .map((r) => ({ name: r.name, date: r.latestDate }))
      : [];

    return {
      bsaId: scout.bsaId,
      name: `${scout.firstName} ${scout.lastName}`.trim(),
      firstName: scout.firstName,
      lastName: scout.lastName,
      email: scout.email,
      patrol: scout.patrol,
      rank: scout.rank,
      rankDate: scout.rankDate,
      parents,
      ranks,
      earnedBadges: badgesByBsa.get(scout.bsaId) || [],
      partialBadges: partialsByBsa.get(scout.bsaId) || [],
      novaAwards: novaByBsa.get(scout.bsaId) || [],
      importedAt: new Date(),
    };
  });

  const collection = db.collection('troopmaster_merged');
  if (mergedDocs.length > 0) {
    const ops = mergedDocs.map((doc) => ({
      updateOne: {
        filter: { bsaId: doc.bsaId },
        update: { $set: doc },
        upsert: true,
      },
    }));
    const result = await collection.bulkWrite(ops, { ordered: false });
    console.log(`  troopmaster_merged: ${mergedDocs.length} scouts — ${result.upsertedCount} inserted, ${result.modifiedCount} modified`);
  }

  return mergedDocs.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('TroopMaster Import');
  console.log('==================');
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`MongoDB URI:   ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}`);
  console.log('');

  // Parse all files
  console.log('Parsing files...');
  const scoutDocs = parseScoutData(join(DATA_DIR, FILES.scouts));
  console.log(`  ScoutData.txt:        ${scoutDocs.length} scouts`);

  const advDocs = parseAdvancementData(join(DATA_DIR, FILES.advancement));
  console.log(`  ADVANCEMENTData.txt:  ${advDocs.length} scouts`);

  const badgeDocs = parseMeritBadgeData(join(DATA_DIR, FILES.meritBadges));
  console.log(`  MERITBADGEData.txt:   ${badgeDocs.length} earned badges`);

  const partialDocs = parsePartialBadgeData(join(DATA_DIR, FILES.partialBadges));
  console.log(`  PARTIALBADGEData.txt: ${partialDocs.length} partial badges`);

  const adultDocs = parseAdultData(join(DATA_DIR, FILES.adults));
  console.log(`  AdultData.txt:        ${adultDocs.length} adults`);

  const novaDocs = parseNovaData(join(DATA_DIR, FILES.nova));
  console.log(`  NOAData.txt:          ${novaDocs.length} NOVA records`);

  console.log('');

  // Connect to MongoDB
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    console.log(`  Database: ${db.databaseName}`);
    console.log('');

    // Upsert all collections
    console.log('Writing to MongoDB...');

    await upsertCollection(db, 'troopmaster_scouts', scoutDocs, (doc) => ({ bsaId: doc.bsaId }));

    await upsertCollection(db, 'troopmaster_advancement', advDocs, (doc) => ({ bsaId: doc.bsaId }));

    await upsertCollection(db, 'troopmaster_merit_badges', badgeDocs, (doc) => ({
      bsaId: doc.bsaId,
      badge: doc.badge,
    }));

    await upsertCollection(db, 'troopmaster_partial_badges', partialDocs, (doc) => ({
      bsaId: doc.bsaId,
      badge: doc.badge,
    }));

    await upsertCollection(db, 'troopmaster_adults', adultDocs, (doc) => {
      // Adults may not have a BSA ID, fall back to name
      if (doc.bsaId) return { bsaId: doc.bsaId };
      return { lastName: doc.lastName, firstName: doc.firstName };
    });

    await upsertCollection(db, 'troopmaster_nova', novaDocs, (doc) => ({
      bsaId: doc.bsaId,
      award: doc.award,
    }));

    console.log('');

    // Build merged collection
    console.log('Building merged collection...');
    const mergedCount = await buildMergedCollection(db);

    // Print summary
    console.log('');
    console.log('Import Summary');
    console.log('--------------');
    console.log(`  Scouts:         ${scoutDocs.length}`);
    console.log(`  Advancement:    ${advDocs.length}`);
    console.log(`  Merit Badges:   ${badgeDocs.length}`);
    console.log(`  Partial Badges: ${partialDocs.length}`);
    console.log(`  Adults:         ${adultDocs.length}`);
    console.log(`  NOVA Records:   ${novaDocs.length}`);
    console.log(`  Merged Scouts:  ${mergedCount}`);
    console.log('');
    console.log('Done.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
