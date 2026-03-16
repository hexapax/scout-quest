# Scouting Knowledge Base — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Author:** Jeremy Bramwell + Claude

## Overview

Build a hybrid knowledge architecture that gives every Scout Quest chat session (scout, guide, admin) authoritative access to Scouting America policies, rank/merit badge requirements, advancement strategies, and troop-specific customizations. The system replaces reliance on AI training data with a curated, versioned, searchable knowledge base backed by pgvector (semantic search) and MongoDB (structured advancement data).

### Goals

1. **Authoritative reference** — AI cites actual BSA policy text, not training-data recall
2. **Version-aware advancement** — correct requirement text for each scout's version (2016, 2022, 2024, etc.)
3. **Troop overlay** — troop-specific policies, procedures, and traditions layered on top of BSA standards
4. **Actionable planning** — suggest meeting activities, advancement strategies, and efficient paths based on real troop data
5. **Quality improvement** — surface gaps between troop practice and BSA/JTE standards
6. **Scout self-service** — eventually let scouts query the system directly with confidence in accuracy

### Non-Goals

- Real-time sync with BSA (policies change annually at most — batch refresh is fine)
- Full merit badge pamphlet text (copyright — we store requirements and summaries, not entire pamphlets)
- Replacing Scoutbook as the system of record (we mirror, not replace)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Content Sources                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Perplexity   │  │ Manual       │  │ Scoutbook API        │   │
│  │ Research     │  │ Curation     │  │ (Chrome CDP capture) │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         ▼                 ▼                      ▼               │
│  ┌─────────────────────────────┐    ┌────────────────────────┐   │
│  │ docs/scouting-knowledge/    │    │ MongoDB                │   │
│  │ (markdown files, git-tracked│    │ scoutbook_scouts       │   │
│  │  versioned, human-editable) │    │ scoutbook_advancement  │   │
│  └──────────┬──────────────────┘    │ scoutbook_requirements │   │
│             │                       │ scoutbook_reference    │   │
│             ▼                       └────────────┬───────────┘   │
│  ┌─────────────────────────────┐                 │               │
│  │ Embed Script                │                 │               │
│  │ (Gemini Embedding 2, 1536d)│                 │               │
│  └──────────┬──────────────────┘                 │               │
│             ▼                                    │               │
│  ┌─────────────────────────────┐                 │               │
│  │ pgvector                    │                 │               │
│  │ scouting_knowledge table    │                 │               │
│  │ troop_customizations table  │                 │               │
│  └──────────┬──────────────────┘                 │               │
│             │                                    │               │
│             ▼                                    ▼               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MCP Tools                                                │   │
│  │ search_scouting_knowledge  → pgvector semantic search    │   │
│  │ get_rank_requirements      → MongoDB + pgvector merge    │   │
│  │ get_merit_badge_info       → MongoDB + pgvector merge    │   │
│  │ get_troop_advancement_summary → MongoDB                  │   │
│  │ suggest_meeting_activities → pgvector + MongoDB           │   │
│  │ manage_troop_policy        → pgvector (admin only)       │   │
│  └──────────────────────────────────────────────────────────┘   │
│             │                                                    │
│             ▼                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Chat Sessions (scout, guide, admin)                       │   │
│  │ Every session has access to authoritative BSA knowledge,  │   │
│  │ troop policies, and real-time advancement data            │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Infrastructure

### pgvector Instance

pgvector is already deployed as Docker containers in both LibreChat stacks:
- `ai-chat-vectordb` — pgvector for the ai-chat instance
- `scout-quest-vectordb` — pgvector for the scout-quest instance

**Target instance:** `ai-chat-vectordb` — the scouting knowledge base lives here because:
1. The admin MCP server (which manages troop policies) runs on the ai-chat stack
2. Both scout-quest and ai-chat MCP servers can connect via Docker network or exposed port
3. Keeps knowledge data separate from LibreChat's internal RAG tables

**Connection:** The MCP servers connect using the `POSTGRES_URI` env var (to be added to `.env` files):
```
POSTGRES_URI=postgresql://postgres:${POSTGRES_PASSWORD}@ai-chat-vectordb:5432/scouting_knowledge
```

The `pgvector` extension must be enabled in the database:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### MongoDB Instance

The existing `ai-chat-mongodb` container hosts both the LibreChat database and the `scoutquest` database (where Scoutbook sync data already lives). The new `scoutbook_reference` collection goes in `scoutquest`.

