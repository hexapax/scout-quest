#!/usr/bin/env node
/**
 * Chunk markdown files, embed via Gemini Embedding 2, upsert into pgvector.
 * Usage: GOOGLE_KEY=... POSTGRES_URI=... nvm exec 24 node scripts/embed-scouting-knowledge.mjs
 *
 * Requires: npm install pg (or run from a dir that has it)
 * For production: SSH tunnel to VM's pgvector first:
 *   gcloud compute ssh scout-coach-vm ... -- -L 5433:ai-chat-vectordb:5432
 *   POSTGRES_URI=postgresql://myuser:mypassword@localhost:5433/scouting_knowledge
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

// Dynamic import pg (may need to resolve from different locations)
let pg;
try { pg = await import('pg'); } catch {
  try { pg = await import('/home/jeremy/git-personal/scout-quest/mcp-servers/scout-quest/node_modules/pg/lib/index.js'); } catch {
    console.error('pg module not found. Run: npm install pg');
    process.exit(1);
  }
}
const { Pool } = pg.default || pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', 'docs', 'scouting-knowledge');
const GOOGLE_KEY = process.env.GOOGLE_KEY;
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://myuser:mypassword@localhost:5433/scouting_knowledge';

const CHUNK_SIZE_CHARS = 2000;  // ~500 tokens at 4 chars/token
const CHUNK_OVERLAP_CHARS = 200;
const BATCH_SIZE = 20;
const DELAY_MS = 500;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'models/gemini-embedding-2-preview';
const DIMENSIONS = 1536;

if (!GOOGLE_KEY) { console.error('GOOGLE_KEY required'); process.exit(1); }

async function embedBatch(texts) {
  const requests = texts.map(text => ({
    model: EMBED_MODEL,
    content: { parts: [{ text }] },
    outputDimensionality: DIMENSIONS,
  }));
  try {
    const resp = await fetch(`${GEMINI_API}/${EMBED_MODEL}:batchEmbedContents?key=${GOOGLE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return data.embeddings.map(e => e.values);
  } catch (e) {
    console.warn(`  Batch failed (${e.message}), falling back to individual`);
    const results = [];
    for (const text of texts) {
      await sleep(200);
      const resp = await fetch(`${GEMINI_API}/${EMBED_MODEL}:embedContent?key=${GOOGLE_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, content: { parts: [{ text }] }, outputDimensionality: DIMENSIONS }),
      });
      if (!resp.ok) throw new Error(`Individual embed failed: ${resp.status}`);
      const data = await resp.json();
      results.push(data.embedding.values);
    }
    return results;
  }
}

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };
  const metadata = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(': ');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 2).trim();
      try { metadata[key] = JSON.parse(val); }
      catch { metadata[key] = val; }
    }
  }
  return { metadata, body: match[2] };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`Connecting to pgvector: ${POSTGRES_URI.replace(/:[^@]*@/, ':***@')}`);
  const pool = new Pool({ connectionString: POSTGRES_URI });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('Connected.\n');
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    console.error('If connecting to production, start SSH tunnel first:');
    console.error('  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap -- -L 5433:ai-chat-vectordb:5432');
    process.exit(1);
  }

  // Collect markdown files
  const files = [];
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkDir(path.join(dir, entry.name));
      else if (entry.name.endsWith('.md')) files.push(path.join(dir, entry.name));
    }
  }
  walkDir(KB_DIR);
  console.log(`Found ${files.length} knowledge files\n`);

  // Get existing hashes
  const { rows: existingRows } = await pool.query('SELECT content_hash FROM scouting_knowledge');
  const existing = new Set(existingRows.map(r => r.content_hash));
  console.log(`${existing.size} existing chunks in pgvector\n`);

  let totalChunks = 0, embedded = 0, skipped = 0;
  const pendingBatch = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf-8');
    const { metadata, body } = parseFrontmatter(raw);
    const relPath = path.relative(KB_DIR, file);

    if (body.trim().length < 50) {
      console.log(`  Skip (too short): ${relPath}`);
      continue;
    }

    const chunks = chunkText(body);
    console.log(`  ${relPath}: ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const hash = sha256(chunks[i]);
      totalChunks++;

      if (existing.has(hash)) { skipped++; continue; }

      pendingBatch.push({
        content: chunks[i],
        hash,
        category: metadata.category || 'unknown',
        source: metadata.source || relPath,
        section: `${relPath}#chunk${i}`,
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        rank: metadata.rank || null,
        merit_badge: metadata.merit_badge || null,
        version: metadata.version || null,
        effective_date: metadata.effective_date || null,
        superseded_by: metadata.superseded_by || null,
        metadata: JSON.stringify(metadata),
      });

      if (pendingBatch.length >= BATCH_SIZE) {
        await processBatch(pool, pendingBatch);
        embedded += pendingBatch.length;
        pendingBatch.length = 0;
        await sleep(DELAY_MS);
      }
    }
  }

  if (pendingBatch.length > 0) {
    await processBatch(pool, pendingBatch);
    embedded += pendingBatch.length;
  }

  const { rows: countRows } = await pool.query('SELECT count(*) FROM scouting_knowledge');

  console.log(`\n=== Done ===`);
  console.log(`Total chunks processed: ${totalChunks}`);
  console.log(`Newly embedded: ${embedded}`);
  console.log(`Skipped (unchanged): ${skipped}`);
  console.log(`pgvector total rows: ${countRows[0].count}`);

  await pool.end();
}

async function processBatch(pool, batch) {
  const texts = batch.map(b => b.content);
  const embeddings = await embedBatch(texts);

  for (let i = 0; i < batch.length; i++) {
    const b = batch[i];
    const vec = `[${embeddings[i].join(',')}]`;
    await pool.query(
      `INSERT INTO scouting_knowledge (content, embedding, category, source, section, tags, rank, merit_badge, version, effective_date, superseded_by, metadata, content_hash)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (content_hash) DO UPDATE SET embedding = $2::vector, updated_at = NOW()`,
      [b.content, vec, b.category, b.source, b.section, b.tags, b.rank, b.merit_badge, b.version, b.effective_date, b.superseded_by, b.metadata, b.hash]
    );
  }
  console.log(`  Embedded batch of ${batch.length}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
