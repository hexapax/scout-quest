# Scout-Quest Memory System Architecture

## Design Principles

**1. Knowledge is embodied, not retrieved.** The assistant should _be_ a knowledgeable Scoutmaster, not a Scoutmaster with a reference library. Core BSA policy, rank requirements, and merit badge requirements live in cached context — always present, zero latency, zero retrieval errors. The model never "searches" for whether a Scout can count a partial requirement.

**2. Tools are for actions, not knowledge.** MCP tools exist to _do things_ (read/write scout records, sync Scoutbook, send notifications). They never serve as the primary path for answering knowledge questions.

**3. Deep reference is supplemental, not foundational.** A semantic search layer exists for when the cached context doesn't have the answer — full merit badge pamphlet content, detailed safety procedures, meeting plans, game databases. This layer adds latency and should be the exception, not the default path.

**4. Self-hosted, low recurring cost, one-time API investment.** Monthly costs should be under $50 at troop scale. One-time corpus processing budget: $200-400 in API costs. Infrastructure runs on the existing GCP devbox.

**5. Version-aware from day one.** Scouts who started a merit badge under different requirement versions must be tracked correctly. The data model handles temporal versioning natively, not as an afterthought.

---

## The Three-Layer Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 1: EMBODIED KNOWLEDGE                  │
│              (Cached Context — always present, ~200K tokens)    │
│                                                                 │
│  Guide to Advancement (distilled)     Rank Requirements (all)  │
│  Guide to Safe Scouting (distilled)   MB Requirements Index    │
│  Youth Protection Policy              Advancement Procedures   │
│  Position-specific policies           Common edge cases        │
│                                                                 │
│  Cost: ~$0.03-0.06/query (cache hits)                          │
│  Latency: 0ms retrieval — it's just context                    │
│  Accuracy: highest — full document, no chunking artifacts      │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Model decides it needs
                    more depth on a topic
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  LAYER 2: DEEP REFERENCE SEARCH                 │
│          (Hybrid Vector + BM25 — on-demand, ~50-200ms)         │
│                                                                 │
│  Full merit badge pamphlet text    Meeting plan database       │
│  Detailed safety procedures        Game & activity library     │
│  Historical policy versions        Camping/outdoor guides      │
│  Counselor guidance materials      Training references         │
│                                                                 │
│  Cost: ~$0.001/query (local inference, no API)                 │
│  Latency: 50-200ms                                             │
│  Accuracy: high with contextual retrieval + reranking          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Structured traversal needed
                    (cross-refs, paths, versions)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 LAYER 3: KNOWLEDGE GRAPH                        │
│         (FalkorDB — structured relationships + versions)        │
│                                                                 │
│  Rank → Requirement → Activity relationships                   │
│  Merit Badge → Requirement → Skill Area mappings               │
│  Cross-references between requirements                         │
│  Version-aware requirement tracking (bitemporal)               │
│  Authority/provenance chains                                   │
│                                                                 │
│  Cost: ~$0/query (self-hosted, sub-ms traversal)               │
│  Latency: <10ms for graph traversals                           │
│  Best for: "what overlaps?", "what path?", "which version?"   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Embodied Knowledge — The Cached Context

### What goes in

This is NOT the raw BSA corpus stuffed into context. It is a **distilled, AI-optimized reference document** created by processing the full corpus through Claude and producing a carefully structured knowledge base. Think of it as the document a perfect Scoutmaster would write if asked to create the ultimate quick-reference guide from the full BSA library.

**Included content (~150-200K tokens target):**

| Section | Source | Estimated Tokens | Notes |
|---------|--------|-----------------|-------|
| Rank requirements (Scout through Eagle) | Scoutbook data + handbooks | ~15K | Full requirement text, all ranks |
| Merit badge requirements index | All 130+ badges, requirements only | ~40-50K | Requirements text, NO pamphlet content |
| Guide to Advancement (distilled) | Full G2A | ~30-40K | Policy substance preserved, procedural prose condensed |
| Guide to Safe Scouting (distilled) | Full G2SS | ~20-30K | All safety policies, activity-specific rules |
| Youth Protection policies | BSA YPT materials | ~5K | Non-negotiable rules, clearly marked |
| Advancement procedures & edge cases | G2A + tribal knowledge | ~15-20K | Extensions, partial completion, transfers, appeals |
| Position-specific guidance | Scoutmaster Handbook (distilled) | ~15-20K | Scoutmaster, ASM, committee, advancement chair roles |
| Common Q&A / edge cases | Synthesized from multiple sources | ~10K | The 50 most common policy questions, pre-answered |

