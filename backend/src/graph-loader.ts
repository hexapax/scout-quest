/**
 * graph-loader.ts — Load scoutbook data from MongoDB into FalkorDB.
 * Run once after MongoDB has been populated with Scoutbook data.
 *
 * Usage: node dist/graph-loader.js
 *
 * Idempotent: clears the existing graph before loading.
 */

import { connectDb, getScoutQuestDb } from "./db.js";
import { connectFalkorDB, graphWrite, graphDelete } from "./falkordb.js";

// ---------------------------------------------------------------------------
// Types matching MongoDB scoutbook collections
// ---------------------------------------------------------------------------

interface ScoutDoc {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  patrol?: { name: string };
  currentRank?: { name: string; dateEarned?: string };
  activitySummary?: { campingNights: number; hikingMiles: number; serviceHours: number };
}

interface AdvancementDoc {
  userId: string;
  type: "rank" | "meritBadge" | "award";
  advancementId: number;
  name: string;
  level?: number;
  versionId?: number;
  status: string;
  percentCompleted: number;
  dateStarted?: string;
  dateCompleted?: string;
  dateAwarded?: string;
}

interface RequirementDoc {
  userId: string;
  advancementType: "rank" | "meritBadge";
  advancementId: number;
  reqId: number;
  reqNumber: string;
  reqName: string;
  parentReqId: number | null;
  completed: boolean;
  started: boolean;
  dateCompleted?: string;
  leaderApprovedDate?: string;
}

// ---------------------------------------------------------------------------
// Batch write helper
// ---------------------------------------------------------------------------