---

## Data Model

### pgvector: `scouting_knowledge` table

Stores embedded chunks of BSA reference material for semantic search.

```sql
CREATE TABLE scouting_knowledge (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  category TEXT NOT NULL,             -- 'rank_requirement', 'merit_badge', 'policy',
                                      -- 'procedure', 'strategy', 'outdoor_standard'
  source TEXT,                        -- 'Guide to Advancement 2025', 'Scout Handbook 15th Ed', etc.
  section TEXT,                       -- '4.2.3.1', 'Tenderfoot Req 2a', etc.
  tags TEXT[],                        -- ['board-of-review', 'eagle', 'youth-protection']
  rank TEXT,                          -- 'tenderfoot', 'second-class', etc.
  merit_badge TEXT,                   -- 'camping', 'citizenship-community', etc.
  version TEXT,                       -- '2024', '2022', '2016', etc.
  effective_date DATE,                -- when this version took effect
  superseded_by TEXT,                 -- version that replaced this (null = current)
  metadata JSONB,                     -- flexible extra fields
  content_hash TEXT,                  -- SHA-256 of content for idempotent re-embedding
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON scouting_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX ON scouting_knowledge (category);
CREATE INDEX ON scouting_knowledge (version);
CREATE INDEX ON scouting_knowledge USING GIN (tags);
```

### pgvector: `troop_customizations` table

Troop-specific policies overlaid on BSA standards.

```sql
CREATE TABLE troop_customizations (
  id SERIAL PRIMARY KEY,
  troop_id TEXT NOT NULL DEFAULT '2024',
  category TEXT NOT NULL,             -- 'policy', 'procedure', 'tradition', 'schedule'
  scope TEXT,                         -- 'rank:tenderfoot', 'merit_badge:camping', 'bor', etc.
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  priority TEXT DEFAULT 'info',       -- 'required', 'recommended', 'info'
  relationship TEXT DEFAULT 'supplement',
                                      -- 'supplement' = adds to BSA policy
                                      -- 'override' = troop does it differently
                                      -- 'aspirational' = JTE target we're working toward
  bsa_reference TEXT,                 -- reference to the BSA policy this relates to
  related_policy_id INTEGER,          -- FK to another troop_customizations row (links override↔aspirational pairs)
  source TEXT,                        -- 'scoutmaster', 'committee', 'troop-bylaws'
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON troop_customizations USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX ON troop_customizations (troop_id, category);
```

### MongoDB: `scoutbook_reference` collection (NEW — to be created)

**Important:** This is a NEW collection, distinct from the existing `scoutbook_requirements` collection. The existing `scoutbook_requirements` stores per-scout completion status (userId + advancementId + reqId → completed/started/dateCompleted). The new `scoutbook_reference` stores the canonical requirement TEXT and metadata, independent of any scout — it's the "what does this requirement say" reference data.

```javascript
{
  type: "rank_requirement",       // or "merit_badge_requirement"
  rankId: 2,                      // or meritBadgeId
  rankName: "Tenderfoot",         // or merit badge name
  reqNumber: "4a",
  fullText: "Demonstrate first aid for the following: simple cuts and scrapes...",
  short: "First Aid",
  version: "2024",
  effectiveDate: "2024-01-01",
  supersededBy: null,             // null = current
  tips: "Use the buddy system to practice. Have scouts pair up...",
  previousNames: [],              // for renamed requirements
  syncedAt: ISODate()
}
```

Index: `{ type: 1, rankId: 1, reqNumber: 1, version: 1 }` (unique)

### Three-Tier Policy Precedence

When the AI answers questions, it follows this precedence:

1. **Troop current practice** (`relationship: 'override'`) — highest precedence for "what do we do?"
2. **BSA/Scouting America policy** (`scouting_knowledge` table) — authoritative standard
3. **JTE targets** (`relationship: 'aspirational'`) — improvement goals

For operational questions ("when do we do BORs?"), use **troop practice**.
For policy questions ("is a scout allowed to..."), cite **BSA policy** and note any troop deviation.
For improvement planning, reference **JTE targets** and show the gap.

---

## Content Sources & Collection

### Directory Structure

