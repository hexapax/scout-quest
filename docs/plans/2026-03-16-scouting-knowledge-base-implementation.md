# Scouting Knowledge Base — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid knowledge architecture giving every Scout Quest chat session authoritative access to BSA policies, versioned rank/MB requirements, troop-specific customizations, and advancement strategies — backed by pgvector semantic search and MongoDB structured data.

**Architecture:** Markdown files (git-tracked, versioned) → chunked + embedded via Gemini Embedding 2 (1536d) → pgvector for semantic search. MongoDB for structured advancement data (already populated). MCP tools query both stores. Troop customizations overlay BSA policy with three-tier precedence.

**Tech Stack:** TypeScript (MCP server), Node.js 24, PostgreSQL + pgvector extension (existing `ai-chat-vectordb` container), MongoDB (existing `ai-chat-mongodb` container), Gemini Embedding 2 API (`GOOGLE_KEY`), `pg` npm package for pgvector queries.

**Design spec:** `docs/plans/2026-03-16-scouting-knowledge-base-design.md`

**Troop context data:** `docs/scouting-knowledge/troop/` (10 files from Google Drive), `scouting-org-research/data/fresh/` (231 Scoutbook API captures)

---

## File Structure

### New Files

```
mcp-servers/scout-quest/src/knowledge/
  pgvector.ts          — pgvector connection pool + query helpers
  embeddings.ts        — Gemini Embedding 2 API client
  search.ts            — search_scouting_knowledge implementation
  reference.ts         — get_rank_requirements, get_merit_badge_info
  troop-policy.ts      — manage_troop_policy, troop policy queries
  meeting-planner.ts   — suggest_meeting_activities logic
  types.ts             — KnowledgeChunk, TroopCustomization, SearchResult types

mcp-servers/scout-quest/src/tools/shared/
  knowledgeTools.ts    — MCP tool registrations (shared across scout/guide/admin)

mcp-servers/scout-quest/src/resources/
  rankGuide.ts         — rank-guide resource
  troopPolicies.ts     — troop-policies resource

scripts/
  research-bsa-content.mjs     — Perplexity-powered BSA content research
  load-reference-data.mjs      — Load rank/MB requirement text into MongoDB
  embed-scouting-knowledge.mjs — Chunk + embed markdown → pgvector
  test-knowledge-search.mjs    — Verify semantic search works

docs/scouting-knowledge/
  ranks/               — 7 rank requirement markdown files
  merit-badges/        — Priority Eagle-required MB files first
  policies/            — Guide to Advancement excerpts, YPT, safety
  procedures/          — BOR, blue card, age/time rules
  strategies/          — EDGE method, meeting activities (Phase 2)
  troop/               — Already exists (10 files from Google Drive)
```

### Modified Files

```
mcp-servers/scout-quest/src/scout.ts      — Register knowledge tools + resources
mcp-servers/scout-quest/src/guide.ts      — Register knowledge tools + resources
mcp-servers/scout-quest/src/admin.ts      — Register knowledge tools + resources + manage_troop_policy
mcp-servers/scout-quest/src/db.ts         — Add pgvector connection export
mcp-servers/scout-quest/package.json      — Add `pg` dependency
config/ai-chat/.env.example               — Add POSTGRES_URI, GOOGLE_KEY docs
```

---

## Chunk 1: Infrastructure + Data Loading (Tasks 1-5)

### Task 1: Set Up pgvector Schema

**Files:**
- Create: `scripts/setup-pgvector-schema.sql`
- Create: `scripts/setup-pgvector.sh`

- [ ] **Step 1: Write the SQL schema file**

```sql
-- scripts/setup-pgvector-schema.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS scouting_knowledge (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  category TEXT NOT NULL,
  source TEXT,
  section TEXT,
  tags TEXT[],
  rank TEXT,
  merit_badge TEXT,
  version TEXT,
  effective_date DATE,
  superseded_by TEXT,
  metadata JSONB,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS troop_customizations (
  id SERIAL PRIMARY KEY,
  troop_id TEXT NOT NULL DEFAULT '2024',
  category TEXT NOT NULL,
  scope TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  priority TEXT DEFAULT 'info',
  relationship TEXT DEFAULT 'supplement',
  bsa_reference TEXT,
  related_policy_id INTEGER REFERENCES troop_customizations(id),
  source TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sk_embedding ON scouting_knowledge
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_sk_category ON scouting_knowledge (category);
CREATE INDEX IF NOT EXISTS idx_sk_version ON scouting_knowledge (version);
CREATE INDEX IF NOT EXISTS idx_sk_tags ON scouting_knowledge USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_sk_hash ON scouting_knowledge (content_hash);

CREATE INDEX IF NOT EXISTS idx_tc_embedding ON troop_customizations
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS idx_tc_troop_cat ON troop_customizations (troop_id, category);
```

- [ ] **Step 2: Write the setup script**

```bash
#!/bin/bash
# scripts/setup-pgvector.sh
# Run against the ai-chat-vectordb container on the production VM
# Usage: ./scripts/ssh-vm.sh "bash /tmp/setup-pgvector.sh"

set -euo pipefail
PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -h ai-chat-vectordb -U postgres -d scouting_knowledge -f /tmp/setup-pgvector-schema.sql
echo "pgvector schema created."
```

- [ ] **Step 3: Deploy and run on production VM**

```bash
# Create the database first (it may not exist)
./scripts/ssh-vm.sh "sudo docker exec ai-chat-vectordb psql -U postgres -c 'CREATE DATABASE scouting_knowledge;'" || true
# SCP the SQL file
gcloud compute scp scripts/setup-pgvector-schema.sql scout-coach-vm:/tmp/ \
  --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap
# Run it inside the container
./scripts/ssh-vm.sh "sudo docker exec -i ai-chat-vectordb psql -U postgres -d scouting_knowledge < /tmp/setup-pgvector-schema.sql"
```

Expected: `CREATE EXTENSION`, `CREATE TABLE`, `CREATE INDEX` messages.

- [ ] **Step 4: Verify**

```bash
./scripts/ssh-vm.sh "sudo docker exec ai-chat-vectordb psql -U postgres -d scouting_knowledge -c '\dt'"
```

Expected: `scouting_knowledge` and `troop_customizations` tables listed.

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-pgvector-schema.sql scripts/setup-pgvector.sh
git commit -m "infra: add pgvector schema for scouting knowledge base"
```

---

### Task 2: Load Reference Requirement Data into MongoDB

The rank requirement text already exists in `scouting-org-research/data/fresh/ref_rank_{1-7}_requirements.json`. This task loads it into a `scoutbook_reference` collection so MCP tools can look up "what does Tenderfoot req 4a actually say?"

**Files:**
- Create: `scripts/load-reference-data.mjs`

- [ ] **Step 1: Write the loader script**

This script reads the 7 rank reference files and 140 merit badge definitions, transforms them into the `scoutbook_reference` schema, and upserts into MongoDB.

```javascript
// scripts/load-reference-data.mjs
// Loads rank requirement text + MB definitions into scoutbook_reference collection
// Usage: nvm exec 24 node scripts/load-reference-data.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRESH = path.join(__dirname, '..', 'scouting-org-research', 'data', 'fresh');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/scoutquest';

