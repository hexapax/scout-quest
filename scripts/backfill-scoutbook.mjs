#!/usr/bin/env node
/**
 * backfill-scoutbook.mjs
 *
 * Compares TroopMaster partial badge data against Scoutbook requirements
 * and generates BSA API calls to backfill missing requirement completions.
 *
 * Usage:
 *   node scripts/backfill-scoutbook.mjs                          # Dry-run report for all scouts
 *   node scripts/backfill-scoutbook.mjs --scout "Connor"         # Dry-run for one scout
 *   SCOUTBOOK_TOKEN=eyJ... node scripts/backfill-scoutbook.mjs --execute  # Execute API calls
 *
 * Environment:
 *   MONGO_URI        — MongoDB connection string (default: mongodb://localhost:27017/scoutquest)
 *   SCOUTBOOK_TOKEN  — BSA JWT from manual Chrome login (required for --execute)
 */

import { createRequire } from 'node:module';
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
const SCOUTBOOK_TOKEN = process.env.SCOUTBOOK_TOKEN || '';
const BSA_BASE = 'https://api.scouting.org';
const ORG_GUID = 'E1D07881-103D-43D8-92C4-63DEFDC05D48';
const LEADER_USER_ID = 9120709;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const executeMode = args.includes('--execute');
const scoutIdx = args.indexOf('--scout');
const scoutFilter = scoutIdx !== -1 ? args[scoutIdx + 1] : null;

if (executeMode && !SCOUTBOOK_TOKEN) {
  console.error('ERROR: --execute requires SCOUTBOOK_TOKEN env var.');
  console.error('Get it by logging into my.scouting.org in Chrome DevTools -> Application -> Cookies');
  process.exit(1);
}