### How to build it

This is the highest-value use of Claude API in the entire project.

**Step 1: Full document ingestion.** Feed each major BSA document (G2A, G2SS, Scoutmaster HB) into Claude Opus/Sonnet in its entirety (they fit in a single 200K context window). For each document, ask Claude to:

- Extract all policy statements with section references
- Identify all requirements, procedures, and rules
- Flag cross-references to other documents
- Note any content that has changed between editions
- Distill prose into concise, authoritative reference format

**Step 2: Synthesis pass.** Feed all the extracted content back into Claude and ask it to produce a single, unified reference document organized by topic (not by source document). This eliminates the redundancy between G2A, the Scoutmaster HB, and the various guides that repeat the same policies in different contexts.

**Step 3: Edge case enrichment.** Feed the synthesized document plus your own Scoutmaster experience back into Claude and ask: "What policy questions are NOT well-answered by this document? What edge cases would a new Scoutmaster encounter?" Use this to add a practical FAQ section.

**Step 4: Token budget optimization.** Measure the result. If it's over 200K tokens, prioritize ruthlessly — merit badge requirements take priority over pamphlet summaries, G2A policy takes priority over G2SS detail. The goal is the 200K tokens that answer the most queries without retrieval.

**Estimated API cost for Layer 1 construction: $30-60** (multiple Sonnet/Opus passes over ~500K tokens of source material, with generous output).

### How it's served

```python
# Simplified — the cached context is the first content block in every API call
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": BSA_KNOWLEDGE_DOCUMENT,  # ~150-200K tokens
                "cache_control": {"type": "ephemeral"}
            },
            {
                "type": "text",
                "text": scout_session_context  # dynamic per-scout state
            },
            {
                "type": "text",
                "text": user_message
            }
        ]
    }
]
```

With prompt caching, the BSA knowledge document is written to cache once (~$0.56 for 150K tokens on Sonnet) and then read at 90% discount on every subsequent query (~$0.045/query). Cache TTL is 5 minutes and auto-refreshes on each use — at troop scale with even modest usage, the cache stays warm.

### Maintenance

When BSA publishes updates, re-run the synthesis pipeline on the changed documents. Because the distilled document is version-controlled in git, you get diffs showing exactly what changed. Re-cache automatically on next query.

---

## Layer 2: Deep Reference Search — Hybrid Vector + BM25

### What goes in

Everything that's too large or too rarely needed for the cached context:

- Full merit badge pamphlet content (explanatory text beyond requirements)
- Detailed activity guides and procedures
- Meeting plan library and program resources
- Game and activity databases
- Historical policy versions (for version-aware queries)
- Training syllabi (IOLS, NYLT, Wood Badge references)
- Council-specific policies and procedures

### Technology choice: Self-hosted stack

**Embedding + search: pgvector on PostgreSQL** (already available on GCP, or run locally)

OR (recommended for simplicity):

**FalkorDB's native vector indexes** — since you're already running FalkorDB for the knowledge graph (Layer 3), using its built-in vector search avoids running a second database. FalkorDB supports HNSW vector indexes on node properties. You store embeddings directly on graph nodes, and vector search is a Cypher query:

```cypher
CALL db.idx.vector.queryNodes('mb_pamphlet_idx', 5, $query_embedding)
YIELD node, score
RETURN node.title, node.content, node.authority_level, score
```

**BM25 full-text search: FalkorDB's native full-text indexes** — same story, built-in:

```cypher
CALL db.idx.fulltext.queryNodes('content_idx', 'Eagle Scout extension deadline')
YIELD node, score
RETURN node.title, node.content, score
```

**This means Layers 2 and 3 share a single self-hosted database.** One Docker container running Redis + FalkorDB module, no monthly fees, no separate vector DB.

**Reranking: Self-hosted BGE-reranker-v2-m3** — runs on CPU, no GPU needed for BSA's query volume. Free, MIT licensed. Adds ~100-200ms but dramatically improves precision.

### Embedding model