const RANK_NAMES = {
  1: 'Scout', 2: 'Tenderfoot', 3: 'Second Class',
  4: 'First Class', 5: 'Star', 6: 'Life', 7: 'Eagle'
};

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db().collection('scoutbook_reference');
  await col.createIndex({ type: 1, rankId: 1, reqNumber: 1, version: 1 }, { unique: true });

  let count = 0;

  // Load rank requirements
  for (const [rankIdStr, rankName] of Object.entries(RANK_NAMES)) {
    const rankId = parseInt(rankIdStr);
    const fn = path.join(FRESH, `ref_rank_${rankId}_requirements.json`);
    if (!fs.existsSync(fn)) continue;

    const data = JSON.parse(fs.readFileSync(fn, 'utf-8'));
    const reqs = Array.isArray(data) ? data : (data.requirements || []);

    for (const req of reqs) {
      const doc = {
        type: 'rank_requirement',
        rankId,
        rankName,
        reqNumber: req.requirementNumber || req.listNumber || '',
        fullText: req.name || '',
        short: req.short || '',
        version: req.versionId || 'current',
        sortOrder: req.sortOrder || '',
        required: req.required === 'True',
        parentReqId: req.parentRequirementId || null,
      };
      await col.updateOne(
        { type: doc.type, rankId: doc.rankId, reqNumber: doc.reqNumber, version: doc.version },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      count++;
    }
    console.log(`  ${rankName}: ${reqs.length} requirements`);
  }

  // Load merit badge definitions
  const mbData = JSON.parse(fs.readFileSync(path.join(FRESH, 'ref_meritBadges.json'), 'utf-8'));
  const badges = Array.isArray(mbData) ? mbData : (mbData.meritBadges || mbData);

  for (const mb of badges) {
    const doc = {
      type: 'merit_badge',
      meritBadgeId: mb.id,
      name: mb.name,
      short: mb.short || mb.name,
      description: mb.description || '',
      isEagleRequired: mb.isEagleRequired || false,
      categoryName: mb.meritBadgeCategoryName || '',
      version: mb.version || mb.versionId || 'current',
      imageUrl: mb.imageUrl200 || mb.imageUrl100 || '',
      worksheetPDF: mb.worksheetPDF || '',
      bsaRequirements: mb.bsaRequirements || '',
    };
    await col.updateOne(
      { type: 'merit_badge', meritBadgeId: doc.meritBadgeId },
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    count++;
  }
  console.log(`  Merit badges: ${badges.length} definitions`);

  console.log(`\nTotal: ${count} reference docs upserted`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run locally to test against local MongoDB (if available) or generate mongosh import**

```bash
# Generate mongosh import for production
source ~/.nvm/nvm.sh
nvm exec 24 node scripts/load-reference-data.mjs
```

If no local MongoDB, generate a mongosh script similar to `generate-mongo-import.mjs` and run on the VM.

- [ ] **Step 3: Deploy to production MongoDB**

Same pattern as the scoutbook data load — SCP + `docker exec ai-chat-mongodb mongosh`.

Expected: ~147 rank requirements + 140 MB definitions = ~287 reference docs.

- [ ] **Step 4: Verify**

```bash
./scripts/ssh-vm.sh "sudo docker exec ai-chat-mongodb mongosh --quiet scoutquest --eval 'db.scoutbook_reference.countDocuments()'"
```

Expected: ~287

- [ ] **Step 5: Commit**

```bash
git add scripts/load-reference-data.mjs
git commit -m "feat: load BSA rank/MB reference data into MongoDB"
```

---

### Task 3: Research BSA Policy Content via Perplexity

Use Perplexity to gather accurate, sourced BSA policy content. Prioritize based on troop data:

**Priority order** (from troop advancement analysis):
1. Rank requirements: Tenderfoot, Second Class, First Class (8 younger scouts need these)
2. Eagle-required MBs: Family Life (18 scouts), Cit in Community (15), Emergency Prep (14), First Aid (14), Personal Management (14)
3. Guide to Advancement excerpts: BOR procedures, SM conferences, partial credit rules
4. Youth Protection / Mandatory Reporter Training
5. Star/Life/Eagle rank requirements

**Files:**
- Create: `scripts/research-bsa-content.mjs`
- Create: `docs/scouting-knowledge/ranks/scout.md` through `eagle.md`
- Create: `docs/scouting-knowledge/merit-badges/` (top 14 Eagle-required)
- Create: `docs/scouting-knowledge/policies/` (key policy docs)
- Create: `docs/scouting-knowledge/procedures/` (BOR, SM conference, etc.)

- [ ] **Step 1: Write the research script**

The script uses Perplexity MCP (or direct API) to query for specific BSA content, then saves structured markdown files with YAML frontmatter.

```javascript
// scripts/research-bsa-content.mjs
// Batch research BSA content via Perplexity API
// Saves results as markdown files in docs/scouting-knowledge/
// Usage: PERPLEXITY_API_KEY=... nvm exec 24 node scripts/research-bsa-content.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', 'docs', 'scouting-knowledge');
const API_KEY = process.env.PERPLEXITY_API_KEY;
const DELAY_MS = 3000; // Be gentle with the API

if (!API_KEY) {
  console.error('PERPLEXITY_API_KEY required');
  process.exit(1);
}

async function askPerplexity(query) {
  const resp = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'You are a Scouting America (formerly BSA) expert. Provide accurate, current information with citations. Use the current name "Scouting America" but note the former name "BSA" where helpful. Be specific about requirement numbers and exact text.' },
        { role: 'user', content: query }
      ],
    }),
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function writeKB(subdir, filename, frontmatter, content) {
  const dir = path.join(KB_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(
    path.join(dir, filename),
    `---\n${fm}\ncurrent_as_of: "2026-03-16"\n---\n\n${content}\n`
  );
  console.log(`  Wrote ${subdir}/${filename}`);
}

async function main() {
  console.log('=== Researching BSA content via Perplexity ===\n');

  // --- Rank Requirements ---
  const ranks = [
    { name: 'Scout', file: 'scout.md' },
    { name: 'Tenderfoot', file: 'tenderfoot.md' },
    { name: 'Second Class', file: 'second-class.md' },
    { name: 'First Class', file: 'first-class.md' },
    { name: 'Star', file: 'star.md' },
    { name: 'Life', file: 'life.md' },
    { name: 'Eagle Scout', file: 'eagle.md' },
  ];

  for (const rank of ranks) {
    console.log(`Researching: ${rank.name} rank...`);
    const content = await askPerplexity(
      `List all current Scouting America (formerly BSA) ${rank.name} rank requirements for Scouts BSA program (2024 version). Include the full text of each requirement with requirement numbers. Note any recent changes from previous versions. Include tips for completing each requirement efficiently.`
    );
    writeKB('ranks', rank.file, {
      category: 'rank_requirement',
      rank: rank.name.toLowerCase().replace(' ', '-'),
      tags: ['rank', rank.name.toLowerCase().replace(' ', '-'), 'scouts-bsa'],
      source: 'Scouting America official requirements (via Perplexity research)',
    }, content);
    await sleep(DELAY_MS);
  }

  // --- Eagle-Required Merit Badges (top 14 by troop need) ---
  const eagleMBs = [
    'Family Life', 'Citizenship in the Community', 'Emergency Preparedness',
    'First Aid', 'Personal Management', 'Citizenship in the Nation',
    'Citizenship in the World', 'Cooking', 'Swimming', 'Camping',
    'Communication', 'Personal Fitness', 'Environmental Science',
    'Citizenship in Society',
  ];

  for (const mb of eagleMBs) {
    const filename = mb.toLowerCase().replace(/\s+/g, '-') + '.md';
    console.log(`Researching: ${mb} MB...`);
    const content = await askPerplexity(
      `List all current Scouting America (formerly BSA) ${mb} merit badge requirements. Include the full text of each requirement with numbers. Note if this is Eagle-required. Include practical tips for completing each requirement. Note any recent requirement changes or version differences.`
    );
    writeKB('merit-badges', filename, {
      category: 'merit_badge',
      merit_badge: mb.toLowerCase().replace(/\s+/g, '-'),
      tags: ['merit-badge', 'eagle-required', mb.toLowerCase().replace(/\s+/g, '-')],
      source: 'Scouting America official requirements (via Perplexity research)',
    }, content);
    await sleep(DELAY_MS);
  }

  // --- Key Policies ---
  const policies = [
    { query: 'Summarize the key sections of the Scouting America Guide to Advancement (current edition). Focus on: how advancement works, Scoutmaster conference procedures, Board of Review procedures, partial completion rules, time requirements between ranks, and special circumstances. Include section numbers.', file: 'guide-to-advancement.md', tags: ['policy', 'advancement', 'bor', 'scoutmaster-conference'] },
    { query: 'What are the current Scouting America youth protection policies (now called Mandatory Reporter Training)? Include two-deep leadership rules, no one-on-one contact policy, social media guidelines, reporting procedures, and adult leader certification requirements. Note name changes from YPT to current terminology.', file: 'youth-protection.md', tags: ['policy', 'youth-protection', 'mandatory-reporter', 'ypt'] },
    { query: 'What are the current Scouting America Board of Review procedures and guidelines? Include who can serve, what questions are appropriate vs inappropriate, how advancement decisions are made, and appeal procedures. Reference the Guide to Advancement sections.', file: 'board-of-review.md', tags: ['policy', 'board-of-review', 'advancement'] },
    { query: 'What is the current Scouting America Eagle Scout project process? Include the project proposal, fundraising rules, workbook requirements, timeline, final writeup, and who must approve at each stage. Include the Eagle Board of Review process.', file: 'eagle-project.md', tags: ['policy', 'eagle', 'eagle-project', 'service-project'] },
    { query: 'What are the current Scouting America requirements for Eagle-required merit badges as of 2025-2026? Note the recent changes regarding Citizenship in Society, including which version applies to which scouts based on when they started their Eagle trail. Include the full list of Eagle-required badges and any choice groups.', file: 'eagle-required-merit-badges.md', tags: ['policy', 'eagle', 'merit-badge', 'eagle-required'] },
  ];

  for (const policy of policies) {
    console.log(`Researching: ${policy.file}...`);
    const content = await askPerplexity(policy.query);
    writeKB('policies', policy.file, {
      category: 'policy',
      tags: policy.tags,
      source: 'Scouting America official publications (via Perplexity research)',
    }, content);
    await sleep(DELAY_MS);
  }

  // --- Procedures ---
  const procedures = [
    { query: 'What are the Scouting America age requirements and time-in-rank requirements for each Scouts BSA rank (Scout through Eagle)? Include minimum age to join, age limits, and how time requirements work.', file: 'age-and-time-requirements.md', tags: ['procedure', 'age', 'time-in-rank'] },
    { query: 'How does the Scouting America blue card (merit badge application) process work? Include how to get a blue card, counselor assignment, partial completion, and what happens when a scout changes troops or counselors.', file: 'blue-card-process.md', tags: ['procedure', 'blue-card', 'merit-badge'] },
    { query: 'What are the Scouting America Safe Swim Defense, Safety Afloat, Trek Safely, and Climb On Safely requirements? Summarize each policy with the key rules leaders must follow.', file: 'safety-policies.md', tags: ['procedure', 'safety', 'aquatics', 'hiking', 'climbing'] },
    { query: 'What approved leadership positions count for Star, Life, and Eagle rank requirements in Scouting America Scouts BSA? List all approved positions and minimum time requirements.', file: 'leadership-positions.md', tags: ['procedure', 'leadership', 'position-of-responsibility'] },
  ];

  for (const proc of procedures) {
    console.log(`Researching: ${proc.file}...`);
    const content = await askPerplexity(proc.query);
    writeKB('procedures', proc.file, {
      category: 'procedure',
      tags: proc.tags,
      source: 'Scouting America official publications (via Perplexity research)',
    }, content);
    await sleep(DELAY_MS);
  }

  console.log('\n=== Done ===');
  const total = 7 + eagleMBs.length + policies.length + procedures.length;
  console.log(`${total} knowledge files created in ${KB_DIR}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Get Perplexity API key and run**

The API key is in GCP Secret Manager (`perplexity-devbox` in `hexapax-devbox` project):

```bash
export PERPLEXITY_API_KEY=$(gcloud secrets versions access latest --secret=perplexity-devbox --project=hexapax-devbox)
source ~/.nvm/nvm.sh
nvm exec 24 node scripts/research-bsa-content.mjs
```

Expected: ~30 queries × 3s delay = ~90 seconds. Creates 30 markdown files.

- [ ] **Step 3: Manual review of generated content**

Review the generated markdown files for accuracy. The Scoutmaster (Jeremy) should spot-check:
- Rank requirement text against Scoutbook reference data
- Eagle-required MB list against current policy
- BOR procedures against troop practices

- [ ] **Step 4: Commit**

```bash
git add docs/scouting-knowledge/ranks/ docs/scouting-knowledge/merit-badges/ \
  docs/scouting-knowledge/policies/ docs/scouting-knowledge/procedures/ \
  scripts/research-bsa-content.mjs
git commit -m "feat: add BSA reference content researched via Perplexity"
```

---

### Task 4: Build Embedding Pipeline

**Files:**
- Create: `scripts/embed-scouting-knowledge.mjs`
- Create: `mcp-servers/scout-quest/src/knowledge/embeddings.ts`

- [ ] **Step 1: Write the Gemini Embedding 2 client**

```typescript
// mcp-servers/scout-quest/src/knowledge/embeddings.ts
// Gemini Embedding 2 API client for generating embeddings

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "models/gemini-embedding-002";
const DIMENSIONS = 1536;

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  const resp = await fetch(
    `${GEMINI_API_BASE}/${MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        content: { parts: [{ text }] },
        outputDimensionality: DIMENSIONS,
      }),
    }
  );
  if (!resp.ok) throw new Error(`Embedding API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.embedding.values;
}

export async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const requests = texts.map(text => ({
    model: MODEL,
    content: { parts: [{ text }] },
    outputDimensionality: DIMENSIONS,
  }));

  const resp = await fetch(
    `${GEMINI_API_BASE}/${MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    }
  );
  if (!resp.ok) {
    // Fall back to individual requests on batch failure
    console.warn(`Batch embed failed (${resp.status}), falling back to individual requests`);
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedText(text, apiKey));
    }
    return results;
  }
  const data = await resp.json();
  return data.embeddings.map((e: { values: number[] }) => e.values);
}
```

- [ ] **Step 2: Write the embedding pipeline script**

```javascript
// scripts/embed-scouting-knowledge.mjs
// Chunks markdown files, embeds via Gemini, upserts into pgvector
// Usage: GOOGLE_KEY=... POSTGRES_URI=... nvm exec 24 node scripts/embed-scouting-knowledge.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', 'docs', 'scouting-knowledge');
const GOOGLE_KEY = process.env.GOOGLE_KEY;
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://postgres@localhost:5432/scouting_knowledge';
const CHUNK_SIZE = 500;   // tokens (approx 4 chars/token)
const CHUNK_OVERLAP = 50; // tokens
const BATCH_SIZE = 20;    // conservative batch size
const DELAY_MS = 500;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'models/gemini-embedding-002';
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
    if (!resp.ok) throw new Error(`${resp.status}`);
    const data = await resp.json();
    return data.embeddings.map(e => e.values);
  } catch (e) {
    // Fallback to individual
    console.warn(`  Batch failed (${e.message}), falling back to individual`);
    return Promise.all(texts.map(async text => {
      const resp = await fetch(`${GEMINI_API}/${EMBED_MODEL}:embedContent?key=${GOOGLE_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, content: { parts: [{ text }] }, outputDimensionality: DIMENSIONS }),
      });
      const data = await resp.json();
      return data.embedding.values;
    }));
  }
}

function chunkText(text, chunkSize = CHUNK_SIZE * 4, overlap = CHUNK_OVERLAP * 4) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };
  const metadata = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(': ');
    if (key && rest.length) {
      try { metadata[key.trim()] = JSON.parse(rest.join(': ')); }
      catch { metadata[key.trim()] = rest.join(': ').trim(); }
    }
  }
  return { metadata, body: match[2] };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  const pool = new pg.Pool({ connectionString: POSTGRES_URI });

  // Collect all markdown files
  const files = [];
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkDir(path.join(dir, entry.name));
      else if (entry.name.endsWith('.md')) files.push(path.join(dir, entry.name));
    }
  }
  walkDir(KB_DIR);
  console.log(`Found ${files.length} knowledge files\n`);

  // Get existing hashes to skip unchanged content
  const existing = new Map();
  const { rows } = await pool.query('SELECT content_hash FROM scouting_knowledge');
  for (const row of rows) existing.set(row.content_hash, true);
  console.log(`${existing.size} existing chunks in pgvector\n`);

  let totalChunks = 0, embedded = 0, skipped = 0;
  const pendingBatch = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf-8');
    const { metadata, body } = parseFrontmatter(raw);
    const relPath = path.relative(KB_DIR, file);
    console.log(`Processing: ${relPath}`);

    const chunks = chunkText(body);
    for (let i = 0; i < chunks.length; i++) {
      const hash = sha256(chunks[i]);
      totalChunks++;

      if (existing.has(hash)) {
        skipped++;
        continue;
      }

      pendingBatch.push({
        content: chunks[i],
        hash,
        category: metadata.category || 'unknown',
        source: metadata.source || relPath,
        section: `${relPath}#chunk${i}`,
        tags: metadata.tags || [],
        rank: metadata.rank || null,
        merit_badge: metadata.merit_badge || null,
        version: metadata.version || null,
        effective_date: metadata.effective_date || null,
        superseded_by: metadata.superseded_by || null,
        metadata: JSON.stringify(metadata),
      });

      // Embed + insert in batches
      if (pendingBatch.length >= BATCH_SIZE) {
        await processBatch(pool, pendingBatch);
        embedded += pendingBatch.length;
        pendingBatch.length = 0;
        await sleep(DELAY_MS);
      }
    }
  }

  // Final batch
  if (pendingBatch.length > 0) {
    await processBatch(pool, pendingBatch);
    embedded += pendingBatch.length;
  }

  console.log(`\n=== Done ===`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Embedded: ${embedded}`);
  console.log(`Skipped (unchanged): ${skipped}`);

  const { rows: countRows } = await pool.query('SELECT count(*) FROM scouting_knowledge');
  console.log(`pgvector total: ${countRows[0].count}`);

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
  console.log(`  Embedded ${batch.length} chunks`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the embedding pipeline**

```bash
export GOOGLE_KEY=<from ai-chat .env or GCS>
export POSTGRES_URI=postgresql://postgres@localhost:5432/scouting_knowledge
source ~/.nvm/nvm.sh
nvm exec 24 node scripts/embed-scouting-knowledge.mjs
```

Note: For production, the POSTGRES_URI points to the VM's pgvector. An SSH tunnel may be needed:

```bash
# SSH tunnel to production pgvector
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 \
  --tunnel-through-iap -- -L 5433:ai-chat-vectordb:5432
# Then: POSTGRES_URI=postgresql://postgres@localhost:5433/scouting_knowledge
```

Expected: ~200-300 chunks embedded, cost ~$0.05.

- [ ] **Step 4: Write a test search script**

```javascript
// scripts/test-knowledge-search.mjs
// Test semantic search against pgvector
// Usage: GOOGLE_KEY=... POSTGRES_URI=... nvm exec 24 node scripts/test-knowledge-search.mjs "board of review"

import pg from 'pg';

const QUERY = process.argv[2] || 'board of review procedures';
const GOOGLE_KEY = process.env.GOOGLE_KEY;
const POSTGRES_URI = process.env.POSTGRES_URI || 'postgresql://postgres@localhost:5432/scouting_knowledge';

async function main() {
  // Embed the query
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
  const embedding = (await resp.json()).embedding.values;
  const vec = `[${embedding.join(',')}]`;

  const pool = new pg.Pool({ connectionString: POSTGRES_URI });
  const { rows } = await pool.query(
    `SELECT content, category, source, section, rank, merit_badge,
            1 - (embedding <=> $1::vector) AS similarity
     FROM scouting_knowledge
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    [vec]
  );

  console.log(`Query: "${QUERY}"\n`);
  for (const row of rows) {
    console.log(`--- [${row.similarity.toFixed(3)}] ${row.category} | ${row.source} ---`);
    console.log(row.content.substring(0, 300));
    console.log();
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Test and verify**

```bash
nvm exec 24 node scripts/test-knowledge-search.mjs "What are the Tenderfoot first aid requirements?"
nvm exec 24 node scripts/test-knowledge-search.mjs "Can a scout be denied advancement at a Board of Review?"
nvm exec 24 node scripts/test-knowledge-search.mjs "What is two-deep leadership?"
```

Expected: Relevant results with similarity scores > 0.7.

- [ ] **Step 6: Commit**

```bash
git add scripts/embed-scouting-knowledge.mjs scripts/test-knowledge-search.mjs \
  mcp-servers/scout-quest/src/knowledge/embeddings.ts
git commit -m "feat: add Gemini Embedding 2 pipeline + pgvector embedding script"
```

---

### Task 5: Add `pg` Dependency to MCP Server

**Files:**
- Modify: `mcp-servers/scout-quest/package.json`

- [ ] **Step 1: Install pg**

```bash
npm --prefix mcp-servers/scout-quest install pg
```

- [ ] **Step 2: Verify it builds**

```bash
npx --prefix mcp-servers/scout-quest tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add mcp-servers/scout-quest/package.json mcp-servers/scout-quest/package-lock.json
git commit -m "chore: add pg dependency for pgvector queries"
```

---

## Chunk 2: MCP Tools + Resources (Tasks 6-10)

### Task 6: pgvector Connection + Search Implementation

**Files:**
- Create: `mcp-servers/scout-quest/src/knowledge/pgvector.ts`
- Create: `mcp-servers/scout-quest/src/knowledge/search.ts`
- Create: `mcp-servers/scout-quest/src/knowledge/types.ts`

- [ ] **Step 1: Write types**

```typescript
// mcp-servers/scout-quest/src/knowledge/types.ts

export interface KnowledgeChunk {
  id: number;
  content: string;
  category: string;
  source: string | null;
  section: string | null;
  tags: string[];
  rank: string | null;
  meritBadge: string | null;
  version: string | null;
  similarity: number;
}

export interface TroopCustomization {
  id: number;
  troopId: string;
  category: string;
  scope: string | null;
  content: string;
  priority: string;
  relationship: 'supplement' | 'override' | 'aspirational';
  bsaReference: string | null;
  relatedPolicyId: number | null;
  source: string | null;
  createdBy: string | null;
}

export interface SearchResult {
  bsaResults: KnowledgeChunk[];
  troopOverrides: TroopCustomization[];
}
```

- [ ] **Step 2: Write pgvector connection pool**

```typescript
// mcp-servers/scout-quest/src/knowledge/pgvector.ts

import pg from "pg";

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!pool) {
    const uri = process.env.POSTGRES_URI;
    if (!uri) throw new Error("POSTGRES_URI environment variable is required");
    pool = new pg.Pool({ connectionString: uri });
  }
  return pool;
}
```

- [ ] **Step 3: Write search implementation**

```typescript
// mcp-servers/scout-quest/src/knowledge/search.ts

import { getPgPool } from "./pgvector.js";
import { embedText } from "./embeddings.js";
import type { KnowledgeChunk, TroopCustomization, SearchResult } from "./types.js";

export async function searchKnowledge(
  query: string,
  options: { category?: string; version?: string; limit?: number } = {}
): Promise<SearchResult> {
  const apiKey = process.env.GOOGLE_KEY;
  if (!apiKey) throw new Error("GOOGLE_KEY required for embedding queries");

  const embedding = await embedText(query, apiKey);
  const vec = `[${embedding.join(",")}]`;
  const limit = options.limit || 5;
  const pool = getPgPool();

  // Search BSA knowledge
  let sql = `
    SELECT id, content, category, source, section, tags, rank, merit_badge AS "meritBadge",
           version, 1 - (embedding <=> $1::vector) AS similarity
    FROM scouting_knowledge
    WHERE superseded_by IS NULL
  `;
  const params: unknown[] = [vec];
  let paramIdx = 2;

  if (options.category) {
    sql += ` AND category = $${paramIdx}`;
    params.push(options.category);
    paramIdx++;
  }
  if (options.version) {
    sql += ` AND (version = $${paramIdx} OR version IS NULL)`;
    params.push(options.version);
    paramIdx++;
  }

  sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIdx}`;
  params.push(limit);

  const { rows: bsaResults } = await pool.query(sql, params);

  // Search troop customizations
  const { rows: troopOverrides } = await pool.query(
    `SELECT id, troop_id AS "troopId", category, scope, content, priority,
            relationship, bsa_reference AS "bsaReference",
            related_policy_id AS "relatedPolicyId", source, created_by AS "createdBy"
     FROM troop_customizations
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 3`,
    [vec]
  );

  return { bsaResults, troopOverrides };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx --prefix mcp-servers/scout-quest tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/knowledge/
git commit -m "feat: add pgvector connection pool and semantic search implementation"
```

---

### Task 7: Build `search_scouting_knowledge` MCP Tool

**Files:**
- Create: `mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts`
- Modify: `mcp-servers/scout-quest/src/scout.ts`
- Modify: `mcp-servers/scout-quest/src/guide.ts`
- Modify: `mcp-servers/scout-quest/src/admin.ts`

- [ ] **Step 1: Write the shared knowledge tools registration**

```typescript
// mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchKnowledge } from "../../knowledge/search.js";

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    "search_scouting_knowledge",
    {
      title: "Search Scouting Knowledge Base",
      description:
        "Semantic search over BSA/Scouting America policies, rank requirements, merit badge info, " +
        "and troop-specific customs. Use this instead of relying on training data for BSA-specific questions. " +
        "Returns BSA reference material plus any troop overrides/supplements.",
      inputSchema: {
        query: z.string().describe("Natural language question about BSA policy, rank requirements, merit badges, or troop practices"),
        category: z.string().optional().describe("Filter by category: rank_requirement, merit_badge, policy, procedure, strategy, troop"),
        limit: z.number().optional().default(5).describe("Number of results to return (default 5)"),
      },
    },
    async ({ query, category, limit }) => {
      try {
        const results = await searchKnowledge(query, { category, limit });

        const sections: string[] = [];

        if (results.bsaResults.length > 0) {
          sections.push("## BSA/Scouting America Reference\n");
          for (const r of results.bsaResults) {
            sections.push(
              `### ${r.category} | ${r.source || "Unknown source"} (${(r.similarity * 100).toFixed(0)}% match)\n` +
              r.content + "\n"
            );
          }
        }

        if (results.troopOverrides.length > 0) {
          sections.push("\n## Troop 2024 Customizations\n");
          for (const t of results.troopOverrides) {
            const tag = t.relationship === "override" ? "⚠️ TROOP OVERRIDE"
              : t.relationship === "aspirational" ? "🎯 JTE TARGET"
              : "ℹ️ TROOP SUPPLEMENT";
            sections.push(`### ${tag} — ${t.category}\n${t.content}\n`);
          }
        }

        const text = sections.length > 0
          ? sections.join("\n")
          : `No results found for "${query}". Try broader search terms.`;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Knowledge search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