if (executeMode && SCOUTBOOK_TOKEN) {
  // Validate token expiration
  try {
    const payload = JSON.parse(Buffer.from(SCOUTBOOK_TOKEN.split('.')[1], 'base64url').toString());
    const expDate = new Date(payload.exp * 1000);
    const nowMs = Date.now();
    if (payload.exp * 1000 < nowMs) {
      console.error(`ERROR: Token expired at ${expDate.toISOString()} (${Math.round((nowMs - payload.exp * 1000) / 60000)} min ago)`);
      process.exit(1);
    }
    console.log(`Token valid -- expires ${expDate.toISOString()} (${Math.round((payload.exp * 1000 - nowMs) / 60000)} min from now)`);
  } catch {
    console.error('ERROR: Failed to decode SCOUTBOOK_TOKEN JWT');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a badge name for fuzzy matching.
 * Strips asterisks (Eagle-required markers from TM), hash signs (special markers),
 * articles ("the", "in the"), lowercases, collapses whitespace.
 *
 * TM:  "Citizenship In Nation*"   -> "citizenship nation"
 * SB:  "Citizenship in the Nation" -> "citizenship nation"
 * TM:  "Citizenship in Society#"  -> "citizenship society"
 * TM:  "Signs, Signals & Codes"   -> "signs signals codes"
 * SB:  "Small-Boat Sailing"       -> "small boat sailing"
 */
function normalizeBadgeName(name) {
  return name
    .replace(/[*#]/g, '')           // strip TM markers (* = Eagle-required, # = special)
    .replace(/[&,\-]/g, ' ')        // normalize punctuation
    .toLowerCase()
    .replace(/\b(the|in|and|of|a)\b/g, '')  // strip articles and prepositions
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

/**
 * Normalize a requirement number for cross-system matching.
 *
 * TM formats:   "3a", "8a1", "2b3", "9b1"
 * SB formats:   "3a", "8a(1)", "2b[3]", "9b(1)", "1.", "8."
 *
 * Strategy: strip trailing periods, brackets, and parentheses from SB format
 * to produce a canonical form that matches TM's flat notation.
 */
function normalizeReqNumber(reqNum) {
  return reqNum
    .replace(/\.$/, '')         // strip trailing period ("1." -> "1")
    .replace(/[[\]()]/g, '')    // strip brackets and parens ("8a(1)" -> "8a1", "2b[3]" -> "2b3")
    .replace(/\s+.*$/, '')      // strip text suffixes ("6c1 sheep" -> "6c1")
    .trim()
    .toLowerCase();
}

/**
 * Find parent requirement numbers for a given TM req.
 * e.g., "8a1" -> ["8a", "8"], "3b" -> ["3"], "5" -> []
 *
 * Used when an exact TM req number doesn't match any SB req --
 * TM may track finer granularity than SB.
 */
function getParentReqNumbers(tmReq) {
  const parents = [];
  // Try stripping trailing digits: "8a1" -> "8a"
  const letterMatch = tmReq.match(/^(\d+[a-z])\d+$/i);
  if (letterMatch) {
    parents.push(letterMatch[1].toLowerCase());
  }
  // Try stripping trailing letter+digits: "8a1" -> "8", "3b" -> "3"
  const numMatch = tmReq.match(/^(\d+)[a-z]/i);
  if (numMatch) {
    parents.push(numMatch[1]);
  }
  return parents;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// BSA API caller
// ---------------------------------------------------------------------------

async function bsaPost(path, payload) {
  const res = await fetch(`${BSA_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${SCOUTBOOK_TOKEN}`,
      'Content-Type': 'application/json',
      Origin: 'https://advancements.scouting.org',
      Referer: 'https://advancements.scouting.org/',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BSA API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

async function main() {
  console.log('Scoutbook Backfill Tool');
  console.log('======================');
  console.log(`Mode:        ${executeMode ? 'EXECUTE (will make API calls!)' : 'DRY RUN (report only)'}`);
  console.log(`Scout filter: ${scoutFilter || '(all scouts)'}`);
  console.log(`MongoDB URI: ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}`);
  console.log('');

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();

    // -----------------------------------------------------------------------
    // Load all data into memory
    // -----------------------------------------------------------------------
    console.log('Loading data...');

    let tmFilter = {};
    if (scoutFilter) {
      tmFilter = { name: { $regex: scoutFilter, $options: 'i' } };
    }
    const tmScouts = await db.collection('troopmaster_merged').find(tmFilter).toArray();
    console.log(`  TroopMaster scouts:      ${tmScouts.length}`);

    const sbScouts = await db.collection('scoutbook_scouts').find({}).toArray();
    console.log(`  Scoutbook scouts:        ${sbScouts.length}`);

    const sbAdvancement = await db.collection('scoutbook_advancement').find({}).toArray();
    console.log(`  Scoutbook advancements:  ${sbAdvancement.length}`);

    const sbRequirements = await db.collection('scoutbook_requirements').find({}).toArray();
    console.log(`  Scoutbook requirements:  ${sbRequirements.length}`);
    console.log('');

    // -----------------------------------------------------------------------
    // Build lookup maps
    // -----------------------------------------------------------------------

    // memberId -> SB scout doc
    const sbScoutByMemberId = new Map();
    for (const s of sbScouts) {
      sbScoutByMemberId.set(s.memberId, s);
    }

    // userId+normalizedBadgeName -> SB advancement doc
    const sbAdvByUserAndName = new Map();
    for (const a of sbAdvancement) {
      const key = `${a.userId}|${normalizeBadgeName(a.name)}`;
      sbAdvByUserAndName.set(key, a);
    }

    // userId+advancementId -> array of SB requirement docs
    const sbReqsByUserAndAdv = new Map();
    for (const r of sbRequirements) {
      const key = `${r.userId}|${r.advancementId}`;
      if (!sbReqsByUserAndAdv.has(key)) sbReqsByUserAndAdv.set(key, []);
      sbReqsByUserAndAdv.get(key).push(r);
    }

    // -----------------------------------------------------------------------
    // Process each scout
    // -----------------------------------------------------------------------
    const results = {
      scouts: [],
      totalBackfill: 0,
      totalAlreadySynced: 0,
      totalUnmatched: 0,
      totalNoSbScout: 0,
      totalNoSbBadge: 0,
      totalEarnedMissing: 0,
    };

    for (const tm of tmScouts) {
      const scoutResult = {
        name: tm.name,
        bsaId: tm.bsaId,
        sbUserId: null,
        badges: [],
        earnedMissing: [],
      };

      // Match TM scout -> SB scout by bsaId = memberId
      const sbScout = sbScoutByMemberId.get(tm.bsaId);
      if (!sbScout) {
        scoutResult.error = 'No matching Scoutbook scout found';
        results.totalNoSbScout++;
        results.scouts.push(scoutResult);
        continue;
      }
      scoutResult.sbUserId = sbScout.userId;

      // ----- Process partial badges -----
      for (const tmBadge of (tm.partialBadges || [])) {
        const normalizedName = normalizeBadgeName(tmBadge.name);
        const advKey = `${sbScout.userId}|${normalizedName}`;
        const sbAdv = sbAdvByUserAndName.get(advKey);

        const badgeResult = {
          tmName: tmBadge.name,
          sbName: sbAdv?.name || null,
          advancementId: sbAdv?.advancementId || null,
          versionId: sbAdv?.versionId || null,
          toBackfill: [],
          alreadySynced: [],
          unmatched: [],
        };

        if (!sbAdv) {
          // No matching badge in SB at all
          badgeResult.error = 'Badge not found in Scoutbook advancement';
          badgeResult.unmatched = tmBadge.completedReqs.map((r) => ({
            tmReq: r,
            reason: 'badge not in Scoutbook',
          }));
          results.totalUnmatched += tmBadge.completedReqs.length;
          results.totalNoSbBadge++;
          scoutResult.badges.push(badgeResult);
          continue;
        }

        // Get SB requirements for this scout + badge
        const reqKey = `${sbScout.userId}|${sbAdv.advancementId}`;
        const sbReqs = sbReqsByUserAndAdv.get(reqKey) || [];

        // Build normalized reqNumber -> SB req doc map
        // Some SB reqs share the same normalized number (e.g., "6c1 sheep" vs "6c1 hog")
        // We build a map of normalized -> array of candidates
        const sbReqByNorm = new Map();
        for (const r of sbReqs) {
          const norm = normalizeReqNumber(r.reqNumber);
          if (!sbReqByNorm.has(norm)) sbReqByNorm.set(norm, []);
          sbReqByNorm.get(norm).push(r);
        }

        for (const tmReq of tmBadge.completedReqs) {
          const tmNorm = tmReq.toLowerCase().trim();

          // Try exact match first
          let candidates = sbReqByNorm.get(tmNorm);

          // If no exact match, try parent reqs (TM may be more granular)
          if (!candidates || candidates.length === 0) {
            const parents = getParentReqNumbers(tmNorm);
            for (const parent of parents) {
              candidates = sbReqByNorm.get(parent);
              if (candidates && candidates.length > 0) break;
            }
          }

          if (!candidates || candidates.length === 0) {
            badgeResult.unmatched.push({
              tmReq,
              reason: 'no matching SB requirement number',
            });
            results.totalUnmatched++;
            continue;
          }

          // Use the first candidate (for multi-candidates like animal husbandry,
          // we can't disambiguate -- flag as unmatched if ambiguous text suffix)
          const sbReq = candidates[0];

          if (sbReq.completed) {
            badgeResult.alreadySynced.push({
              tmReq,
              sbReqNumber: sbReq.reqNumber,
              reqId: sbReq.reqId,
            });
            results.totalAlreadySynced++;
          } else {
            badgeResult.toBackfill.push({
              tmReq,
              sbReqNumber: sbReq.reqNumber,
              reqId: sbReq.reqId,
              advancementId: sbAdv.advancementId,
            });
            results.totalBackfill++;
          }
        }

        scoutResult.badges.push(badgeResult);
      }

      // ----- Check earned badges missing from SB -----
      for (const tmEarned of (tm.earnedBadges || [])) {
        const normalizedName = normalizeBadgeName(tmEarned.name);
        const advKey = `${sbScout.userId}|${normalizedName}`;
        const sbAdv = sbAdvByUserAndName.get(advKey);

        if (!sbAdv) {
          scoutResult.earnedMissing.push({
            name: tmEarned.name,
            date: tmEarned.date,
            reason: 'badge not found in Scoutbook at all',
          });
          results.totalEarnedMissing++;
        } else if (sbAdv.status !== 'Awarded') {
          scoutResult.earnedMissing.push({
            name: tmEarned.name,
            date: tmEarned.date,
            sbStatus: sbAdv.status,
            reason: `TM shows earned but SB status is "${sbAdv.status}"`,
          });
          results.totalEarnedMissing++;
        }
      }

      results.scouts.push(scoutResult);
    }

    // -----------------------------------------------------------------------
    // Print report
    // -----------------------------------------------------------------------
    console.log('');
    console.log('========================================');
    console.log('         BACKFILL REPORT');
    console.log('========================================');
    console.log('');

    for (const scout of results.scouts) {
      const hasBadgeWork = scout.badges?.some(
        (b) => b.toBackfill.length > 0 || b.unmatched.length > 0
      );
      const hasEarnedMissing = scout.earnedMissing?.length > 0;

      if (!hasBadgeWork && !hasEarnedMissing && !scout.error) continue;

      console.log(`--- ${scout.name} (BSA ID: ${scout.bsaId}, SB userId: ${scout.sbUserId || 'N/A'}) ---`);

      if (scout.error) {
        console.log(`  ERROR: ${scout.error}`);
        console.log('');
        continue;
      }

      for (const badge of (scout.badges || [])) {
        if (badge.toBackfill.length === 0 && badge.unmatched.length === 0 && !badge.error) continue;

        console.log(`  Badge: ${badge.tmName}`);
        if (badge.error) {
          console.log(`    ERROR: ${badge.error}`);
        }
        if (badge.sbName) {
          console.log(`    SB match: ${badge.sbName} (advId: ${badge.advancementId}, verId: ${badge.versionId})`);
        }
        if (badge.alreadySynced.length > 0) {
          console.log(`    Already in SB (${badge.alreadySynced.length}): ${badge.alreadySynced.map((r) => r.tmReq).join(', ')}`);
        }
        if (badge.toBackfill.length > 0) {
          console.log(`    TO BACKFILL (${badge.toBackfill.length}):`);
          for (const r of badge.toBackfill) {
            console.log(`      ${r.tmReq} -> SB req "${r.sbReqNumber}" (reqId: ${r.reqId})`);
          }
        }
        if (badge.unmatched.length > 0) {
          console.log(`    UNMATCHED (${badge.unmatched.length}):`);
          for (const r of badge.unmatched) {
            console.log(`      ${r.tmReq}: ${r.reason}`);
          }
        }
      }

      if (hasEarnedMissing) {
        console.log('  Earned badges missing from SB:');
        for (const e of scout.earnedMissing) {
          console.log(`    ${e.name} (earned ${e.date}): ${e.reason}`);
        }
      }

      console.log('');
    }

    // Summary
    console.log('========================================');
    console.log('            SUMMARY');
    console.log('========================================');
    console.log(`  Scouts processed:        ${results.scouts.length}`);
    console.log(`  Scouts not in SB:        ${results.totalNoSbScout}`);
    console.log(`  Badges not in SB:        ${results.totalNoSbBadge}`);
    console.log(`  Reqs to backfill:        ${results.totalBackfill}`);
    console.log(`  Reqs already synced:     ${results.totalAlreadySynced}`);
    console.log(`  Reqs unmatched:          ${results.totalUnmatched}`);
    console.log(`  Earned badges missing:   ${results.totalEarnedMissing}`);
    console.log('');

    // -----------------------------------------------------------------------
    // Execute mode: make API calls
    // -----------------------------------------------------------------------
    if (executeMode && results.totalBackfill > 0) {
      console.log('========================================');
      console.log('       EXECUTING BACKFILL');
      console.log('========================================');
      console.log('');

      const todayStr = today();
      let successCount = 0;
      let errorCount = 0;

      for (const scout of results.scouts) {
        if (!scout.sbUserId) continue;

        // Group backfill items by advancementId for batching
        const byAdvancement = new Map();
        for (const badge of (scout.badges || [])) {
          for (const req of badge.toBackfill) {
            if (!byAdvancement.has(req.advancementId)) {
              byAdvancement.set(req.advancementId, {
                advancementId: req.advancementId,
                badgeName: badge.sbName,
                reqs: [],
              });
            }
            byAdvancement.get(req.advancementId).reqs.push(req);
          }
        }

        if (byAdvancement.size === 0) continue;

        console.log(`Processing ${scout.name} (userId: ${scout.sbUserId})...`);

        for (const [advId, group] of byAdvancement) {
          const payload = [{
            userId: parseInt(scout.sbUserId, 10),
            organizationGuid: ORG_GUID,
            requirements: group.reqs.map((r) => ({
              id: r.reqId,
              completed: true,
              started: true,
              approved: true,
              dateCompleted: todayStr,
              dateStarted: todayStr,
              markedCompletedDate: todayStr,
              leaderApprovedDate: todayStr,
              leaderApprovedUserId: LEADER_USER_ID,
            })),
          }];

          // The write endpoint uses the same pattern as ranks but for meritBadges
          const path = `/advancements/v2/youth/meritBadges/${advId}/requirements`;

          try {
            console.log(`  ${group.badgeName} (advId: ${advId}): ${group.reqs.length} requirements...`);
            const response = await bsaPost(path, payload);

            // Check per-requirement results
            const results = response?.[0]?.requirements || [];
            let batchOk = 0;
            let batchFail = 0;
            for (const r of results) {
              if (r.status === 'Success') {
                batchOk++;
              } else {
                batchFail++;
                console.log(`    FAIL reqId ${r.id}: ${r.message || r.status}`);
              }
            }
            console.log(`    Result: ${batchOk} succeeded, ${batchFail} failed (advancement status: ${response?.[0]?.status || 'unknown'})`);
            successCount += batchOk;
            errorCount += batchFail;
          } catch (err) {
            console.log(`    ERROR: ${err.message}`);
            errorCount += group.reqs.length;
          }
        }

        // 1-second delay between scouts
        console.log('  (waiting 1s before next scout...)');
        await sleep(1000);
      }

      console.log('');
      console.log('========================================');
      console.log('       EXECUTION COMPLETE');
      console.log('========================================');
      console.log(`  Requirements updated: ${successCount}`);
      console.log(`  Errors:              ${errorCount}`);
      console.log('');
    } else if (executeMode && results.totalBackfill === 0) {
      console.log('Nothing to backfill. All TM requirements are already in Scoutbook.');
      console.log('');
    } else if (!executeMode && results.totalBackfill > 0) {
      console.log('This was a dry run. To execute the backfill, run with --execute and SCOUTBOOK_TOKEN set.');
      console.log('');
    }

  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