async function batchWrite(queries: string[], label: string): Promise<void> {
  let done = 0;
  for (const q of queries) {
    await graphWrite(q);
    done++;
    if (done % 100 === 0) {
      process.stdout.write(`  ${label}: ${done}/${queries.length}\r`);
    }
  }
  console.log(`  ${label}: ${queries.length} done          `);
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

async function loadGraph(): Promise<void> {
  console.log("=== FalkorDB Graph Loader ===\n");

  await connectDb();
  await connectFalkorDB();

  const db = getScoutQuestDb();

  // Clear existing graph
  console.log("Clearing existing graph...");
  await graphDelete();
  console.log("Graph cleared.\n");

  // ── 1. Load scouts ────────────────────────────────────────────────────────
  console.log("Loading scouts...");
  const scouts = await db.collection<ScoutDoc>("scoutbook_scouts").find().toArray();

  const scoutQueries = scouts.map((s) => {
    const name = `${s.firstName} ${s.lastName}`.replace(/'/g, "\\'");
    const email = (s.email || "").replace(/'/g, "\\'");
    const patrol = s.patrol?.name?.replace(/'/g, "\\'") || "";
    return (
      `CREATE (:Scout {userId: '${s.userId}', name: '${name}', ` +
      `email: '${email}', patrol: '${patrol}'})`
    );
  });

  await batchWrite(scoutQueries, "Scout nodes");

  // ── 2. Load canonical Advancement nodes (deduplicated by advancementId) ──
  console.log("Loading advancement nodes...");
  const advancements = await db.collection<AdvancementDoc>("scoutbook_advancement").find().toArray();

  // Deduplicate by advancementId
  const advMap = new Map<number, AdvancementDoc>();
  for (const a of advancements) {
    if (!advMap.has(a.advancementId)) advMap.set(a.advancementId, a);
  }

  // Rank level lookup
  const RANK_LEVELS: Record<string, number> = {
    Scout: 1, Tenderfoot: 2, "Second Class": 3, "First Class": 4,
    Star: 5, Life: 6, Eagle: 7,
  };

  const advNodeQueries = Array.from(advMap.values()).map((a) => {
    const name = a.name.replace(/'/g, "\\'");
    const level = RANK_LEVELS[a.name] ?? 0;
    return (
      `CREATE (:Advancement {advancementId: ${a.advancementId}, ` +
      `name: '${name}', type: '${a.type}', level: ${level}, ` +
      `versionId: ${a.versionId ?? 0}})`
    );
  });

  await batchWrite(advNodeQueries, "Advancement nodes");

  // ── 3. Scout ↔ Advancement edges ──────────────────────────────────────────
  console.log("Creating scout-advancement edges...");
  const edgeQueries = advancements.map((a) => {
    const status = a.status.replace(/'/g, "\\'");
    const dateStarted = a.dateStarted ? `'${a.dateStarted}'` : "null";
    const dateCompleted = a.dateCompleted ? `'${a.dateCompleted}'` : "null";
    return (
      `MATCH (s:Scout {userId: '${a.userId}'}), ` +
      `(adv:Advancement {advancementId: ${a.advancementId}}) ` +
      `CREATE (s)-[:HAS_ADVANCEMENT {status: '${status}', ` +
      `percentCompleted: ${a.percentCompleted}, ` +
      `dateStarted: ${dateStarted}, dateCompleted: ${dateCompleted}}]->(adv)`
    );
  });

  await batchWrite(edgeQueries, "Scout-Advancement edges");

  // ── 4. Requirement nodes (deduplicated by reqId + advancementId) ──────────
  console.log("Loading requirement nodes...");
  const requirements = await db.collection<RequirementDoc>("scoutbook_requirements").find().toArray();

  // Deduplicate canonical requirements
  const reqMap = new Map<string, RequirementDoc>();
  for (const r of requirements) {
    const key = `${r.advancementId}:${r.reqId}`;
    if (!reqMap.has(key)) reqMap.set(key, r);
  }

  const reqNodeQueries = Array.from(reqMap.values()).map((r) => {
    const reqName = r.reqName.replace(/'/g, "\\'");
    const reqNumber = r.reqNumber.replace(/'/g, "\\'");
    const parentReqId = r.parentReqId ?? "null";
    return (
      `CREATE (:Requirement {reqId: ${r.reqId}, advancementId: ${r.advancementId}, ` +
      `advancementType: '${r.advancementType}', reqNumber: '${reqNumber}', ` +
      `reqName: '${reqName}', parentReqId: ${parentReqId}})`
    );
  });

  await batchWrite(reqNodeQueries, "Requirement nodes");

  // ── 5. Advancement → Requirement edges ───────────────────────────────────
  console.log("Creating advancement-requirement edges...");
  const advReqEdges = Array.from(reqMap.values()).map((r) => {
    return (
      `MATCH (adv:Advancement {advancementId: ${r.advancementId}}), ` +
      `(req:Requirement {reqId: ${r.reqId}, advancementId: ${r.advancementId}}) ` +
      `CREATE (adv)-[:HAS_REQUIREMENT]->(req)`
    );
  });

  await batchWrite(advReqEdges, "Advancement-Requirement edges");

  // ── 6. Scout COMPLETED_REQ / STARTED_REQ edges ───────────────────────────
  console.log("Creating scout-requirement completion edges...");
  const completedReqs = requirements.filter((r) => r.completed);
  const startedNotCompleted = requirements.filter((r) => r.started && !r.completed);

  const completedEdges = completedReqs.map((r) => {
    const dateCompleted = r.dateCompleted ? `'${r.dateCompleted}'` : "null";
    const leaderDate = r.leaderApprovedDate ? `'${r.leaderApprovedDate}'` : "null";
    return (
      `MATCH (s:Scout {userId: '${r.userId}'}), ` +
      `(req:Requirement {reqId: ${r.reqId}, advancementId: ${r.advancementId}}) ` +
      `CREATE (s)-[:COMPLETED_REQ {dateCompleted: ${dateCompleted}, leaderApprovedDate: ${leaderDate}}]->(req)`
    );
  });

  const startedEdges = startedNotCompleted.map((r) => {
    return (
      `MATCH (s:Scout {userId: '${r.userId}'}), ` +
      `(req:Requirement {reqId: ${r.reqId}, advancementId: ${r.advancementId}}) ` +
      `CREATE (s)-[:STARTED_REQ]->(req)`
    );
  });

  await batchWrite(completedEdges, "COMPLETED_REQ edges");
  await batchWrite(startedEdges, "STARTED_REQ edges");

  // ── 7. Full-text index on Requirement.reqName ─────────────────────────────
  console.log("\nCreating full-text index...");
  try {
    await graphWrite(
      "CALL db.idx.fulltext.createNodeIndex('Requirement', 'reqName', 'reqNumber')"
    );
    console.log("  Full-text index created on Requirement(reqName, reqNumber)");
  } catch (err) {
    console.warn("  Full-text index (may already exist):", err);
  }

  // ── 8. Summary ──────────────────────────────────────────────────────────
  console.log("\n=== Load Complete ===");
  console.log(`  Scouts: ${scouts.length}`);
  console.log(`  Advancement types: ${advMap.size}`);
  console.log(`  Requirement types: ${reqMap.size}`);
  console.log(`  Scout-advancement edges: ${advancements.length}`);
  console.log(`  Completed requirements: ${completedReqs.length}`);
  console.log(`  Started requirements: ${startedNotCompleted.length}`);
  process.exit(0);
}

loadGraph().catch((err) => {
  console.error("Graph load failed:", err);
  process.exit(1);
});