```
docs/scouting-knowledge/
  ranks/
    scout.md
    tenderfoot.md
    tenderfoot-2016.md              # superseded version kept for scouts on old track
    second-class.md
    first-class.md
    star.md
    life.md
    eagle.md
    eagle-2022.md                   # version with Citizenship in Society required
  merit-badges/
    camping.md
    citizenship-community.md
    citizenship-nation.md
    citizenship-society.md          # controversial — versioned, may not be Eagle-req
    citizenship-world.md
    communication.md
    cooking.md
    emergency-preparedness.md
    ...137 files total
  policies/
    guide-to-advancement/
      ch1-overview.md
      ch2-how-advancement-works.md
      ch3-duty-to-god.md
      ch4-tenderfoot-first-class.md
      ch5-star-life-eagle.md
      ch6-eagle-palms.md
      ch7-merit-badges.md
      ch8-boards-of-review.md
      ch9-appeals.md
      ch10-special-needs.md
      ch11-eagle-scout-service-project.md
    youth-protection.md             # current name: Mandatory Reporter Training
    safe-swim-defense.md
    safety-afloat.md
    trek-safely.md
    climb-on-safely.md
    shooting-sports.md
    weather-hazards.md
    tour-plan.md
  procedures/
    age-requirements.md
    time-in-rank.md
    alternate-requirements.md
    partial-completion.md
    blue-card-process.md
    board-of-review-procedures.md
    eagle-project-workbook.md
    eagle-required-merit-badges.md  # versioned — 2022 vs 2025 list
    scoutmaster-conference.md
    leadership-positions.md
  strategies/
    edge-method.md
    meeting-planning.md
    advancement-hacks.md
    campout-planning.md
    patrol-method.md
    new-scout-integration.md
    eagle-timeline-planning.md
    summer-camp-prep.md
  troop/
    policies.md
    traditions.md
    schedule.md
    jte-targets.md
```

### Markdown Frontmatter Format

Every markdown file includes YAML frontmatter for metadata extraction:

```yaml
---
category: rank_requirement
rank: tenderfoot
version: "2024"
effective_date: 2024-01-01
supersedes: "2016"
superseded_by: null
previous_names: []
tags: ["first-aid", "tenderfoot", "trail-to-first-class"]
source: "Scouts BSA Handbook, 15th Edition"
current_as_of: 2026-03-16
---
```

For policies with name changes:
```yaml
---
category: policy
title: Mandatory Reporter Training
previous_names:
  - "Youth Protection Training (YPT)"
  - "Youth Protection"
name_changed: 2025-09-01
tags: ["youth-protection", "mandatory", "training", "adult-leader"]
source: "Scouting America National Council"
current_as_of: 2026-03-16
---
```

### Research Process

1. **Automated research** via Perplexity MCP — batch script iterates through ranks, merit badges, policy topics, saves sourced responses as markdown drafts
2. **Manual review** — Scoutmaster reviews for accuracy, adds troop context
3. **Version tracking** — when BSA publishes changes, old version files are kept (marked `superseded_by`) and new version files are created
4. **Annual refresh** — each September (start of new scouting year), review all content for currency

---

## MCP Tools & Resources

### New Tools

#### `search_scouting_knowledge` (all servers)
```
Input:  query: string, category?: string, version?: string, limit?: number (default 5)
Output: Ranked results with: text, source, section, version, relevance score,
        plus any matching troop customizations (supplement/override/aspirational)
```
Semantic search over pgvector. Searches both `scouting_knowledge` and `troop_customizations` tables. Results presented as: BSA policy first, then troop overlay.

#### `get_rank_requirements` (all servers)
```
Input:  rank: string, scout_id?: string, version?: string
Output: Full requirement list with text from scoutbook_reference collection,
        per-scout completion status from scoutbook_requirements if scout_id provided,
        version mismatch warnings if scout is on an older requirement set
```
Merges reference text with live Scoutbook data. Version-aware: uses scout's `versionId` from advancement records.

#### `get_merit_badge_info` (all servers)
```
Input:  merit_badge: string, scout_id?: string
Output: MB description, full requirements, eagle-required flag (version-aware),
        scout's progress if scout_id provided
```

#### `get_troop_advancement_summary` (guide + admin)
```
Input:  filters?: { rank?, patrol?, eagle_candidates_only? }
Output: All scouts with: current rank, next rank %, Eagle MBs earned/needed,
        blocking requirements, recommended next steps
```

