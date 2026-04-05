/**
 * graph-loader.ts — Load scoutbook data from MongoDB into FalkorDB.
 * Run once after MongoDB has been populated with Scoutbook data.
 *
 * Usage: node dist/graph-loader.js
 *
 * Idempotent: clears the existing graph before loading.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { connectDb, getScoutQuestDb } from "./db.js";
import { connectFalkorDB, graphWrite, graphDelete } from "./falkordb.js";
import { embedDocuments, embeddingDimension } from "./embeddings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  activitySummary?: { campingDays: number; campingNights: number; hikingMiles: number; serviceHours: number };
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
// Helpers
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding in a Cypher single-quoted literal. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "");
}

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
    const camping = s.activitySummary?.campingNights ?? 0;
    const hiking = s.activitySummary?.hikingMiles ?? 0;
    const service = s.activitySummary?.serviceHours ?? 0;
    return (
      `CREATE (:Scout {userId: '${s.userId}', name: '${name}', ` +
      `email: '${email}', patrol: '${patrol}', ` +
      `campingNights: ${camping}, hikingMiles: ${hiking}, serviceHours: ${service}})`
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

  // Rank level lookup — handles both "Star" and "Star Scout" variants
  const RANK_LEVELS: Record<string, number> = {
    Scout: 1, "Scout Rank": 1,
    Tenderfoot: 2,
    "Second Class": 3,
    "First Class": 4,
    Star: 5, "Star Scout": 5,
    Life: 6, "Life Scout": 6,
    Eagle: 7, "Eagle Scout": 7,
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

  // ── 7. Badge / Category / RankNode metadata ──────────────────────────────
  console.log("Loading Badge, Category, and RankNode metadata...");

  // Eagle-required merit badges (official BSA list)
  const EAGLE_REQUIRED: Set<string> = new Set([
    "First Aid", "Citizenship in the Community", "Citizenship in the Nation",
    "Citizenship in the World", "Citizenship in Society", "Communication",
    "Cooking", "Personal Fitness", "Personal Management", "Emergency Preparedness",
    "Lifesaving", "Swimming", "Hiking", "Cycling", "Camping",
    "Environmental Science", "Sustainability", "Family Life",
  ]);

  // Merit badge categories (approximate grouping)
  const MB_CATEGORIES: Record<string, string[]> = {
    "Citizenship": ["Citizenship in the Community", "Citizenship in the Nation", "Citizenship in the World", "Citizenship in Society", "Communication", "Law", "Scouting Heritage", "Crime Prevention"],
    "Outdoor Skills": ["Camping", "Hiking", "Wilderness Survival", "Orienteering", "Geocaching", "Nature", "Forestry", "Soil and Water Conservation", "Weather"],
    "Aquatics": ["Swimming", "Lifesaving", "Canoeing", "Kayaking", "Rowing", "Small-Boat Sailing", "Water Sports", "Scuba Diving", "Fishing", "Fly Fishing"],
    "First Aid & Safety": ["First Aid", "Emergency Preparedness", "Safety", "Traffic Safety"],
    "Life Skills": ["Personal Management", "Personal Fitness", "Family Life", "Cooking"],
    "Science & Technology": ["Chemistry", "Astronomy", "Geology", "Oceanography", "Animal Science", "Mammal Study", "Environmental Science", "Sustainability", "Robotics", "Digital Technology", "Engineering", "Game Design", "Animation", "Signs, Signals, and Codes"],
    "Sports & Fitness": ["Sports", "Golf", "Archery", "Rifle Shooting", "Shotgun Shooting", "Climbing", "Cycling", "Snow Sports", "Horsemanship"],
    "Arts & Hobbies": ["Art", "Photography", "Wood Carving", "Leatherwork", "Basketry", "Chess", "Coin Collecting", "Fingerprinting", "Genealogy", "Archaeology", "American Cultures", "American Business"],
    "Trades": ["Automotive Maintenance", "Aviation", "Welding", "Plumbing", "Pulp and Paper", "Entrepreneurship", "Motorboating"],
    "Nature": ["Disabilities Awareness"],
  };

  // Invert category map: badge name -> category
  const badgeToCategory = new Map<string, string>();
  for (const [cat, badges] of Object.entries(MB_CATEGORIES)) {
    for (const b of badges) badgeToCategory.set(b, cat);
  }

  // Create Category nodes
  const categories = Object.keys(MB_CATEGORIES);
  const catQueries = categories.map((c) => {
    const name = c.replace(/'/g, "\\'");
    return `CREATE (:Category {name: '${name}'})`;
  });
  await batchWrite(catQueries, "Category nodes");

  // Create Badge nodes from merit badge advancements
  const meritBadges = Array.from(advMap.values()).filter((a) => a.type === "meritBadge");
  const badgeQueries = meritBadges.map((a) => {
    const name = a.name.replace(/'/g, "\\'");
    const eagle = EAGLE_REQUIRED.has(a.name);
    const cat = badgeToCategory.get(a.name) ?? "Uncategorized";
    return (
      `CREATE (:Badge {badgeId: ${a.advancementId}, name: '${name}', ` +
      `eagleRequired: ${eagle}, category: '${cat.replace(/'/g, "\\'")}', ` +
      `versionId: ${a.versionId ?? 0}})`
    );
  });
  await batchWrite(badgeQueries, "Badge nodes");

  // Create Badge -> Category edges
  const badgeCatEdges = meritBadges
    .filter((a) => badgeToCategory.has(a.name))
    .map((a) => {
      const name = a.name.replace(/'/g, "\\'");
      const cat = badgeToCategory.get(a.name)!.replace(/'/g, "\\'");
      return (
        `MATCH (b:Badge {badgeId: ${a.advancementId}}), (c:Category {name: '${cat}'}) ` +
        `CREATE (b)-[:BELONGS_TO]->(c)`
      );
    });
  await batchWrite(badgeCatEdges, "Badge-Category edges");

  // Create RankNode for Eagle Scout
  await graphWrite("CREATE (:RankNode {name: 'Eagle Scout', level: 7})");

  // Create Eagle-required edges
  const eagleEdges = meritBadges
    .filter((a) => EAGLE_REQUIRED.has(a.name))
    .map((a) => (
      `MATCH (b:Badge {badgeId: ${a.advancementId}}), (r:RankNode {name: 'Eagle Scout'}) ` +
      `CREATE (b)-[:EAGLE_REQUIRED_FOR]->(r)`
    ));
  await batchWrite(eagleEdges, "Eagle-required edges");

  // Eagle alternative pairs (Emergency Prep/Lifesaving, Env Sci/Sustainability, Hiking/Cycling/Swimming)
  const EAGLE_ALTERNATIVES: [string, string][] = [
    ["Emergency Preparedness", "Lifesaving"],
    ["Environmental Science", "Sustainability"],
    ["Swimming", "Hiking"],
    ["Swimming", "Cycling"],
    ["Hiking", "Cycling"],
  ];
  for (const [a, b] of EAGLE_ALTERNATIVES) {
    const aDoc = meritBadges.find((m) => m.name === a);
    const bDoc = meritBadges.find((m) => m.name === b);
    if (aDoc && bDoc) {
      await graphWrite(
        `MATCH (ba:Badge {badgeId: ${aDoc.advancementId}}), (bb:Badge {badgeId: ${bDoc.advancementId}}) ` +
        `CREATE (ba)-[:EAGLE_ALTERNATIVE_FOR]->(bb)`
      );
    }
  }
  console.log("  Eagle alternative edges created");

  console.log(`  Badge nodes: ${meritBadges.length}`);
  console.log(`  Category nodes: ${categories.length}`);
  console.log(`  Eagle-required: ${eagleEdges.length}`);

  // ── 8. Knowledge chunks for vector search ─────────────────────────────────
  console.log("\nLoading knowledge chunks for vector search...");
  let chunkCount = 0;
  try {
    const knowledgePath = join(__dirname, "../knowledge/interim-bsa-knowledge.md");
    const knowledgeText = readFileSync(knowledgePath, "utf-8");

    // Split by markdown headings (## or ###)
    const sections = knowledgeText.split(/\n(?=#{2,3}\s)/);
    const chunks: { title: string; text: string; source: string; type: string }[] = [];

    for (const section of sections) {
      if (section.trim().length < 50) continue; // skip tiny fragments

      // Extract title from first line
      const firstLine = section.split("\n")[0] ?? "";
      const title = firstLine.replace(/^#+\s*/, "").trim() || "Untitled";

      // Determine type from content
      let type = "general";
      const lower = section.toLowerCase();
      if (lower.includes("requirement") || /\d+[a-z]?\.\s/.test(section)) type = "requirement";
      else if (lower.includes("policy") || lower.includes("g2a") || lower.includes("guide to advancement")) type = "policy";
      else if (lower.includes("merit badge")) type = "merit_badge";
      else if (lower.includes("safety") || lower.includes("g2ss")) type = "safety";

      // Split large sections into ~1000 char chunks
      if (section.length > 1500) {
        const paragraphs = section.split(/\n\n+/);
        let buffer = "";
        let chunkIdx = 0;
        for (const p of paragraphs) {
          if (buffer.length + p.length > 1200 && buffer.length > 200) {
            chunks.push({ title: `${title} (${++chunkIdx})`, text: buffer.trim(), source: "interim-bsa-knowledge.md", type });
            buffer = p;
          } else {
            buffer += "\n\n" + p;
          }
        }
        if (buffer.trim().length > 50) {
          chunks.push({ title: `${title} (${++chunkIdx})`, text: buffer.trim(), source: "interim-bsa-knowledge.md", type });
        }
      } else {
        chunks.push({ title, text: section.trim(), source: "interim-bsa-knowledge.md", type });
      }
    }

    // Embeddings are cached in MongoDB (knowledge_embeddings collection) to avoid
    // re-embedding on every graph reload. Only new/changed chunks get embedded.
    const embeddingsColl = db.collection("knowledge_embeddings");
    const dim = embeddingDimension();

    // Load cached embeddings keyed by content hash
    const cachedDocs = await embeddingsColl.find().toArray();
    const cache = new Map<string, number[]>();
    for (const doc of cachedDocs) {
      cache.set(doc.contentHash as string, doc.embedding as number[]);
    }
    console.log(`  Embedding cache: ${cache.size} entries`);

    // Hash each chunk to check cache
    const { createHash } = await import("crypto");
    const hashText = (t: string) => createHash("sha256").update(t).digest("hex").substring(0, 16);

    const uncached: { idx: number; text: string; hash: string }[] = [];
    const chunkHashes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const h = hashText(chunks[i].text);
      chunkHashes.push(h);
      if (!cache.has(h)) {
        uncached.push({ idx: i, text: chunks[i].text.substring(0, 4000), hash: h });
      }
    }

    console.log(`  ${uncached.length} chunks need embedding (${chunks.length - uncached.length} cached)`);

    // Embed only uncached chunks
    if (uncached.length > 0 && dim > 0) {
      const newEmbeddings = await embedDocuments(uncached.map((u) => u.text)) ?? [];
      console.log(`  Embedded ${newEmbeddings.length} new chunks`);

      // Save to MongoDB cache
      const bulkOps = [];
      for (let i = 0; i < Math.min(uncached.length, newEmbeddings.length); i++) {
        cache.set(uncached[i].hash, newEmbeddings[i]);
        bulkOps.push({
          updateOne: {
            filter: { contentHash: uncached[i].hash },
            update: { $set: { contentHash: uncached[i].hash, embedding: newEmbeddings[i], updatedAt: new Date() } },
            upsert: true,
          },
        });
      }
      if (bulkOps.length > 0) {
        await embeddingsColl.bulkWrite(bulkOps);
        console.log(`  Saved ${bulkOps.length} embeddings to MongoDB cache`);
      }
    }

    // Create ChunkVector nodes (with embeddings where available)
    const chunkQueries: string[] = [];
    let embeddedCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const embedding = cache.get(chunkHashes[i]);

      if (embedding) {
        const vecStr = `vecf32([${embedding.join(",")}])`;
        chunkQueries.push(
          `CREATE (:ChunkVector {chunkId: 'chunk-${i}', title: '${esc(c.title)}', ` +
          `source: '${esc(c.source)}', type: '${c.type}', ` +
          `text: '${esc(c.text.substring(0, 2000))}', embedding: ${vecStr}})`
        );
        embeddedCount++;
      } else {
        chunkQueries.push(
          `CREATE (:ChunkVector {chunkId: 'chunk-${i}', title: '${esc(c.title)}', ` +
          `source: '${esc(c.source)}', type: '${c.type}', ` +
          `text: '${esc(c.text.substring(0, 2000))}'})`
        );
      }
    }
    await batchWrite(chunkQueries, "ChunkVector nodes");
    chunkCount = chunks.length;
    console.log(`  ${embeddedCount}/${chunks.length} chunks have embeddings`);

    // Create vector index if we have embeddings
    if (embeddedCount > 0 && dim > 0) {
      try {
        await graphWrite(
          `CALL db.idx.vector.createNodeIndex('ChunkVector', 'embedding', ${dim}, 'cosine')`
        );
        console.log(`  Vector index created (${dim} dimensions, cosine)`);
      } catch (err) {
        console.warn("  Vector index (may already exist):", err);
      }
    }
  } catch (err) {
    console.error("  Knowledge chunk loading failed:", err);
  }

  // ── 9. Full-text indexes ──────────────────────────────────────────────────
  console.log("\nCreating full-text indexes...");
  try {
    await graphWrite(
      "CALL db.idx.fulltext.createNodeIndex('Requirement', 'reqName', 'reqNumber')"
    );
    console.log("  Full-text index created on Requirement(reqName, reqNumber)");
  } catch (err) {
    console.warn("  Full-text index (may already exist):", err);
  }

  try {
    await graphWrite(
      "CALL db.idx.fulltext.createNodeIndex('ChunkVector', 'title', 'text')"
    );
    console.log("  Full-text index created on ChunkVector(title, text)");
  } catch (err) {
    console.warn("  ChunkVector full-text index (may already exist):", err);
  }

  try {
    await graphWrite(
      "CALL db.idx.fulltext.createNodeIndex('Badge', 'name', 'category')"
    );
    console.log("  Full-text index created on Badge(name, category)");
  } catch (err) {
    console.warn("  Badge full-text index (may already exist):", err);
  }

  // ── 10. Summary ─────────────────────────────────────────────────────────
  console.log("\n=== Load Complete ===");
  console.log(`  Scouts: ${scouts.length}`);
  console.log(`  Advancement types: ${advMap.size}`);
  console.log(`  Requirement types: ${reqMap.size}`);
  console.log(`  Scout-advancement edges: ${advancements.length}`);
  console.log(`  Completed requirements: ${completedReqs.length}`);
  console.log(`  Started requirements: ${startedNotCompleted.length}`);
  console.log(`  Badge nodes: ${meritBadges.length}`);
  console.log(`  Category nodes: ${categories.length}`);
  console.log(`  Knowledge chunks: ${chunkCount}`);
  process.exit(0);
}

loadGraph().catch((err) => {
  console.error("Graph load failed:", err);
  process.exit(1);
});