```

- [ ] **Step 2: Register in all three MCP servers**

Add to `scout.ts`, `guide.ts`, and `admin.ts`:

```typescript
import { registerKnowledgeTools } from "./tools/shared/knowledgeTools.js";
// ... in the server setup section:
registerKnowledgeTools(server);
```

- [ ] **Step 3: Verify build**

```bash
npx --prefix mcp-servers/scout-quest tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts \
  mcp-servers/scout-quest/src/scout.ts \
  mcp-servers/scout-quest/src/guide.ts \
  mcp-servers/scout-quest/src/admin.ts
git commit -m "feat: add search_scouting_knowledge MCP tool to all servers"
```

---

### Task 8: Build `get_rank_requirements` MCP Tool

This is the version-aware tool that merges reference text with per-scout completion data.

**Files:**
- Create: `mcp-servers/scout-quest/src/knowledge/reference.ts`
- Modify: `mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts`

- [ ] **Step 1: Write the reference query module**

```typescript
// mcp-servers/scout-quest/src/knowledge/reference.ts

import { scoutbookScouts, scoutbookRequirements } from "../scoutbook/collections.js";
import { getDb } from "../db.js";

const RANK_IDS: Record<string, number> = {
  scout: 1, tenderfoot: 2, "second-class": 3, "second class": 3,
  "first-class": 4, "first class": 4, star: 5, life: 6, eagle: 7,
};