**For corpus processing (one-time):** Use Voyage-3.5 via API ($0.06/MTok). For 5.6M tokens: ~$0.34 total. Not worth self-hosting for a one-time operation.

**For query-time embedding:** Either continue using Voyage API (negligible cost at troop query volume) or self-host a smaller model like `bge-base-en-v1.5` for zero ongoing cost. At 50-100 queries/day, even Voyage API costs are pennies.

### Chunking strategy

Different document types get different treatment (implemented during corpus processing):

| Document Type | Strategy | Chunk Size |
|---|---|---|
| MB pamphlets | Section-aware, requirements as discrete chunks | Req: 100-300 tok, Explanatory: 400-600 tok |
| Policy documents | Section-level with Contextual Retrieval | 512-1024 tok |
| Meeting plans / games | Whole document as single chunk with rich metadata | Varies |
| Safety procedures | Activity-specific sections, never split conditionals | 512-1024 tok |

**Contextual Retrieval applied to all chunks:** Before embedding, each chunk gets a context prefix generated by Claude Haiku (~$6 for the full corpus). This is the single highest-ROI technique in the entire pipeline.

### How Claude accesses it

A single MCP tool (or direct function in the API tool spec):

```json
{
  "name": "search_bsa_reference",
  "description": "Search the full BSA reference library for detailed information not in your core knowledge. Use ONLY when your built-in BSA knowledge doesn't have enough detail — for example, full merit badge pamphlet content, detailed activity procedures, or historical policy versions. Do NOT use for basic policy questions, rank requirements, or advancement procedures — you already know those.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "content_type": {
        "type": "string",
        "enum": ["merit_badge_pamphlet", "safety_procedure", "meeting_plan", "game_activity", "historical_policy", "any"]
      }
    },
    "required": ["query"]
  }
}
```

Note the description: it explicitly tells Claude when NOT to use it. This is the key to reducing unnecessary tool calls and latency.

---

## Layer 3: Knowledge Graph — FalkorDB

### Why a graph (not just vectors)

Three query patterns that vectors cannot serve well:

1. **Cross-referencing:** "What requirements overlap between Camping and Hiking merit badges?" — a graph traversal across shared `Activity` nodes.
2. **Path planning:** "What's the most efficient path to Eagle if this Scout has already completed these merit badges?" — a shortest-path algorithm on the rank/requirement graph.
3. **Version-aware advancement:** "Scout A started Cooking MB in January 2024. Scout B started in September 2025. Show me what each needs to complete." — temporal edges on `Requirement` nodes with `effective_date` and `superseded_date` properties.

### Schema design

```
Core Entities:
  Rank           — Scout, Tenderfoot, Second Class, ... Eagle
  MeritBadge     — 130+ badges with metadata (eagle_required, skill_area)
  Requirement    — Individual numbered requirements (e.g., "4a", "4b")
  Activity       — Discrete skills/actions (knot_tying, first_aid, fire_building)
  Document       — Source documents with authority level
  DocumentSection — Specific sections with version tracking
  RequirementVersion — Version-aware requirement text with effective dates

Relationships:
  (Rank)-[:HAS_REQUIREMENT]->(Requirement)
  (MeritBadge)-[:HAS_REQUIREMENT]->(Requirement)
  (Requirement)-[:INVOLVES_ACTIVITY]->(Activity)
  (Requirement)-[:CROSS_REFERENCES]->(Requirement)
  (Requirement)-[:PREREQUISITE_FOR]->(Requirement)
  (MeritBadge)-[:BELONGS_TO]->(SkillArea)
  (MeritBadge)-[:EAGLE_REQUIRED {as_of: date}]->()
  (Requirement)-[:SOURCED_FROM]->(DocumentSection)
  (DocumentSection)-[:PART_OF]->(Document)
  (RequirementVersion)-[:VERSION_OF]->(Requirement)
  (RequirementVersion)-[:EFFECTIVE {from: date, to: date | null}]->()

Scout-Specific (from Scoutbook sync):
  (Scout)-[:WORKING_ON {started: date, version_id: string}]->(MeritBadge)
  (Scout)-[:COMPLETED {date: date, signed_by: string}]->(Requirement)
  (Scout)-[:HOLDS_RANK {date: date}]->(Rank)
```

### Version-aware tracking (the hard problem)