#### `suggest_meeting_activities` (guide + admin)
```
Input:  duration_minutes: number, focus?: string, available_leaders?: number
Output: 2-3 activity suggestions based on: which requirements most scouts need,
        what can be done in the time, strategies from knowledge base, troop customs
```

**Phase note:** This tool is delivered in Phase 2 but its strategy content comes in Phase 3. In Phase 2, the tool operates in **data-only mode**: it aggregates which rank/MB requirements are incomplete across the most scouts (from MongoDB), cross-references with requirement text (from `scoutbook_reference`), and suggests activities based on requirement clustering — without curated strategy content. In Phase 3, it additionally searches the `strategies/` knowledge base for teaching methods, EDGE examples, and activity ideas to enrich the suggestions.

The requirement-gap aggregation query: group `scoutbook_requirements` by `advancementId + reqNumber` where `completed = false`, count distinct `userId` per requirement, rank by count descending. This surfaces "which requirements do the most scouts still need" — the core input for meeting planning.

#### `manage_troop_policy` (admin only)
```
Input:  action: 'add' | 'update' | 'remove',
        content: string, category: string, scope?: string,
        relationship: 'supplement' | 'override' | 'aspirational',
        bsa_reference?: string
Output: Confirmation + stored policy. Embedding computed inline via Gemini Embedding 2.
```

### New/Updated Resources

#### `rank-guide` (all servers)
**On scout server:** An MCP resource (`scout://rank-guide`) that loads at session start with the current scout's next rank requirements (full text + completion status). Uses the scout's email to look up userId, then merges `scoutbook_reference` text with `scoutbook_requirements` completion data. No parameter needed — scout identity comes from the session.

**On guide/admin server:** An MCP resource template (`admin://rank-guide/{scout_id}`) — parameterized by scout userId. Returns the same merged view for any scout. Alternatively, the `get_rank_requirements` tool serves this purpose for ad-hoc queries; the resource is a convenience for pre-loading a specific scout's view.

#### `troop-policies` (all servers)
An MCP resource that loads at session start with all troop customizations from the `troop_customizations` table, organized by category. This ensures the AI knows troop-specific rules from the first message without needing a tool call.

#### `jte-gaps` (admin only)
An MCP resource that queries `troop_customizations` for all rows where `relationship = 'override'`, joined with their linked `aspirational` rows via `related_policy_id`. Each entry shows: the troop's current practice, the BSA reference it deviates from, and the JTE target (if one exists). If no aspirational row is linked, the gap is shown without a target.

### Server Registration

| Tool/Resource | Scout | Guide | Admin |
|---|---|---|---|
| `search_scouting_knowledge` | Yes | Yes | Yes |
| `get_rank_requirements` | Yes (own) | Yes (linked) | Yes (any) |
| `get_merit_badge_info` | Yes | Yes | Yes |
| `get_troop_advancement_summary` | No | Yes | Yes |
| `suggest_meeting_activities` | No | Yes | Yes |
| `manage_troop_policy` | No | No | Yes |
| `rank-guide` resource | Yes | Yes | Yes |
| `troop-policies` resource | Yes | Yes | Yes |
| `jte-gaps` resource | No | No | Yes |

---

## Embedding Pipeline

### Script: `scripts/embed-scouting-knowledge.mjs`

```
Read markdown files from docs/scouting-knowledge/
  → Parse YAML frontmatter (metadata)
  → Split body into ~500 token chunks with 50 token overlap
  → SHA-256 hash each chunk
  → Skip chunks with unchanged hash (idempotent)
  → Call Gemini Embedding 2 API (gemini-embedding-002, 1536 dimensions)
     using existing GOOGLE_KEY
  → Upsert into pgvector scouting_knowledge table
  → Report: chunks created/updated/skipped, tokens embedded, cost
```

### Embedding Configuration

| Parameter | Value | Rationale |
|---|---|---|
| Model | `gemini-embedding-002` | Multimodal, Matryoshka, hackathon alignment |
| Dimensions | 1536 | Good quality/storage balance, Matryoshka subset of 3072 |
| Chunk size | ~500 tokens | Standard for policy documents |
| Chunk overlap | 50 tokens | Preserves context at boundaries |
| API key | `GOOGLE_KEY` (existing) | Already configured in .env |
| Batch size | 100 chunks per API call | Conservative target; Gemini `batchEmbedContents` limit may differ. Script should handle `RESOURCE_EXHAUSTED` and fall back to smaller batches. |

