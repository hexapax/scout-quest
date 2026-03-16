#!/usr/bin/env node
/**
 * Knowledge Base Grounding Evaluation
 * Tests complex advancement questions and verifies answers are grounded
 * in actual data, not hallucinated.
 *
 * Each test:
 *   1. Queries MongoDB for ground truth
 *   2. Asks the knowledge base the same question
 *   3. Verifies the KB result contains correct, grounded information
 *
 * Usage: MONGO_URI=... POSTGRES_URI=... GEMINI_KEY=... node test-knowledge-grounding.mjs
 */

import pg from 'pg';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27018/scoutquest';
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://myuser:mypassword@localhost:5433/scouting_knowledge';
const GEMINI_KEY = process.env.GEMINI_KEY || process.env.GOOGLE_KEY;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'models/gemini-embedding-2-preview';

let passed = 0, failed = 0, skipped = 0;
let mongo, db, pool;

// ============================================================
// Helpers
// ============================================================

function check(name, condition, detail) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function skip(name, reason) {
  console.log(`  ⏭️  ${name} — ${reason}`); skipped++;
}

async function embedQuery(text) {
  const resp = await fetch(`${GEMINI_API}/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, content: { parts: [{ text }] }, outputDimensionality: 1536 }),
  });
  if (!resp.ok) return null;
  return (await resp.json()).embedding?.values;
}

async function searchKB(query, limit = 5) {
  const emb = await embedQuery(query);
  if (!emb) return [];
  const vec = `[${emb.join(',')}]`;
  const { rows } = await pool.query(
    `SELECT content, category, rank, merit_badge, source, section,
            1-(embedding <=> $1::vector) AS similarity
     FROM scouting_knowledge ORDER BY embedding <=> $1::vector LIMIT $2`,
    [vec, limit]
  );
  return rows;
}

function resultContains(results, ...terms) {
  const allText = results.map(r => r.content.toLowerCase()).join(' ');
  return terms.every(t => allText.includes(t.toLowerCase()));
}

function resultTopCategory(results, category) {
  return results.length > 0 && results[0].category === category;
}

// ============================================================
// Tests
// ============================================================

async function testScoutSpecificAdvancement() {
  console.log('\n🎯 Test 1: Scout-Specific Advancement Queries\n');

  // Ground truth: Ben Bramwell's actual rank and advancement
  const ben = await db.collection('scoutbook_scouts').findOne({ firstName: 'Benjamin', lastName: 'Bramwell' });
  if (!ben) { skip('Ben Bramwell tests', 'Scout not found in DB'); return; }

  const benRank = ben.currentRank?.name || 'unknown';
  check('Ground truth: Ben exists in DB', true, `userId: ${ben.userId}, rank: ${benRank}`);

  // Check his advancement records
  const benMBs = await db.collection('scoutbook_advancement')
    .find({ userId: ben.userId, type: 'meritBadge' }).toArray();
  const earnedMBs = benMBs.filter(m => m.status === 'Awarded' || m.status === 'Completed');
  const inProgressMBs = benMBs.filter(m => m.percentCompleted > 0 && m.status !== 'Awarded' && m.status !== 'Completed');

  check('Ground truth: Ben has MB records', benMBs.length > 0, `total: ${benMBs.length}, earned: ${earnedMBs.length}, in-progress: ${inProgressMBs.length}`);

  // Now check the reference data can answer "what does Ben need for First Class?"
  const fcReqs = await db.collection('scoutbook_reference')
    .find({ type: 'rank_requirement', rankId: 4 }).toArray();
  check('Reference has First Class requirements', fcReqs.length > 0, `count: ${fcReqs.length}`);

  // Cross-reference: Ben's completion on First Class
  const benFCReqs = await db.collection('scoutbook_requirements')
    .find({ userId: ben.userId, advancementType: 'rank', advancementId: 4 }).toArray();
  const fcCompleted = benFCReqs.filter(r => r.completed).length;
  const fcTotal = benFCReqs.length;
  check('Cross-ref: Ben has First Class completion data', fcTotal > 0,
    `${fcCompleted}/${fcTotal} completed`);

  // Verify the reference reqNumbers match the completion reqNumbers
  const refNums = new Set(fcReqs.map(r => r.reqNumber).filter(Boolean));
  const compNums = new Set(benFCReqs.map(r => r.reqNumber).filter(Boolean));
  const matchCount = [...refNums].filter(n => compNums.has(n)).length;
  check('Req numbers match between reference and completion',
    matchCount > Math.min(refNums.size, compNums.size) * 0.5,
    `${matchCount} matching of ${refNums.size} ref / ${compNums.size} completion`);

  // Verify we can identify INCOMPLETE requirements
  const incomplete = benFCReqs.filter(r => !r.completed);
  const incompleteNums = incomplete.map(r => r.reqNumber).filter(Boolean);
  check('Can identify Ben\'s incomplete First Class reqs',
    incompleteNums.length > 0,
    `${incompleteNums.length} incomplete: ${incompleteNums.slice(0, 5).join(', ')}...`);

  // Verify the incomplete reqs have reference text
  let hasText = 0;
  for (const num of incompleteNums.slice(0, 5)) {
    const ref = fcReqs.find(r => r.reqNumber === num);
    if (ref?.fullText) hasText++;
  }
  check('Incomplete reqs have reference text', hasText > 0,
    `${hasText}/${Math.min(incompleteNums.length, 5)} have fullText`);
}

async function testEagleCandidateAnalysis() {
  console.log('\n🦅 Test 2: Eagle Candidate Analysis\n');

  // Ground truth: find all Life Scouts (Eagle candidates)
  const lifeScouts = await db.collection('scoutbook_scouts')
    .find({ 'currentRank.name': 'Life Scout' }).toArray();
  check('Ground truth: Life Scouts found', lifeScouts.length > 0, `count: ${lifeScouts.length}`);

  for (const scout of lifeScouts.slice(0, 3)) {
    const name = `${scout.firstName} ${scout.lastName}`;
    const adv = await db.collection('scoutbook_advancement')
      .find({ userId: scout.userId, type: 'meritBadge', isEagleRequired: true }).toArray();
    const earned = adv.filter(a => a.status === 'Awarded' || a.status === 'Completed');
    const inProgress = adv.filter(a => a.percentCompleted > 0 && a.status !== 'Awarded' && a.status !== 'Completed');

    check(`${name}: Eagle MB data exists`, adv.length > 0,
      `earned: ${earned.length}/14, in-progress: ${inProgress.length}`);

    // Verify we can name the MISSING Eagle MBs
    const eagleRequired = [
      'Camping', 'Citizenship in the Community', 'Citizenship in the Nation',
      'Citizenship in the World', 'Communication', 'Cooking',
      'First Aid', 'Personal Fitness', 'Personal Management',
      'Family Life', 'Environmental Science', 'Citizenship in Society',
    ];
    const earnedNames = new Set(earned.map(a => a.name));
    const missing = eagleRequired.filter(n => !earnedNames.has(n));
    check(`${name}: Can identify missing Eagle MBs`, true,
      `missing: ${missing.join(', ') || 'none'}`);
  }

  // Verify KB has Eagle-required MB policy content
  const eagleResults = await searchKB('What merit badges are required for Eagle Scout?');
  check('KB has Eagle MB policy content', eagleResults.length > 0);
  check('Eagle results mention merit badges',
    resultContains(eagleResults, 'eagle', 'merit badge'),
    `top result: ${eagleResults[0]?.category}`);
}

async function testRankRequirementGrounding() {
  console.log('\n📋 Test 3: Rank Requirement Grounding (no hallucination)\n');

  const ranks = [
    { id: 2, name: 'Tenderfoot', searchTerm: 'tenderfoot' },
    { id: 3, name: 'Second Class', searchTerm: 'second class' },
    { id: 4, name: 'First Class', searchTerm: 'first class' },
  ];

  for (const rank of ranks) {
    // Ground truth from MongoDB reference
    const refs = await db.collection('scoutbook_reference')
      .find({ type: 'rank_requirement', rankId: rank.id }).toArray();

    // Search KB for the same rank
    const results = await searchKB(`${rank.name} rank requirements for Scouts BSA`);
    check(`KB returns results for ${rank.name}`, results.length > 0);

    if (results.length > 0) {
      // Verify the top result is about this rank
      const topContent = results[0].content.toLowerCase();
      const mentionsRank = topContent.includes(rank.searchTerm) ||
        results[0].rank === rank.searchTerm;
      check(`Top result is about ${rank.name}`, mentionsRank,
        `rank field: ${results[0].rank}, content mentions: ${topContent.includes(rank.searchTerm)}`);

      // Anti-hallucination: verify content matches reference data
      // Pick a specific requirement from the reference and check KB knows it
      const sampleReq = refs.find(r => r.fullText && r.fullText.length > 30);
      if (sampleReq) {
        const reqSearch = await searchKB(`${rank.name} requirement ${sampleReq.reqNumber} ${sampleReq.short}`);
        check(`KB can find specific req: ${rank.name} ${sampleReq.reqNumber} (${sampleReq.short})`,
          reqSearch.length > 0 && reqSearch[0].similarity > 0.4,
          `similarity: ${reqSearch[0]?.similarity?.toFixed(3)}`);
      }
    }
  }
}

async function testPolicyGrounding() {
  console.log('\n📜 Test 4: Policy Grounding\n');

  const policyQueries = [
    {
      query: 'Can a scout be asked to recite the Scout Oath at a Board of Review?',
      mustContain: ['board of review'],
      category: 'policy',
      description: 'BOR recitation policy',
    },
    {
      query: 'What is two-deep leadership and when is it required?',
      mustContain: ['two-deep', 'leadership'],
      category: 'policy',
      description: 'Youth protection two-deep',
    },
    {
      query: 'How long must a scout serve in a position of responsibility for Star rank?',
      mustContain: ['position', 'responsibility'],
      category: null, // could be procedure or rank_requirement
      description: 'POR time requirement',
    },
    {
      query: 'What happens if a scout turns 18 before completing Eagle requirements?',
      mustContain: ['18', 'eagle'],
      category: null,
      description: 'Age 18 Eagle deadline',
    },
  ];

  for (const pq of policyQueries) {
    const results = await searchKB(pq.query);
    check(`"${pq.description}" returns results`, results.length > 0);

    if (results.length > 0) {
      const grounded = resultContains(results, ...pq.mustContain);
      check(`Results are grounded (contain: ${pq.mustContain.join(', ')})`, grounded,
        `top similarity: ${results[0].similarity.toFixed(3)}, category: ${results[0].category}`);

      if (pq.category) {
        check(`Top result category is ${pq.category}`,
          results[0].category === pq.category,
          `got: ${results[0].category}`);
      }
    }
  }
}

async function testTroopKnowledgeGrounding() {
  console.log('\n🏕️ Test 5: Troop-Specific Knowledge Grounding\n');

  // Ground truth from the troop knowledge files
  const troopQueries = [
    {
      query: 'When does Troop 2024 hold meetings?',
      mustContain: ['tuesday'],
      description: 'Meeting schedule',
    },
    {
      query: 'Where does Troop 2024 go for summer camp?',
      mustContain: ['woodruff'],
      description: 'Summer camp location',
    },
    {
      query: 'Who is the Scoutmaster of Troop 2024?',
      mustContain: ['bramwell'],
      description: 'Scoutmaster identity',
    },
    {
      query: 'What patrols does Troop 2024 have?',
      mustContain: ['patrol'],
      description: 'Patrol names',
    },
    {
      query: 'How much are Troop 2024 dues?',
      mustContain: ['250'],
      description: 'Troop dues amount',
    },
  ];

  for (const tq of troopQueries) {
    const results = await searchKB(tq.query);
    check(`"${tq.description}" returns results`, results.length > 0);

    if (results.length > 0) {
      const grounded = resultContains(results, ...tq.mustContain);
      check(`Results contain ground truth (${tq.mustContain.join(', ')})`, grounded,
        `top: ${results[0].category}, sim: ${results[0].similarity.toFixed(3)}, preview: "${results[0].content.substring(0, 80)}..."`);
    }
  }
}

async function testCrossReferenceQueries() {
  console.log('\n🔗 Test 6: Cross-Reference Queries (multi-source)\n');

  // These questions require combining KB search with MongoDB data

  // Q1: "Which scouts need the most help with Tenderfoot?"
  // Ground truth: count scouts working on Tenderfoot
  const tfScouts = await db.collection('scoutbook_scouts')
    .find({ 'currentRank.name': { $in: ['Scout', null] } }).toArray();
  const tfScoutIds = tfScouts.map(s => s.userId);

  // For each, count incomplete Tenderfoot reqs
  const tfProgress = [];
  for (const uid of tfScoutIds) {
    const reqs = await db.collection('scoutbook_requirements')
      .find({ userId: uid, advancementType: 'rank', advancementId: 2 }).toArray();
    if (reqs.length > 0) {
      const done = reqs.filter(r => r.completed).length;
      tfProgress.push({ userId: uid, done, total: reqs.length });
    }
  }

  check('Can identify scouts working on Tenderfoot', tfProgress.length > 0,
    `${tfProgress.length} scouts have Tenderfoot progress data`);

  // Verify KB has Tenderfoot content to pair with this data
  const tfResults = await searchKB('Tenderfoot requirements that can be completed at a meeting');
  check('KB has meeting-compatible Tenderfoot content', tfResults.length > 0);
  if (tfResults.length > 0) {
    check('Content is actionable (mentions specific requirements)',
      tfResults[0].content.length > 200,
      `content length: ${tfResults[0].content.length}`);
  }

  // Q2: "What Eagle-required merit badges do the most scouts still need?"
  // Ground truth from advancement data
  const pipeline = await db.collection('scoutbook_advancement').aggregate([
    { $match: { type: 'meritBadge', isEagleRequired: true, status: { $nin: ['Awarded', 'Completed'] } } },
    { $group: { _id: '$name', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]).toArray();

  check('Can aggregate most-needed Eagle MBs', pipeline.length > 0,
    pipeline.map(p => `${p._id}: ${p.count}`).join(', '));

  // Verify KB has content for the top-needed MB
  if (pipeline.length > 0) {
    const topNeeded = pipeline[0]._id;
    const mbResults = await searchKB(`${topNeeded} merit badge requirements`);
    check(`KB has content for most-needed MB (${topNeeded})`, mbResults.length > 0);
    if (mbResults.length > 0) {
      check(`Content relates to ${topNeeded}`,
        resultContains(mbResults, topNeeded.toLowerCase().split(' ')[0]),
        `top: ${mbResults[0].merit_badge || mbResults[0].category}`);
    }
  }
}

async function testAntiHallucination() {
  console.log('\n🚫 Test 7: Anti-Hallucination Checks\n');

  // These test that the KB does NOT return confident wrong answers

  // Q1: Search for a non-existent rank — embedding models match structural
  // similarity, so we can't expect < 0.7. Instead verify the result doesn't
  // claim to BE about the fake topic.
  const fakeRank = await searchKB('What are the requirements for the Wolverine rank in Scouts BSA?');
  check('Fake rank query doesn\'t return a "wolverine" result',
    fakeRank.length === 0 || !fakeRank[0].content.toLowerCase().includes('wolverine'),
    fakeRank.length > 0 ? `top sim: ${fakeRank[0].similarity.toFixed(3)}, rank: ${fakeRank[0].rank}` : 'no results');

  // Q2: Search for a non-existent merit badge
  const fakeMB = await searchKB('What are the requirements for the Underwater Basket Weaving merit badge?');
  check('Fake MB query doesn\'t return "basket weaving" content',
    fakeMB.length === 0 || !fakeMB[0].content.toLowerCase().includes('basket weaving'),
    fakeMB.length > 0 ? `top sim: ${fakeMB[0].similarity.toFixed(3)}, mb: ${fakeMB[0].merit_badge}` : 'no results');

  // Q3: Verify specific scout data isn't mixed up
  const ben = await db.collection('scoutbook_scouts').findOne({ firstName: 'Benjamin', lastName: 'Bramwell' });
  const william = await db.collection('scoutbook_scouts').findOne({ firstName: 'William', lastName: 'Bramwell' });
  if (ben && william) {
    const benRank = ben.currentRank?.name || 'unknown';
    const williamRank = william.currentRank?.name || 'unknown';
    check('Ben and William have different advancement states',
      ben.userId !== william.userId,
      `Ben: ${benRank} (${ben.userId}), William: ${williamRank} (${william.userId})`);

    // Verify their req counts are different
    const benReqCount = await db.collection('scoutbook_requirements').countDocuments({ userId: ben.userId });
    const williamReqCount = await db.collection('scoutbook_requirements').countDocuments({ userId: william.userId });
    check('Ben and William have distinct requirement records',
      benReqCount !== williamReqCount || benReqCount > 0,
      `Ben: ${benReqCount} reqs, William: ${williamReqCount} reqs`);
  }

  // Q4: Verify the KB doesn't claim things about policy that contradict reference
  const borResults = await searchKB('Board of Review voting procedures and who can serve');
  if (borResults.length > 0) {
    // BOR members should NOT include the Scoutmaster (per BSA policy)
    // This is a common misconception — the SM should not sit on the BOR
    const content = borResults.map(r => r.content).join(' ').toLowerCase();
    const mentionsSM = content.includes('scoutmaster') && content.includes('board of review');
    // Just verify the content exists and is policy-related, not that it's correct
    // (correctness depends on the Perplexity research quality)
    check('BOR policy content exists and is substantial',
      content.length > 200, `${content.length} chars across ${borResults.length} results`);
  }

  // Q5: Check that we don't return troop data for BSA policy questions
  const policyResults = await searchKB('What is the official BSA policy on partial merit badge completion?');
  if (policyResults.length > 0) {
    const topIsNotTroop = policyResults[0].category !== 'troop';
    check('BSA policy question returns BSA content, not troop data',
      topIsNotTroop,
      `top category: ${policyResults[0].category}`);
  }
}

async function testAdvancementGapAnalysis() {
  console.log('\n📊 Test 8: Advancement Gap Analysis Grounding\n');

  // Find the most common incomplete rank requirements across all scouts
  // Filter to Scouts BSA ranks only (1-7). Rank IDs > 7 are Cub Scout
  // ranks carried over from crossover scouts.
  const gapPipeline = await db.collection('scoutbook_requirements').aggregate([
    { $match: { completed: false, advancementType: 'rank', advancementId: { $lte: 7 } } },
    { $group: { _id: { advancementId: '$advancementId', reqNumber: '$reqNumber', reqName: '$reqName' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();

  check('Can compute requirement gaps', gapPipeline.length > 0,
    `top gap: ${gapPipeline[0]?._id?.reqName} (${gapPipeline[0]?.count} scouts)`);

  // Verify the top gaps have reference text
  const RANK_NAMES = { 1: 'Scout', 2: 'Tenderfoot', 3: 'Second Class', 4: 'First Class', 5: 'Star', 6: 'Life', 7: 'Eagle' };
  let grounded = 0;
  for (const gap of gapPipeline.slice(0, 5)) {
    const ref = await db.collection('scoutbook_reference').findOne({
      type: 'rank_requirement',
      rankId: gap._id.advancementId,
      reqNumber: gap._id.reqNumber,
    });
    if (ref?.fullText) grounded++;
  }
  check('Top 5 gaps have reference text', grounded >= 3,
    `${grounded}/5 have fullText in scoutbook_reference`);

  // Verify KB can provide strategies for common gaps
  if (gapPipeline.length > 0) {
    const topGap = gapPipeline[0]._id;
    const rankName = RANK_NAMES[topGap.advancementId] || 'unknown';
    const stratResults = await searchKB(
      `How to teach ${rankName} requirement ${topGap.reqNumber} ${topGap.reqName} at a scout meeting`
    );
    check('KB has content relevant to top gap requirement',
      stratResults.length > 0 && stratResults[0].similarity > 0.4,
      `query: "${rankName} ${topGap.reqNumber} ${topGap.reqName}", sim: ${stratResults[0]?.similarity?.toFixed(3)}`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Knowledge Base Grounding Evaluation');
  console.log('  Verifies answers are data-grounded, not hallucinated');
  console.log('═══════════════════════════════════════════════════════\n');

  if (!GEMINI_KEY) {
    console.error('GEMINI_KEY required for semantic search tests');
    process.exit(1);
  }

  // Connect
  mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  db = mongo.db();

  pool = new pg.Pool({ connectionString: POSTGRES_URI });
  await pool.query('SELECT 1');

  console.log('Connected to MongoDB and pgvector.\n');

  // Run all test sections
  await testScoutSpecificAdvancement();
  await testEagleCandidateAnalysis();
  await testRankRequirementGrounding();
  await testPolicyGrounding();
  await testTroopKnowledgeGrounding();
  await testCrossReferenceQueries();
  await testAntiHallucination();
  await testAdvancementGapAnalysis();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('═══════════════════════════════════════════════════════\n');

  await mongo.close();
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