This is the design that makes scout-quest genuinely valuable beyond a simple chatbot.

When a Scout starts a merit badge, the system records which version of the requirements was current at that time. The `RequirementVersion` nodes carry:

```
{
  requirement_id: "camping_9b",
  version: "2024.1",
  text: "Using a topographic map...",
  effective_from: "2024-01-01",
  effective_to: "2025-06-01",  // null if current
  changes_from_previous: "Added GPS navigation component"
}
```

When a Scout's advancement is queried, the system joins their `started` date on the `WORKING_ON` edge to the `RequirementVersion` effective dates:

```cypher
MATCH (s:Scout {id: $scout_id})-[w:WORKING_ON]->(mb:MeritBadge {name: "Camping"})
MATCH (mb)-[:HAS_REQUIREMENT]->(req:Requirement)
MATCH (rv:RequirementVersion)-[:VERSION_OF]->(req)
WHERE rv.effective_from <= w.started
  AND (rv.effective_to IS NULL OR rv.effective_to > w.started)
RETURN req.number, rv.text, rv.version
ORDER BY req.sort_order
```

This means the system can correctly tell Scout A (who started Camping in 2024) that they have different requirements than Scout B (who started in 2025), and track completion against the correct version for each.

### How to build the graph

**Step 1: Schema-guided extraction with Claude.** Process each BSA document through Sonnet/Opus with the schema above as a prompt template. For each document, Claude outputs structured JSON matching the schema — entities, relationships, and properties.

```
Estimated: 5.6M tokens input × ~1.5 (schema + instructions overhead)
           = ~8.4M tokens input, ~3M tokens output
Sonnet Batch API: (8.4 × $1.50) + (3 × $7.50) = ~$35
```

**Step 2: Human validation of 5-10%.** Spot-check extraction quality, especially on cross-references and version boundaries. Fix systematic errors and re-run problem documents.

**Step 3: Graph loading.** Parse JSON output, create Cypher `MERGE` statements, load into FalkorDB. A Python script handles this — maybe 200 lines of code.

**Step 4: Vector index creation.** For each content-bearing node (requirement text, pamphlet sections), generate embeddings and store as node properties. Create HNSW indexes.

### How Claude accesses it

Two focused MCP tools:

```json
{
  "name": "query_bsa_graph",
  "description": "Query the BSA knowledge graph for structured relationships: requirement overlaps between badges, advancement paths, prerequisite chains, cross-references between requirements, or version-specific requirement text for a scout who started a badge on a specific date. Do NOT use for general knowledge questions — use your built-in knowledge for those.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query_type": {
        "type": "string",
        "enum": [
          "requirement_overlap",
          "advancement_path",
          "version_lookup",
          "cross_references",
          "prerequisite_chain",
          "custom_cypher"
        ]
      },
      "parameters": {
        "type": "object",
        "description": "Query-specific parameters: badge names for overlap, scout_id + badge for version_lookup, etc."
      }
    },
    "required": ["query_type", "parameters"]
  }
}
```

```json
{
  "name": "get_scout_advancement",
  "description": "Get a scout's current advancement status: completed requirements, in-progress badges with version-correct requirement lists, rank progress, and upcoming milestones. This is the primary tool for answering 'where am I?' and 'what do I need next?' questions.",
  "input_schema": {
    "type": "object",
    "properties": {
      "scout_id": { "type": "string" },
      "scope": {
        "type": "string",
        "enum": ["overview", "specific_badge", "rank_progress", "full_detail"]
      },
      "badge_name": { "type": "string", "description": "Required if scope is specific_badge" }
    },
    "required": ["scout_id"]
  }
}
```

---

## Action Tools — Rationalized

The current tool set should consolidate around generic operations that don't proliferate with badge count.

### Scout-facing tools (target: 6-7)

| Tool | Purpose | Replaces |
|------|---------|----------|
| `log_requirement_work` | Record evidence/work for any requirement on any badge. Takes badge_id, requirement_id, evidence type + payload. Badge-specific validation lives in graph schema, not tool definition. | log_chore, log_budget_entry, log_diary_entry, setup_time_mgmt |
| `advance_requirement` | Move requirement to next status (kept as-is) | — |
| `get_my_status` | Scout views their own progress (combines with quest plan) | — |
| `update_my_goal` | Scout updates goal/preferences | update_quest_goal |
| `compose_email` | Email with YPT CC (kept as-is) | — |
| `send_notification` | Push notification (kept as-is) | — |
| `adjust_tone` | Adjust interaction style (kept as-is) | — |