export async function getRankRequirements(
  rank: string,
  scoutId?: string
): Promise<string> {
  const rankId = RANK_IDS[rank.toLowerCase()];
  if (!rankId) return `Unknown rank: "${rank}". Valid: ${Object.keys(RANK_IDS).join(", ")}`;

  const db = await getDb();
  const refCol = db.collection("scoutbook_reference");

  // Get reference requirement text
  const refs = await refCol
    .find({ type: "rank_requirement", rankId })
    .sort({ sortOrder: 1 })
    .toArray();

  if (refs.length === 0) {
    return `No reference data found for rank ${rank}. Run load-reference-data.mjs first.`;
  }

  const lines: string[] = [`# ${rank.charAt(0).toUpperCase() + rank.slice(1)} Requirements\n`];

  // If scout specified, get their completion status
  let scoutReqs: Map<string, { completed: boolean; started: boolean; dateCompleted?: string }> = new Map();
  let scoutName = "";

  if (scoutId) {
    const scoutsCol = await scoutbookScouts();
    const scout = await scoutsCol.findOne({ userId: scoutId });
    scoutName = scout ? `${scout.firstName} ${scout.lastName}` : `userId ${scoutId}`;

    const reqCol = await scoutbookRequirements();
    const reqs = await reqCol.find({ userId: scoutId, advancementType: "rank", advancementId: rankId }).toArray();
    for (const r of reqs) {
      scoutReqs.set(r.reqNumber, {
        completed: r.completed,
        started: r.started,
        dateCompleted: r.dateCompleted,
      });
    }

    lines.push(`**Scout:** ${scoutName}\n`);
    const done = [...scoutReqs.values()].filter(r => r.completed).length;
    lines.push(`**Progress:** ${done}/${refs.length} requirements completed\n`);
  }

  for (const ref of refs) {
    const reqNum = ref.reqNumber || "";
    const status = scoutReqs.get(reqNum);
    const icon = status?.completed ? "✅" : status?.started ? "🔄" : "⬜";
    const dateStr = status?.dateCompleted ? ` (completed ${status.dateCompleted})` : "";

    lines.push(`${icon} **${reqNum}** ${ref.fullText}${dateStr}`);
  }

  return lines.join("\n");
}

