import { graphQuery, isFalkorConnected } from "../falkordb.js";
import { getKnowledgeBlock } from "../knowledge.js";
import { embedQuery } from "../embeddings.js";

/** Hybrid search: vector similarity + full-text + knowledge scan fallback.
 * Priority: vector search (semantic) → full-text (keyword) → knowledge doc scan. */
export async function searchBsaReference(
  query: string,
  category?: string
): Promise<string> {
  if (!isFalkorConnected()) {
    return fallbackKnowledgeScan(query);
  }

  // Try vector search first (best for semantic/conceptual queries)
  try {
    const vectorResults = await vectorSearch(query, category);
    if (vectorResults) return vectorResults;
  } catch (err) {
    console.error("Vector search error (falling back to full-text):", err);
  }

  // Fall back to full-text search on Requirement nodes
  try {
    const cypher =
      "CALL db.idx.fulltext.queryNodes('Requirement', $query) " +
      "YIELD node RETURN node.reqNumber AS reqNumber, node.reqName AS reqName, " +
      "node.advancementType AS advancementType, node.advancementName AS advancementName " +
      "LIMIT 10";

    const results = await graphQuery<{
      reqNumber: string;
      reqName: string;
      advancementType: string;
      advancementName: string;
    }>(cypher, { query });

    if (results.length > 0) {
      const lines = [`BSA REFERENCE SEARCH (full-text): "${query}"\n`];
      for (const r of results) {
        lines.push(`${r.advancementName} — Req ${r.reqNumber}: ${r.reqName}`);
      }
      return lines.join("\n");
    }
  } catch (err) {
    console.error("Full-text search error:", err);
  }

  return fallbackKnowledgeScan(query);
}

/** Vector similarity search against ChunkVector nodes. */
async function vectorSearch(
  query: string,
  category?: string
): Promise<string | null> {
  // Embed the query
  const queryVec = await embedQuery(query);
  if (!queryVec) return null;

  // FalkorDB KNN vector search
  const vectorStr = `vecf32([${queryVec.join(",")}])`;
  const cypher =
    `CALL db.idx.vector.queryNodes('ChunkVector', 'embedding', 5, ${vectorStr}) ` +
    `YIELD node, score ` +
    `RETURN node.chunkId AS id, node.title AS title, node.source AS source, ` +
    `node.type AS type, node.text AS text, score ` +
    `ORDER BY score DESC LIMIT 5`;

  const results = await graphQuery<{
    id: string;
    title: string;
    source: string;
    type: string;
    text: string;
    score: number;
  }>(cypher);

  if (!results || results.length === 0) return null;

  // Filter by category if specified
  let filtered = results;
  if (category && category !== "any") {
    filtered = results.filter((r) => {
      if (category === "requirements") return r.type?.includes("requirement");
      if (category === "policy") return r.type?.includes("policy") || r.source?.includes("g2a") || r.source?.includes("g2ss");
      if (category === "merit_badges") return r.type?.includes("merit_badge");
      return true;
    });
    if (filtered.length === 0) filtered = results; // fall back to unfiltered
  }

  const lines = [`BSA REFERENCE SEARCH (semantic): "${query}"\n`];
  for (const r of filtered) {
    const score = typeof r.score === "number" ? ` (relevance: ${r.score.toFixed(3)})` : "";
    lines.push(`--- ${r.title || r.source}${score} ---`);
    // Truncate long chunks for the tool response
    const text = r.text?.length > 1500 ? r.text.substring(0, 1500) + "..." : (r.text ?? "");
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

/** Scan the in-memory knowledge document for relevant sections. */
function fallbackKnowledgeScan(query: string): string {
  try {
    const knowledge = getKnowledgeBlock();
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const lines = knowledge.text.split("\n");

    const relevant: { score: number; lines: string[] }[] = [];
    let window: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      window.push(line);
      if (window.length > 6) window.shift();

      const lineLower = line.toLowerCase();
      const score = terms.filter((t) => lineLower.includes(t)).length;

      if (score >= 2) {
        // Capture surrounding context
        const start = Math.max(0, i - 3);
        const end = Math.min(lines.length - 1, i + 3);
        relevant.push({
          score,
          lines: lines.slice(start, end + 1),
        });
      }
    }

    if (relevant.length === 0) {
      return `No specific matches found for "${query}" in the BSA reference material. Answer based on your embodied knowledge.`;
    }

    // Top 3 most relevant sections
    relevant.sort((a, b) => b.score - a.score);
    const top = relevant.slice(0, 3);

    const output = [`BSA REFERENCE SEARCH: "${query}"\n`];
    for (const section of top) {
      output.push(section.lines.join("\n"));
      output.push("---");
    }
    return output.join("\n");
  } catch {
    return `Search unavailable. Answer based on your embodied BSA knowledge.`;
  }
}
