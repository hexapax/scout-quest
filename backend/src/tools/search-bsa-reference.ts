import { graphQuery, isFalkorConnected } from "../falkordb.js";
import { getKnowledgeBlock } from "../knowledge.js";

/** Full-text search against the knowledge graph's Requirement nodes.
 * Falls back to scanning the in-memory knowledge document if FalkorDB unavailable. */
export async function searchBsaReference(
  query: string,
  category?: string
): Promise<string> {
  if (!isFalkorConnected()) {
    return fallbackKnowledgeScan(query);
  }

  try {
    // Use FalkorDB full-text index on Requirement nodes
    let cypher =
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

    if (results.length === 0) {
      // Fall back to knowledge document scan
      return fallbackKnowledgeScan(query);
    }

    const lines = [`BSA REFERENCE SEARCH: "${query}"\n`];
    for (const r of results) {
      lines.push(`${r.advancementName} — Req ${r.reqNumber}: ${r.reqName}`);
    }
    return lines.join("\n");
  } catch (err) {
    console.error("search_bsa_reference error:", err);
    return fallbackKnowledgeScan(query);
  }
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