`log_requirement_work` is the key consolidation. Instead of badge-specific tools that encode business logic in their parameter schemas, this tool accepts a flexible evidence payload and validates it against the knowledge graph:

```json
{
  "name": "log_requirement_work",
  "description": "Record completed work toward any merit badge or rank requirement. The system validates the evidence against the requirement's expected format using the knowledge graph. For chore logs, budget entries, diary entries, time management exercises — this is the single tool for all of them.",
  "input_schema": {
    "type": "object",
    "properties": {
      "badge_or_rank": { "type": "string" },
      "requirement_id": { "type": "string" },
      "evidence_type": {
        "type": "string",
        "enum": ["completion_note", "log_entry", "document", "checklist", "time_record", "budget_record", "discussion_summary"]
      },
      "evidence": {
        "type": "object",
        "description": "Flexible payload — structure depends on evidence_type and the specific requirement"
      },
      "date": { "type": "string", "format": "date" },
      "notes": { "type": "string" }
    },
    "required": ["badge_or_rank", "requirement_id", "evidence_type", "evidence"]
  }
}
```

The validation logic lives server-side, informed by the knowledge graph. When a scout logs work for Personal Management Req 2c, the server checks the graph for what that requirement expects (budget entries with specific fields) and validates accordingly. The model doesn't need to know the validation rules — it just needs to know it's logging work and what type of evidence to collect.

### Parent/Guide tools (target: 8-10)

Keep the onboarding, monitoring, and adjustment tools largely as-is, but:

- Replace badge-specific setup tools with a generic `setup_badge_tracking` that reads requirements from the graph
- Consolidate character/delegation/session preferences into a single `update_scout_preferences` tool

### Admin tools (target: 8-10)

Keep Scoutbook sync tools as-is — they're well-designed for their purpose. Add:

- `rebuild_knowledge_cache` — trigger a re-distillation of the cached context (for when BSA publishes updates)
- `validate_graph_integrity` — spot-check graph consistency after sync operations

---

## Infrastructure — What Runs Where

```
GCP Devbox (existing)
├── Docker: FalkorDB (Redis + FalkorDB module)
│   ├── Knowledge graph (Layer 3)
│   ├── Vector indexes on graph nodes (Layer 2 search)
│   └── Full-text indexes (Layer 2 BM25)
│
├── Docker: scout-quest MCP servers (existing, refactored)
│   ├── scout.js — scout-facing tools
│   ├── guide.js — parent-facing tools
│   └── admin.js — admin tools
│
├── Docker: BGE-reranker (optional, CPU-only)
│   └── Reranks search results before passing to Claude
│
├── MongoDB (existing) — scout session data, conversation logs, Scoutbook cache
│
└── Cloudflare Tunnel (existing) — exposes services

External APIs (pay-per-use, no monthly fees):
├── Anthropic API — Claude for chat + corpus processing
├── Voyage API — embeddings ($0.06/MTok, pennies at troop scale)
└── Scoutbook (scraped) — roster and advancement sync
```

### Monthly cost estimate at troop scale

| Component | Cost |
|-----------|------|
| GCP devbox (existing) | Already paid |
| FalkorDB | $0 (self-hosted) |
| BGE-reranker | $0 (self-hosted, CPU) |
| MongoDB | Already running |
| Claude API (50-100 queries/day, Sonnet, cached context) | $15-40/month |
| Voyage embeddings (query-time) | <$1/month |
| **Total incremental cost** | **$15-40/month** |

### One-time corpus processing budget

| Task | Model | Estimated Cost |
|------|-------|---------------|
| Layer 1: Distill cached context document | Sonnet/Opus | $30-60 |
| Layer 2: Contextual Retrieval chunk enrichment | Haiku Batch | $3-6 |
| Layer 2: Generate embeddings (Voyage) | Voyage-3.5 | $0.50 |
| Layer 3: Knowledge graph extraction | Sonnet Batch | $25-50 |
| Quality validation & re-processing | Sonnet | $20-40 |
| Fine-tune embeddings (optional, Phase 2) | Local GPU or Colab | $0-10 |
| **Total one-time** | | **$80-170** |