### Estimated Numbers

| Metric | Value |
|---|---|
| Source content | ~600 pages |
| Chunks | ~1,200 |
| Total tokens | ~600K |
| Embedding cost | ~$0.12 (one-time) |
| pgvector storage | ~7MB |
| Embedding time | ~2 minutes |
| Re-embed cost | Pennies (only changed chunks) |

### Refresh Workflow

```bash
# Edit markdown files
vim docs/scouting-knowledge/policies/youth-protection.md

# Commit
git add docs/scouting-knowledge/ && git commit -m "update YPT → Mandatory Reporter Training"

# Re-embed (idempotent — only re-embeds changed chunks)
nvm exec 24 node scripts/embed-scouting-knowledge.mjs

# Verify
nvm exec 24 node scripts/test-knowledge-search.mjs "mandatory reporter training"
```

---

## Vector Cloud Viewer (Phase 3)

Adapted from `~/git/navigator-v4-explorer`.

### Architecture

```
pgvector (scouting_knowledge + troop_customizations)
  → Projection API (PCA/t-SNE → 2D/3D coordinates)
  → SSE streaming to frontend
  → Three.js 3D visualization + Canvas 2D scatter
```

### What It Shows

- Each point = one knowledge chunk
- Color by category: rank requirements (blue), merit badges (green), policies (amber), strategies (purple), troop customs (red)
- Clusters emerge from semantic similarity
- Click point → full text, source, version, troop overlays
- Search → matching chunks highlight in the cloud
- Filter by category, version, tags

### Components to Port from Navigator

| Navigator Component | Scout Quest Adaptation |
|---|---|
| `VectorSpace.tsx` | 3D Three.js scene with orbit controls |
| `VectorScatterPlot.tsx` | 2D Canvas with PCA/t-SNE |
| `projection_cache.py` | Projection cache in pgvector (or Node.js equivalent) |
| SSE streaming | Same pattern — stream points as they're projected |

### Deployment

- Static React build served by Caddy
- API endpoint on the admin server (or lightweight standalone service)
- Accessible at `admin.hexapax.com/vectors` or similar

---

## Phasing Plan

### Phase 1: Knowledge Base Foundation

1. Set up pgvector schema (tables + indexes)
2. Research & collect BSA content via Perplexity → markdown files
3. Build embedding pipeline script
4. Populate `scoutbook_reference` collection in MongoDB with full requirement text
5. Build & test `search_scouting_knowledge` MCP tool
6. Build `get_rank_requirements` with version-aware queries

**Delivers:** Authoritative BSA knowledge accessible to all chat sessions.

### Phase 2: MCP Integration & Troop Overlay

7. Build remaining MCP tools (MB info, troop summary, meeting activities, troop policy management)
8. Add resources to all three MCP servers
9. Update LibreChat preset system prompts — instruct AI to use tools instead of training data
10. Load initial troop customizations
11. Test end-to-end across scout, guide, admin sessions

**Delivers:** Full tool suite, troop-aware responses, meeting planning.

### Phase 3: Vector Viewer & Strategies

12. Curate strategies/activities/hacks content
13. Port Three.js viewer from navigator
14. Build projection API
15. Deploy viewer
16. Add JTE gap analysis

**Delivers:** Visual exploration, strategy content, quality improvement tools.

### Phase 4: Scout Self-Service

17. Validate accuracy with real scout questions
18. Tune retrieval (chunk size, reranking)
19. Conversational troop policy management
20. Onboard scouts

**Delivers:** Scouts using the system independently.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Vector store | pgvector (existing) | Already deployed, zero new infrastructure |
| Embedding model | Gemini Embedding 2, 1536d | Multimodal future, hackathon experience, cheap |
| Content source of truth | Git-tracked markdown files | Human-readable, version controlled, editable |
| Version handling | All versions kept, never deleted | Different scouts on different requirement versions |
| Troop overlay | Separate table with `relationship` field | Clean separation of BSA vs troop, enables gap analysis |
| Policy precedence | Troop practice > BSA policy > JTE targets | Reflects operational reality |
| Viewer | Ported from navigator-v4-explorer | Proven code, Three.js + PCA/t-SNE |
| MCP access | All tools on all servers (except admin-only management) | Everyone needs the knowledge |