export async function getMeritBadgeInfo(
  meritBadge: string,
  scoutId?: string
): Promise<string> {
  const db = await getDb();
  const refCol = db.collection("scoutbook_reference");

  // Find the MB by name (case-insensitive)
  const mbRef = await refCol.findOne({
    type: "merit_badge",
    name: { $regex: new RegExp(`^${meritBadge}$`, "i") },
  });

  if (!mbRef) return `Merit badge "${meritBadge}" not found in reference data.`;

  const lines: string[] = [
    `# ${mbRef.name} Merit Badge`,
    mbRef.isEagleRequired ? "**Eagle-Required: Yes**" : "**Eagle-Required: No**",
    `Category: ${mbRef.categoryName || "Unknown"}`,
  ];

  if (mbRef.description) lines.push(`\n${mbRef.description}`);
  if (mbRef.worksheetPDF) lines.push(`\nWorksheet: ${mbRef.worksheetPDF}`);

  // If scout specified, get their progress
  if (scoutId) {
    const scoutsCol = await scoutbookScouts();
    const scout = await scoutsCol.findOne({ userId: scoutId });
    const scoutName = scout ? `${scout.firstName} ${scout.lastName}` : scoutId;

    const advCol = db.collection("scoutbook_advancement");
    const progress = await advCol.findOne({
      userId: scoutId,
      type: "meritBadge",
      name: { $regex: new RegExp(`^${meritBadge}$`, "i") },
    });

    if (progress) {
      lines.push(`\n**${scoutName}'s Progress:** ${progress.percentCompleted}% | Status: ${progress.status}`);
      if (progress.dateStarted) lines.push(`Started: ${progress.dateStarted}`);
      if (progress.dateAwarded) lines.push(`Awarded: ${progress.dateAwarded}`);
    } else {
      lines.push(`\n**${scoutName}:** Not started`);
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Register both tools**

Add to `knowledgeTools.ts`:

```typescript
import { getRankRequirements, getMeritBadgeInfo } from "../../knowledge/reference.js";

// Inside registerKnowledgeTools():

server.registerTool("get_rank_requirements", {
  title: "Get Rank Requirements",
  description: "Get full requirement text for a BSA rank. Optionally shows a specific scout's completion status for each requirement.",
  inputSchema: {
    rank: z.string().describe("Rank name: scout, tenderfoot, second-class, first-class, star, life, eagle"),
    scoutId: z.string().optional().describe("BSA userId of a scout to show their completion status"),
  },
}, async ({ rank, scoutId }) => {
  const text = await getRankRequirements(rank, scoutId);
  return { content: [{ type: "text", text }] };
});

server.registerTool("get_merit_badge_info", {
  title: "Get Merit Badge Info",
  description: "Get merit badge details and requirements. Optionally shows a specific scout's progress.",
  inputSchema: {
    meritBadge: z.string().describe("Merit badge name, e.g. 'Camping', 'First Aid'"),
    scoutId: z.string().optional().describe("BSA userId of a scout to show their progress"),
  },
}, async ({ meritBadge, scoutId }) => {
  const text = await getMeritBadgeInfo(meritBadge, scoutId);
  return { content: [{ type: "text", text }] };
});
```

- [ ] **Step 3: Build + verify**

```bash
npx --prefix mcp-servers/scout-quest tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add mcp-servers/scout-quest/src/knowledge/reference.ts \
  mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts
git commit -m "feat: add get_rank_requirements and get_merit_badge_info MCP tools"
```

---

### Task 9: Build `get_troop_advancement_summary` + `suggest_meeting_activities` Tools

**Files:**
- Create: `mcp-servers/scout-quest/src/knowledge/meeting-planner.ts`
- Modify: `mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts`

- [ ] **Step 1: Write the meeting planner / advancement summary module**

```typescript
// mcp-servers/scout-quest/src/knowledge/meeting-planner.ts

import { scoutbookScouts, scoutbookRequirements, scoutbookAdvancement } from "../scoutbook/collections.js";

export async function getTroopAdvancementSummary(
  filters?: { rank?: string; eagleCandidatesOnly?: boolean }
): Promise<string> {
  const scoutsCol = await scoutbookScouts();
  const scouts = await scoutsCol.find({}).sort({ "currentRank.level": -1, lastName: 1 }).toArray();

  const advCol = await scoutbookAdvancement();
  const lines: string[] = ["# Troop Advancement Summary\n"];

  // Build summary table
  lines.push("| Scout | Age | Current Rank | Eagle MBs | Total MBs |");
  lines.push("|-------|-----|-------------|-----------|-----------|");

  for (const s of scouts) {
    if (filters?.rank && s.currentRank?.name?.toLowerCase() !== filters.rank.toLowerCase()) continue;

    const eagleMBs = await advCol.countDocuments({
      userId: s.userId, type: "meritBadge", isEagleRequired: true,
      $or: [{ status: "Awarded" }, { status: "Completed" }],
    });
    const totalMBs = await advCol.countDocuments({
      userId: s.userId, type: "meritBadge",
      $or: [{ status: "Awarded" }, { status: "Completed" }],
    });

    const rank = s.currentRank?.name || "None";
    lines.push(`| ${s.fullName} | ${s.age || "?"} | ${rank} | ${eagleMBs}/14 | ${totalMBs} |`);
  }

  return lines.join("\n");
}

export async function suggestMeetingActivities(
  durationMinutes: number,
  focus?: string
): Promise<string> {
  // Find the most-needed incomplete requirements across all scouts
  const reqCol = await scoutbookRequirements();
  const pipeline = [
    { $match: { completed: false, advancementType: "rank" } },
    { $group: { _id: { advancementId: "$advancementId", reqNumber: "$reqNumber", reqName: "$reqName" }, count: { $sum: 1 }, scouts: { $push: "$userId" } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ];

  const gaps = await reqCol.aggregate(pipeline).toArray();

  const lines: string[] = [
    `# Meeting Activity Suggestions (${durationMinutes} minutes)\n`,
    "## Requirements Most Scouts Need\n",
    "| Requirement | # Scouts | Rank |",
    "|-------------|----------|------|",
  ];

  const RANK_NAMES: Record<number, string> = { 1: "Scout", 2: "Tenderfoot", 3: "Second Class", 4: "First Class", 5: "Star", 6: "Life", 7: "Eagle" };

  for (const gap of gaps) {
    const rankName = RANK_NAMES[gap._id.advancementId] || `Rank ${gap._id.advancementId}`;
    lines.push(`| ${gap._id.reqNumber} ${gap._id.reqName} | ${gap.count} | ${rankName} |`);
  }

  lines.push(`\n## Suggested Activities\n`);
  lines.push(`Based on the ${durationMinutes}-minute timeframe, focus on discussion-based and skills-practice requirements that can be signed off at a meeting. Requirements needing camping, hiking, or extended home activities should be noted for future planning.`);

  return lines.join("\n");
}
```

- [ ] **Step 2: Register both tools in knowledgeTools.ts (guide + admin only)**

```typescript
// Add to knowledgeTools.ts — but only call from guide.ts and admin.ts, not scout.ts

export function registerAdvancementPlanningTools(server: McpServer): void {
  server.registerTool("get_troop_advancement_summary", { ... }, async ({ rank, eagleCandidatesOnly }) => { ... });
  server.registerTool("suggest_meeting_activities", { ... }, async ({ durationMinutes, focus }) => { ... });
}
```

- [ ] **Step 3: Register in guide.ts and admin.ts only**

```typescript
import { registerAdvancementPlanningTools } from "./tools/shared/knowledgeTools.js";
registerAdvancementPlanningTools(server);
```

- [ ] **Step 4: Build + verify**

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/scout-quest/src/knowledge/meeting-planner.ts \
  mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts \
  mcp-servers/scout-quest/src/guide.ts \
  mcp-servers/scout-quest/src/admin.ts
git commit -m "feat: add troop advancement summary and meeting activity suggestion tools"
```

---

### Task 10: Build `manage_troop_policy` Tool + Resources

**Files:**
- Create: `mcp-servers/scout-quest/src/knowledge/troop-policy.ts`
- Create: `mcp-servers/scout-quest/src/resources/troopPolicies.ts`
- Create: `mcp-servers/scout-quest/src/resources/rankGuide.ts`
- Modify: `mcp-servers/scout-quest/src/admin.ts`

- [ ] **Step 1: Write troop policy management**

```typescript
// mcp-servers/scout-quest/src/knowledge/troop-policy.ts

import { getPgPool } from "./pgvector.js";
import { embedText } from "./embeddings.js";

export async function addTroopPolicy(params: {
  content: string;
  category: string;
  scope?: string;
  relationship: "supplement" | "override" | "aspirational";
  bsaReference?: string;
  source?: string;
}): Promise<string> {
  const apiKey = process.env.GOOGLE_KEY;
  if (!apiKey) throw new Error("GOOGLE_KEY required");

  const embedding = await embedText(params.content, apiKey);
  const vec = `[${embedding.join(",")}]`;
  const pool = getPgPool();

  const { rows } = await pool.query(
    `INSERT INTO troop_customizations (content, embedding, category, scope, relationship, bsa_reference, source, created_by)
     VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [params.content, vec, params.category, params.scope, params.relationship, params.bsaReference, params.source, "admin"]
  );

  return `Troop policy added (id: ${rows[0].id}). Category: ${params.category}, Relationship: ${params.relationship}`;
}

