/** Load Layer 3 enriched graph data into FalkorDB.
 * Adds: Badge nodes (with categories), VersionChange nodes,
 * EAGLE_REQUIRED_FOR edges, REQUIRES_RANK edges, BELONGS_TO edges.
 *
 * Usage: node dist/load-layer3.js <graph-extractions-dir>
 *
 * Does NOT clear existing graph — merges with existing Scout/Advancement/Requirement/ChunkVector nodes.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { connectFalkorDB, graphWrite, graphQuery } from "./falkordb.js";
import { connectDb } from "./db.js";

interface GraphNode {
  type: string;
  id: string;
  name: string;
  [key: string]: unknown;
}

interface GraphEdge {
  from: string;
  to: string;
  type: string;
  [key: string]: unknown;
}

function loadJsonl<T>(path: string): T[] {
  const data = readFileSync(path, "utf-8");
  return data.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function escCypher(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node dist/load-layer3.js <graph-extractions-dir>");
    process.exit(1);
  }

  await connectDb();
  await connectFalkorDB();

  // Load data files
  const nodes = loadJsonl<GraphNode>(join(dir, "nodes.jsonl"));
  const edges = loadJsonl<GraphEdge>(join(dir, "edges.jsonl"));
  const skills = loadJsonl<GraphNode>(join(dir, "skill-nodes.jsonl"));
  const topics = loadJsonl<GraphNode>(join(dir, "topic-nodes.jsonl"));

  console.log(`Loaded: ${nodes.length} nodes, ${edges.length} edges, ${skills.length} skills, ${topics.length} topics`);

  // --- Create Badge nodes (MERGE to avoid duplicates with existing Advancement nodes) ---
  let created = 0;
  const badges = nodes.filter((n) => n.type === "Badge");
  console.log(`\nCreating ${badges.length} Badge nodes...`);
  for (const badge of badges) {
    await graphWrite(
      `MERGE (b:Badge {badgeId: '${escCypher(badge.id)}'}) ` +
      `SET b.name = '${escCypher(badge.name)}', ` +
      `b.category = '${escCypher(String(badge.category ?? ""))}', ` +
      `b.eagleRequired = ${badge.eagle_required === true}, ` +
      `b.bsaNumber = '${escCypher(String(badge.bsa_number ?? ""))}'`
    );
    created++;
  }
  console.log(`  ${created} Badge nodes merged`);

  // --- Create Category nodes ---
  const categories = nodes.filter((n) => n.type === "Category");
  console.log(`Creating ${categories.length} Category nodes...`);
  for (const cat of categories) {
    await graphWrite(
      `MERGE (c:Category {categoryId: '${escCypher(cat.id)}'}) ` +
      `SET c.name = '${escCypher(cat.name)}'`
    );
  }

  // --- Create Rank nodes (MERGE with existing) ---
  const ranks = nodes.filter((n) => n.type === "Rank");
  console.log(`Creating ${ranks.length} Rank nodes...`);
  for (const rank of ranks) {
    await graphWrite(
      `MERGE (r:RankNode {rankId: '${escCypher(rank.id)}'}) ` +
      `SET r.name = '${escCypher(rank.name)}'`
    );
  }

  // --- Create VersionChange nodes ---
  const versionChanges = nodes.filter((n) => n.type === "VersionChange");
  console.log(`Creating ${versionChanges.length} VersionChange nodes...`);
  for (const vc of versionChanges) {
    const desc = escCypher(String(vc.description ?? ""));
    const fromVer = escCypher(String(vc.from_version ?? ""));
    const toVer = escCypher(String(vc.to_version ?? ""));
    await graphWrite(
      `CREATE (:VersionChange {changeId: '${escCypher(vc.id)}', ` +
      `name: '${escCypher(vc.name)}', ` +
      `description: '${desc}', ` +
      `fromVersion: '${fromVer}', ` +
      `toVersion: '${toVer}'})`
    );
  }

  // --- Create Skill and Topic nodes ---
  console.log(`Creating ${skills.length} Skill nodes...`);
  for (const s of skills) {
    await graphWrite(
      `MERGE (s:Skill {skillId: '${escCypher(s.id)}'}) SET s.name = '${escCypher(s.name)}'`
    );
  }

  console.log(`Creating ${topics.length} Topic nodes...`);
  for (const t of topics) {
    await graphWrite(
      `MERGE (t:Topic {topicId: '${escCypher(t.id)}'}) SET t.name = '${escCypher(t.name)}'`
    );
  }

  // --- Create edges ---
  console.log(`\nCreating ${edges.length} edges...`);
  let edgeCount = 0;
  const edgeErrors: string[] = [];

  for (const edge of edges) {
    try {
      const fromLabel = getLabel(edge.from);
      const fromIdProp = getIdProp(edge.from);
      const toLabel = getLabel(edge.to);
      const toIdProp = getIdProp(edge.to);

      let extraProps = "";
      if (edge.type === "HAS_VERSION_CHANGES") {
        extraProps = ` {fromVersion: '${escCypher(String(edge.from_version ?? ""))}', toVersion: '${escCypher(String(edge.to_version ?? ""))}'}`;
      }

      await graphWrite(
        `MATCH (a:${fromLabel} {${fromIdProp}: '${escCypher(edge.from)}'}) ` +
        `MATCH (b:${toLabel} {${toIdProp}: '${escCypher(edge.to)}'}) ` +
        `MERGE (a)-[:${edge.type}${extraProps}]->(b)`
      );
      edgeCount++;
    } catch (err) {
      edgeErrors.push(`${edge.from} -[${edge.type}]-> ${edge.to}: ${String(err).substring(0, 80)}`);
    }
    if (edgeCount % 100 === 0 && edgeCount > 0) {
      console.log(`  ${edgeCount}/${edges.length} edges created`);
    }
  }
  console.log(`  ${edgeCount}/${edges.length} edges created (${edgeErrors.length} errors)`);
  if (edgeErrors.length > 0) {
    console.log(`  First 5 errors:`);
    for (const e of edgeErrors.slice(0, 5)) console.log(`    ${e}`);
  }

  console.log(`\n=== Layer 3 Load Complete ===`);
  console.log(`  Badge nodes: ${badges.length}`);
  console.log(`  Category nodes: ${categories.length}`);
  console.log(`  Rank nodes: ${ranks.length}`);
  console.log(`  VersionChange nodes: ${versionChanges.length}`);
  console.log(`  Skill nodes: ${skills.length}`);
  console.log(`  Topic nodes: ${topics.length}`);
  console.log(`  Edges: ${edgeCount} (${edgeErrors.length} errors)`);
  process.exit(0);
}

/** Map node ID prefix to FalkorDB label */
function getLabel(id: string): string {
  if (id.startsWith("badge:")) return "Badge";
  if (id.startsWith("category:")) return "Category";
  if (id.startsWith("rank:")) return "RankNode";
  if (id.startsWith("req:")) return "Requirement";
  if (id.startsWith("vc:")) return "VersionChange";
  if (id.startsWith("skill:")) return "Skill";
  if (id.startsWith("topic:")) return "Topic";
  return "Unknown";
}

/** Map node ID prefix to the ID property name in FalkorDB */
function getIdProp(id: string): string {
  if (id.startsWith("badge:")) return "badgeId";
  if (id.startsWith("category:")) return "categoryId";
  if (id.startsWith("rank:")) return "rankId";
  if (id.startsWith("req:")) return "reqId";
  if (id.startsWith("vc:")) return "changeId";
  if (id.startsWith("skill:")) return "skillId";
  if (id.startsWith("topic:")) return "topicId";
  return "id";
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
