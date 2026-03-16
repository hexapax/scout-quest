#!/usr/bin/env node
/**
 * Test semantic search against the scouting knowledge pgvector store.
 * Usage: GOOGLE_KEY=... POSTGRES_URI=... nvm exec 24 node scripts/test-knowledge-search.mjs "query"
 */

let pg;
try { pg = await import('pg'); } catch {
  try { pg = await import('/home/jeremy/git-personal/scout-quest/mcp-servers/scout-quest/node_modules/pg/lib/index.js'); } catch {
    console.error('pg module not found'); process.exit(1);
  }
}
const { Pool } = pg.default || pg;

const QUERY = process.argv[2] || 'board of review procedures';
const GOOGLE_KEY = process.env.GOOGLE_KEY;
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://myuser:mypassword@localhost:5433/scouting_knowledge';

if (!GOOGLE_KEY) { console.error('GOOGLE_KEY required'); process.exit(1); }

async function main() {
  // Embed query
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-002:embedContent?key=${GOOGLE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-002',
        content: { parts: [{ text: QUERY }] },
        outputDimensionality: 1536,
      }),
    }
  );
  if (!resp.ok) { console.error(`Embed failed: ${resp.status}`); process.exit(1); }
  const embedding = (await resp.json()).embedding.values;
  const vec = `[${embedding.join(',')}]`;

  const pool = new Pool({ connectionString: POSTGRES_URI });

  const { rows } = await pool.query(
    `SELECT content, category, source, section, rank, merit_badge,
            1 - (embedding <=> $1::vector) AS similarity
     FROM scouting_knowledge
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    [vec]
  );

  console.log(`Query: "${QUERY}"\n`);
  if (rows.length === 0) {
    console.log('No results. Is the knowledge base populated?');
  }
  for (const row of rows) {
    console.log(`--- [${(row.similarity * 100).toFixed(1)}%] ${row.category} | ${row.source || 'unknown'} ---`);
    console.log(row.content.substring(0, 400));
    console.log();
  }

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