export async function getAllTroopPolicies(): Promise<string> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT id, category, scope, content, priority, relationship, bsa_reference, source
     FROM troop_customizations
     WHERE troop_id = '2024'
     ORDER BY category, created_at`
  );

  if (rows.length === 0) return "No troop policies configured yet.";

  const lines: string[] = ["# Troop 2024 Policies & Customizations\n"];
  let currentCategory = "";

  for (const r of rows) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      lines.push(`\n## ${currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1)}\n`);
    }
    const tag = r.relationship === "override" ? "⚠️ OVERRIDE"
      : r.relationship === "aspirational" ? "🎯 JTE TARGET"
      : "ℹ️";
    lines.push(`${tag} ${r.content}`);
    if (r.bsa_reference) lines.push(`  ↳ BSA ref: ${r.bsa_reference}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Write rank-guide resource**

```typescript
// mcp-servers/scout-quest/src/resources/rankGuide.ts

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRankRequirements } from "../knowledge/reference.js";

export function registerRankGuideResource(server: McpServer): void {
  // For scout server: loads based on session identity
  // For guide/admin: parameterized template
  server.registerResourceTemplate(
    "rank-guide://{rank}",
    { title: "Rank Requirements Guide", description: "Full requirement text for a BSA rank" },
    async ({ rank }) => {
      const text = await getRankRequirements(rank);
      return { contents: [{ uri: `rank-guide://${rank}`, text, mimeType: "text/markdown" }] };
    }
  );

  server.registerResourceTemplate(
    "rank-guide://{rank}/{scoutId}",
    { title: "Scout Rank Progress", description: "Rank requirements with a specific scout's completion status" },
    async ({ rank, scoutId }) => {
      const text = await getRankRequirements(rank, scoutId);
      return { contents: [{ uri: `rank-guide://${rank}/${scoutId}`, text, mimeType: "text/markdown" }] };
    }
  );
}
```

- [ ] **Step 3: Write troop-policies resource**

```typescript
// mcp-servers/scout-quest/src/resources/troopPolicies.ts

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllTroopPolicies } from "../knowledge/troop-policy.js";