---

## Build Sequence

### Phase 1: Embodied Knowledge MVP (1-2 weeks)

**Goal:** Replace the current mixed context/tool knowledge approach with a high-quality cached context document. This immediately improves answer quality and reduces latency for policy questions.

1. Acquire/digitize core BSA documents (G2A, G2SS, Scoutmaster HB, rank requirements)
2. Run the distillation pipeline (Claude Opus/Sonnet, multiple passes)
3. Measure token count, optimize to fit ~200K budget
4. Implement prompt caching in the scout-quest API layer
5. Update system prompts to reflect that the model "knows" BSA policy
6. Remove any MCP tools that were serving as knowledge lookup
7. Test against a list of 50-100 representative policy questions

**Success metric:** The model answers policy questions correctly without tool calls, and response latency drops significantly.

### Phase 2: Knowledge Graph + Tool Rationalization (3-4 weeks)

**Goal:** Build the version-aware knowledge graph and consolidate action tools.

1. Stand up FalkorDB on the devbox (Docker, one container)
2. Design and validate the graph schema with sample data
3. Run the full corpus through the extraction pipeline (Sonnet Batch)
4. Load extracted data into FalkorDB
5. Build vector and full-text indexes on content nodes
6. Implement the `query_bsa_graph` and `get_scout_advancement` MCP tools
7. Refactor scout-facing tools: consolidate to the generic `log_requirement_work` pattern
8. Wire Scoutbook sync to populate `Scout`, `WORKING_ON`, and `COMPLETED` relationships
9. Test version-aware requirement tracking with real scout data

**Success metric:** The system correctly shows different requirement lists for scouts who started the same badge at different times. Tool call success rate improves. Scout-facing tool count drops from 11 to 6-7.

### Phase 3: Deep Reference Search (2-3 weeks)

**Goal:** Index the full BSA corpus for detailed retrieval beyond cached context.

1. Process all MB pamphlets through the chunking pipeline (document-type-specific)
2. Apply Contextual Retrieval to all chunks (Haiku Batch)
3. Generate embeddings (Voyage API, one-time)
4. Store chunks as nodes in FalkorDB with vector properties
5. Create HNSW vector indexes and full-text indexes
6. Implement hybrid search (vector + BM25 + RRF) as a Cypher query pattern
7. Optionally: stand up BGE-reranker for improved precision
8. Implement the `search_bsa_reference` MCP tool
9. Test with queries that require pamphlet-level detail

**Success metric:** The model correctly retrieves and cites specific pamphlet content for detailed questions, while still answering routine questions from cached context without retrieval.

### Phase 4: Polish + Scale Readiness (ongoing)

- Fine-tune embeddings on BSA-specific synthetic data (cheap, meaningful quality improvement)
- Build evaluation harness: automated testing of 200+ question/answer pairs
- Add agentic routing: model intelligently selects between layers based on query type
- Implement Anthropic Citations API for source attribution
- Add meeting plan and game databases to the reference search layer
- Build the `rebuild_knowledge_cache` admin tool for easy updates
- Document the system for potential BSA national handoff

---

## Open Questions to Resolve Before Building

1. **BSA corpus acquisition:** How will you get clean digital text of the full handbook/pamphlet library? PDFs? Scoutbook's data? This is the prerequisite for everything — we should dig into this next.

2. **Model selection for query time:** Sonnet 4.6 is the sweet spot for quality/cost, but Haiku 4.5 might be sufficient for straightforward queries (at 1/3 the cost). A routing layer that uses Haiku for simple questions and Sonnet for complex ones could reduce monthly API costs by 50%.

3. **Multi-scout context:** When the scout-facing agent is talking to Scout A, their specific advancement state needs to be in the dynamic context. How much per-scout state data is there? This affects the remaining context budget after the cached knowledge block.

4. **LibreChat vs. direct API:** You're currently running through LibreChat. Does the refactored architecture fit within LibreChat's MCP integration, or does the cached context + tool layering require a custom API wrapper?

5. **Scoutbook data freshness:** How often does the Scoutbook sync need to run? Real-time (webhook-like), daily, or on-demand? This affects whether the graph needs a sync daemon or just an admin trigger.
