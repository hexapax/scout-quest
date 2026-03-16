// Semantic search over the scouting knowledge base (pgvector)

import { getPgPool } from "./pgvector.js";
import { embedText } from "./embeddings.js";
import type { KnowledgeChunk, TroopCustomization, SearchResult } from "./types.js";

export async function searchKnowledge(
  query: string,
  options: { category?: string; version?: string; limit?: number } = {},
): Promise<SearchResult> {
  const apiKey = process.env.GEMINI_KEY || process.env.GOOGLE_KEY;
  if (!apiKey) throw new Error("GEMINI_KEY or GOOGLE_KEY env var required for embedding queries");

  const embedding = await embedText(query, apiKey);
  const vec = `[${embedding.join(",")}]`;
  const limit = options.limit || 5;
  const pool = getPgPool();

  // Build BSA knowledge query
  const params: unknown[] = [vec];
  let paramIdx = 2;
  const conditions: string[] = ["superseded_by IS NULL"];

  if (options.category) {
    conditions.push(`category = $${paramIdx}`);
    params.push(options.category);
    paramIdx++;
  }
  if (options.version) {
    conditions.push(`(version = $${paramIdx} OR version IS NULL)`);
    params.push(options.version);
    paramIdx++;
  }

  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows: bsaResults } = await pool.query<KnowledgeChunk>(
    `SELECT id, content, category, source, section, tags, rank,
            merit_badge AS "meritBadge", version,
            1 - (embedding <=> $1::vector) AS similarity
     FROM scouting_knowledge
     ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT $${paramIdx}`,
    params,
  );

  // Search troop customizations (always search, max 3 results)
  const { rows: troopOverrides } = await pool.query<TroopCustomization>(
    `SELECT id, troop_id AS "troopId", category, scope, content, priority,
            relationship, bsa_reference AS "bsaReference",
            related_policy_id AS "relatedPolicyId", source, created_by AS "createdBy"
     FROM troop_customizations
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 3`,
    [vec],
  );

  // Only include troop results with reasonable similarity (> 0.5)
  // We can't easily get similarity from the query above without re-querying,
  // so include all — the LLM can decide relevance from context.

  return { bsaResults, troopOverrides };
}