export function registerTroopPoliciesResource(server: McpServer): void {
  server.registerResource(
    "troop://policies",
    { title: "Troop Policies", description: "All Troop 2024 policies, customs, and JTE targets" },
    async () => {
      const text = await getAllTroopPolicies();
      return { contents: [{ uri: "troop://policies", text, mimeType: "text/markdown" }] };
    }
  );
}
```

- [ ] **Step 4: Register manage_troop_policy tool (admin only) and resources (all servers)**

```typescript
// In admin.ts:
import { registerTroopPolicyTool } from "./tools/shared/knowledgeTools.js";
registerTroopPolicyTool(server); // admin only

// In all three servers:
import { registerRankGuideResource } from "./resources/rankGuide.js";
import { registerTroopPoliciesResource } from "./resources/troopPolicies.js";
registerRankGuideResource(server);
registerTroopPoliciesResource(server);
```

- [ ] **Step 5: Build + verify**

```bash
npx --prefix mcp-servers/scout-quest tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add mcp-servers/scout-quest/src/knowledge/troop-policy.ts \
  mcp-servers/scout-quest/src/resources/rankGuide.ts \
  mcp-servers/scout-quest/src/resources/troopPolicies.ts \
  mcp-servers/scout-quest/src/tools/shared/knowledgeTools.ts \
  mcp-servers/scout-quest/src/scout.ts \
  mcp-servers/scout-quest/src/guide.ts \
  mcp-servers/scout-quest/src/admin.ts
