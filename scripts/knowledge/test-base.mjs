#!/usr/bin/env node
/**
 * Test the scouting knowledge base end-to-end.
 * Connects to production MongoDB + pgvector and runs the same queries
 * the MCP tools would make. Reports pass/fail for each check.
 *
 * Usage: nvm exec 24 node scripts/test-knowledge-base.mjs
 *
 * Requires SSH tunnel for pgvector:
 *   gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 \
 *     --tunnel-through-iap -- -L 5433:172.19.0.2:5432 -L 27018:172.19.0.4:27017 -N
 *
 * Or run directly on the VM:
 *   MONGO_URI=mongodb://localhost:27017/LibreChat \
 *   POSTGRES_URI=postgresql://myuser:mypassword@172.19.0.2:5432/scouting_knowledge \
 *   GEMINI_KEY=<key> node scripts/test-knowledge-base.mjs
 */

import pg from 'pg';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/LibreChat';
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://myuser:mypassword@localhost:5433/scouting_knowledge';
const GEMINI_KEY = process.env.GEMINI_KEY || process.env.GOOGLE_KEY;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'models/gemini-embedding-2-preview';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} — ${detail || 'FAILED'}`);
    failed++;
  }
}

function skip(name, reason) {
  console.log(`  ⏭️  ${name} — ${reason}`);
  skipped++;
}

async function embedQuery(text) {
  if (!GEMINI_KEY) return null;
  const resp = await fetch(`${GEMINI_API}/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      content: { parts: [{ text }] },
      outputDimensionality: 1536,
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.embedding?.values;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Scouting Knowledge Base — End-to-End Test');
  console.log('═══════════════════════════════════════════════════════\n');

  // ================================================================
  // Section 1: MongoDB — scoutbook_reference collection
  // ================================================================
  console.log('📚 Section 1: MongoDB — Reference Data\n');

  let mongo;
  let db;
  try {
    mongo = new MongoClient(MONGO_URI);
    await mongo.connect();
    db = mongo.db();
    check('MongoDB connection', true);
  } catch (e) {
    check('MongoDB connection', false, e.message);
    console.log('\n⚠️  Cannot proceed without MongoDB. Exiting.\n');
    process.exit(1);
  }

  const refCol = db.collection('scoutbook_reference');
  const refCount = await refCol.countDocuments();
  check('scoutbook_reference collection exists', refCount > 0, `count: ${refCount}`);
  check('Reference has rank requirements', refCount >= 100, `expected 147+, got ${refCount}`);

  // Check each rank has requirements
  for (const [rankId, rankName] of [[1, 'Scout'], [2, 'Tenderfoot'], [3, 'Second Class'], [4, 'First Class'], [5, 'Star'], [6, 'Life'], [7, 'Eagle']]) {
    const count = await refCol.countDocuments({ type: 'rank_requirement', rankId });
    check(`${rankName} requirements (rank ${rankId})`, count > 0, `count: ${count}`);
  }

  // Check merit badge definitions
  const mbCount = await refCol.countDocuments({ type: 'merit_badge' });
  check('Merit badge definitions', mbCount >= 100, `expected 140, got ${mbCount}`);

  // Check a specific requirement has full text
  const tfReq = await refCol.findOne({ type: 'rank_requirement', rankId: 2, reqNumber: '4a' });
  check('Tenderfoot 4a has fullText', tfReq?.fullText?.length > 20, tfReq?.fullText?.substring(0, 60));

  // Check Eagle-required MBs (flag comes from per-scout data, not reference catalog)
  // Check in advancement data instead
  const eagleMBsInAdv = await db.collection('scoutbook_advancement').countDocuments({
    type: 'meritBadge', isEagleRequired: true
  });
  check('Eagle-required MBs flagged in advancement data', eagleMBsInAdv > 0, `count: ${eagleMBsInAdv}`);

  // ================================================================
  // Section 2: MongoDB — Scoutbook advancement data
  // ================================================================
  console.log('\n📊 Section 2: MongoDB — Scoutbook Advancement Data\n');

  const scoutsCol = db.collection('scoutbook_scouts');
  const scoutCount = await scoutsCol.countDocuments();
  check('scoutbook_scouts populated', scoutCount >= 15, `count: ${scoutCount}`);

  const advCol = db.collection('scoutbook_advancement');
  const advCount = await advCol.countDocuments();
  check('scoutbook_advancement populated', advCount >= 100, `count: ${advCount}`);

  const reqCol = db.collection('scoutbook_requirements');
  const reqCount = await reqCol.countDocuments();
  check('scoutbook_requirements populated', reqCount >= 500, `count: ${reqCount}`);

  // Check a specific scout's data
  const ben = await scoutsCol.findOne({ firstName: 'Benjamin', lastName: 'Bramwell' });
  check('Benjamin Bramwell in roster', !!ben, ben ? `userId: ${ben.userId}` : 'NOT FOUND');

  if (ben) {
    const benAdv = await advCol.countDocuments({ userId: ben.userId });
    check('Ben has advancement records', benAdv > 0, `count: ${benAdv}`);

    const benReqs = await reqCol.countDocuments({ userId: ben.userId });
    check('Ben has requirement records', benReqs > 0, `count: ${benReqs}`);
  }

  // Check sync log
  const syncLog = db.collection('scoutbook_sync_log');
  const lastSync = await syncLog.findOne({}, { sort: { timestamp: -1 } });
  check('Sync log has entries', !!lastSync, lastSync ? `last: ${lastSync.timestamp}` : 'EMPTY');

  // ================================================================
  // Section 3: pgvector — Embedded knowledge chunks
  // ================================================================
  console.log('\n🧠 Section 3: pgvector — Embedded Knowledge\n');

  let pool;
  try {
    pool = new pg.Pool({ connectionString: POSTGRES_URI });
    await pool.query('SELECT 1');
    check('pgvector connection', true);
  } catch (e) {
    check('pgvector connection', false, e.message);
    console.log('\n⚠️  Cannot test pgvector. Skipping semantic search tests.\n');
    pool = null;
  }

  if (pool) {
    const { rows: countRows } = await pool.query('SELECT count(*) FROM scouting_knowledge');
    const chunkCount = parseInt(countRows[0].count);
    check('scouting_knowledge has chunks', chunkCount > 50, `count: ${chunkCount}`);

    // Check category distribution
    const { rows: catRows } = await pool.query(
      'SELECT category, count(*) as cnt FROM scouting_knowledge GROUP BY category ORDER BY cnt DESC'
    );
    for (const row of catRows) {
      check(`Category "${row.category}" has chunks`, parseInt(row.cnt) > 0, `count: ${row.cnt}`);
    }

    // Check troop_customizations table exists
    const { rows: tcRows } = await pool.query('SELECT count(*) FROM troop_customizations');
    check('troop_customizations table exists', true);
    console.log(`    (${tcRows[0].count} troop policies stored)`);

    // Check embedding dimensions
    const { rows: dimRows } = await pool.query(
      'SELECT vector_dims(embedding) as dims FROM scouting_knowledge LIMIT 1'
    );
    if (dimRows.length > 0) {
      check('Embedding dimensions = 1536', dimRows[0].dims === 1536, `got: ${dimRows[0].dims}`);
    }
  }

  // ================================================================
  // Section 4: Semantic Search — End-to-end query
  // ================================================================
  console.log('\n🔍 Section 4: Semantic Search\n');

  if (!GEMINI_KEY) {
    skip('Semantic search tests', 'GEMINI_KEY not set');
  } else if (!pool) {
    skip('Semantic search tests', 'pgvector not connected');
  } else {
    // Test 1: Tenderfoot first aid
    const q1 = 'What are the Tenderfoot first aid requirements?';
    const emb1 = await embedQuery(q1);
    check('Gemini Embedding 2 API works', !!emb1, emb1 ? `${emb1.length} dimensions` : 'FAILED');

    if (emb1) {
      const vec1 = `[${emb1.join(',')}]`;
      const { rows: r1 } = await pool.query(
        `SELECT content, category, rank, 1-(embedding <=> $1::vector) AS similarity
         FROM scouting_knowledge ORDER BY embedding <=> $1::vector LIMIT 3`,
        [vec1]
      );
      check('Search returns results', r1.length > 0);
      if (r1.length > 0) {
        const topSim = r1[0].similarity;
        check('Top result similarity > 0.5', topSim > 0.5, `similarity: ${topSim.toFixed(3)}`);
        check('Top result is rank_requirement category', r1[0].category === 'rank_requirement', `got: ${r1[0].category}`);
        const mentionsTenderfoot = r1[0].content.toLowerCase().includes('tenderfoot') ||
          r1[0].rank === 'tenderfoot';
        check('Top result relates to Tenderfoot', mentionsTenderfoot);
      }

      // Test 2: Board of Review policy
      const q2 = 'Can a scout be denied advancement at a Board of Review?';
      const emb2 = await embedQuery(q2);
      if (emb2) {
        const vec2 = `[${emb2.join(',')}]`;
        const { rows: r2 } = await pool.query(
          `SELECT content, category, 1-(embedding <=> $1::vector) AS similarity
           FROM scouting_knowledge ORDER BY embedding <=> $1::vector LIMIT 3`,
          [vec2]
        );
        check('BOR policy search returns results', r2.length > 0);
        if (r2.length > 0) {
          const borRelated = r2[0].content.toLowerCase().includes('board of review') ||
            r2[0].content.toLowerCase().includes('bor') ||
            r2[0].category === 'policy';
          check('BOR result is policy-related', borRelated, `category: ${r2[0].category}`);
        }
      }

      // Test 3: Troop-specific query
      const q3 = 'When does Troop 2024 hold meetings?';
      const emb3 = await embedQuery(q3);
      if (emb3) {
        const vec3 = `[${emb3.join(',')}]`;
        const { rows: r3 } = await pool.query(
          `SELECT content, category, 1-(embedding <=> $1::vector) AS similarity
           FROM scouting_knowledge ORDER BY embedding <=> $1::vector LIMIT 3`,
          [vec3]
        );
        check('Troop-specific search returns results', r3.length > 0);
        if (r3.length > 0) {
          const troopRelated = r3[0].category === 'troop' ||
            r3[0].content.toLowerCase().includes('troop 2024') ||
            r3[0].content.toLowerCase().includes('tuesday');
          check('Result contains troop info', troopRelated, `category: ${r3[0].category}`);
        }
      }

      // Test 4: Eagle-required merit badge query
      const q4 = 'What merit badges are required for Eagle Scout?';
      const emb4 = await embedQuery(q4);
      if (emb4) {
        const vec4 = `[${emb4.join(',')}]`;
        const { rows: r4 } = await pool.query(
          `SELECT content, category, 1-(embedding <=> $1::vector) AS similarity
           FROM scouting_knowledge ORDER BY embedding <=> $1::vector LIMIT 3`,
          [vec4]
        );
        check('Eagle MB search returns results', r4.length > 0);
        if (r4.length > 0) {
          const eagleRelated = r4[0].content.toLowerCase().includes('eagle') ||
            r4[0].content.toLowerCase().includes('merit badge');
          check('Result mentions Eagle/merit badges', eagleRelated);
        }
      }
    }
  }

  // ================================================================
  // Section 5: Cross-reference — Reference + Advancement merge
  // ================================================================
  console.log('\n🔗 Section 5: Reference + Advancement Cross-Reference\n');

  // Simulate what get_rank_requirements does
  const tfRefs = await refCol.find({ type: 'rank_requirement', rankId: 2 }).sort({ sortOrder: 1 }).toArray();
  check('Tenderfoot reference requirements loaded', tfRefs.length > 20, `count: ${tfRefs.length}`);

  if (ben) {
    const benTfReqs = await reqCol.find({
      userId: ben.userId, advancementType: 'rank', advancementId: 2
    }).toArray();
    check('Ben has Tenderfoot completion data', benTfReqs.length > 0, `count: ${benTfReqs.length}`);

    if (benTfReqs.length > 0) {
      const completed = benTfReqs.filter(r => r.completed).length;
      const total = benTfReqs.length;
      check('Ben Tenderfoot completion data is reasonable', completed > 0 && completed <= total,
        `${completed}/${total} completed`);

      // Check we can match ref to completion by reqNumber
      const refNumbers = new Set(tfRefs.map(r => r.reqNumber).filter(Boolean));
      const compNumbers = new Set(benTfReqs.map(r => r.reqNumber).filter(Boolean));
      const overlap = [...refNumbers].filter(n => compNumbers.has(n));
      check('Reference reqNumbers match completion reqNumbers', overlap.length > 10,
        `${overlap.length} matching out of ${refNumbers.size} ref / ${compNumbers.size} completion`);
    }
  }

  // ================================================================
  // Section 6: Data freshness
  // ================================================================
  console.log('\n📅 Section 6: Data Freshness\n');

  if (lastSync) {
    const syncAge = Date.now() - new Date(lastSync.timestamp).getTime();
    const ageDays = (syncAge / (1000 * 60 * 60 * 24)).toFixed(1);
    check('Last sync within 30 days', syncAge < 30 * 24 * 60 * 60 * 1000, `${ageDays} days ago`);
  }

  if (pool) {
    const { rows: freshRows } = await pool.query(
      'SELECT max(updated_at) as latest FROM scouting_knowledge'
    );
    if (freshRows[0].latest) {
      const kbAge = Date.now() - new Date(freshRows[0].latest).getTime();
      const kbDays = (kbAge / (1000 * 60 * 60 * 24)).toFixed(1);
      check('Knowledge base updated within 30 days', kbAge < 30 * 24 * 60 * 60 * 1000,
        `${kbDays} days ago`);
    }
  }

  // ================================================================
  // Summary
  // ================================================================
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Cleanup
  if (mongo) await mongo.close();
  if (pool) await pool.end();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