git commit -m "feat: add troop policy management, rank guide resource, and troop policies resource"
```

---

## Chunk 3: Integration + Deployment (Tasks 11-13)

### Task 11: Update LibreChat System Prompts

Update model preset instructions to tell the AI to use the knowledge tools instead of training data.

**Files:**
- Modify: `config/scout-quest/librechat.yaml`
- Modify: `config/ai-chat/librechat.yaml`

- [ ] **Step 1: Add knowledge base instructions to scout-quest preset system prompts**

Add to each Scout Coach preset's system prompt:

```
IMPORTANT: For ANY question about BSA/Scouting America policies, rank requirements,
merit badge requirements, or troop procedures, you MUST use the search_scouting_knowledge
tool to look up the answer. Do NOT rely on your training data for BSA-specific information.
Use get_rank_requirements to show a scout their specific progress.
Use get_merit_badge_info for merit badge details.
```

- [ ] **Step 2: Add to ai-chat admin preset**

Add similar instructions plus:

```
Use get_troop_advancement_summary for troop-wide views.
Use suggest_meeting_activities when planning meetings.
Use manage_troop_policy to add/update troop-specific policies.
```

- [ ] **Step 3: Commit**

```bash
git add config/scout-quest/librechat.yaml config/ai-chat/librechat.yaml
git commit -m "feat: update LibreChat presets to use knowledge base tools"
```

---

### Task 12: Add Environment Variables

**Files:**
- Modify: `config/ai-chat/.env.example`
- Modify: `config/scout-quest/.env.example` (if exists)

- [ ] **Step 1: Add POSTGRES_URI and GOOGLE_KEY documentation to .env.example**

```
# =================================
# Scouting Knowledge Base (pgvector)
# =================================
POSTGRES_URI=postgresql://postgres@ai-chat-vectordb:5432/scouting_knowledge
GOOGLE_KEY=<your-google-api-key>
```

- [ ] **Step 2: Add the actual values to production .env via GCS**

```bash
./deploy-config.sh pull   # get current .env
# Edit to add POSTGRES_URI and verify GOOGLE_KEY
./deploy-config.sh push   # upload back
```

- [ ] **Step 3: Commit**

```bash
git add config/ai-chat/.env.example
git commit -m "chore: add POSTGRES_URI and GOOGLE_KEY to .env.example"
```

---

### Task 13: Build, Deploy, and Test End-to-End

**Files:**
- Modify: `mcp-servers/scout-quest/build.sh` (if needed)

- [ ] **Step 1: Build MCP server**

```bash
cd mcp-servers/scout-quest && bash build.sh
```

- [ ] **Step 2: Deploy to production VM**

```bash
./scripts/deploy-mcp.sh
```

Or manual: tar dist + node_modules, SCP to VM, restart containers.

- [ ] **Step 3: Verify pgvector is accessible from MCP server container**

```bash
./scripts/ssh-vm.sh "sudo docker exec ai-chat-api sh -c 'node -e \"const pg=require(\\\"pg\\\");const p=new pg.Pool({connectionString:\\\"postgresql://postgres@ai-chat-vectordb:5432/scouting_knowledge\\\"});p.query(\\\"SELECT count(*) FROM scouting_knowledge\\\").then(r=>console.log(r.rows[0]))\"'"
```

- [ ] **Step 4: Test in ai-chat**

Go to `ai-chat.hexapax.com`, open the Scout Admin preset, and ask:

1. "What are the Tenderfoot first aid requirements?"
2. "Show me William Bramwell's progress on Tenderfoot"
3. "What does BSA policy say about Boards of Review?"
4. "Which scouts need the most work on rank advancement?"
5. "Suggest activities for a 30-minute Tuesday meeting"

Verify the AI uses the tools and returns knowledge base content, not training data.

- [ ] **Step 5: Load troop policies from the extracted Google Drive data**

Ask the admin AI: "Load the following troop policies..." and use `manage_troop_policy` to add key policies from `docs/scouting-knowledge/troop/policies.md`.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: scouting knowledge base Phase 1+2 complete — deployed and tested"
```

---

## Phase 3-4 (Future — High Level Only)

### Phase 3: Vector Viewer + Strategy Content
- Port Three.js components from `~/git/navigator-v4-explorer`
- Build projection API (PCA/t-SNE from scikit-learn or JS equivalent)
- Curate strategy content (EDGE teaching methods, meeting activities, advancement hacks)
- Deploy viewer at `admin.hexapax.com/vectors`

### Phase 4: Scout Self-Service
- Validate accuracy with real scout questions
- Tune retrieval parameters
- Onboard 2-3 scouts
- Monitor and iterate
