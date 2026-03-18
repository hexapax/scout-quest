# Scout Quest v2 — Implementation Plan

**Status:** Approved
**Date:** 2026-03-18
**Architecture:** docs/plans/2026-03-18-architecture-v2.md
**Depends on:** BSA corpus acquisition (parallel workstream)

---

## Phase 0: Corpus Acquisition (parallel, 1-2 weeks)

Runs in parallel with Phases 1-2. Separate `bsa-corpus` private repo.

See: docs/plans/2026-03-18-corpus-acquisition-plan.md

**Deliverables:**
- [ ] Private `bsa-corpus` repo with directory structure
- [ ] Web scraper for scouting.org (G2A, G2SS, MB requirements, YPT)
- [ ] PDF extractor for downloadable BSA documents
- [ ] Structured requirements parser (markdown → YAML)
- [ ] Scoutbook data export (extend existing fetch-all-data.mjs)
- [ ] Source manifest with provenance tracking
- [ ] Extracted text for all Tier A (free) content

---

## Phase 1: Custom API Backend MVP (1-2 weeks)

**Goal:** LibreChat talks to the custom backend instead of directly to Anthropic. Cached BSA knowledge in every request. No tools yet — just knowledge + conversation.

### Tasks

**1.1 — Backend scaffold**
- [x] New directory: `backend/` with TypeScript + Express
- [x] OpenAI-compatible `/v1/chat/completions` endpoint
- [x] Request translation: OpenAI format → Anthropic format
- [x] Response translation: Anthropic format → OpenAI SSE format
- [x] Streaming proxy (Anthropic SSE → OpenAI SSE)
- [x] Docker container + compose integration

**1.2 — BSA knowledge injection**
- [x] Load distilled BSA knowledge document from disk on startup
- [x] Inject as `system[0]` with `cache_control: {type: "ephemeral"}`
- [x] Inject persona instructions as `system[1]`
- [ ] Verify cache metrics in Anthropic response headers (test on first deploy)

**1.3 — Per-scout context injection**
- [x] Map LibreChat user (from `X-User-Email` header) → scout profile in MongoDB
- [x] Load scout context: profile, active badges, upcoming events
- [x] Inject as `system[2]` (dynamic block after cached knowledge)

**1.4 — LibreChat configuration**
- [x] Add `ScoutCoachV2` custom endpoint in `config/scout-quest/librechat.yaml`
- [x] Create "Scout Coach v2" preset using the custom endpoint
- [x] Keep existing MCP presets working during migration (parallel operation)

**1.5 — Interim knowledge document**
- [x] Assembled from `docs/scouting-knowledge/` markdown files (40 files)
- [x] `scripts/assemble-knowledge.sh` for regeneration
- [x] 210K chars (~52K tokens) — within 50K target
- [ ] Expand when corpus pipeline delivers content

### Test
- Scout asks a BSA policy question → correct answer from cached knowledge, no tool call
- Cache metrics show hits after first request
- Streaming works in LibreChat UI
- Two different scouts get different context injections

---

## Phase 2: FalkorDB + Knowledge Graph (2-3 weeks)

**Goal:** Replace pgvector with FalkorDB. Build the version-aware knowledge graph. Enable graph-powered queries.

### Tasks

**2.1 — FalkorDB setup**
- [x] Docker container: `scout-quest-falkordb` (falkordb/falkordb:latest)
- [x] Docker compose integration + named volume `falkordb_data`
- [x] `backend/src/falkordb.ts` client using `redis` package + `sendCommand`
- [x] Graceful degradation: backend starts even if FalkorDB unavailable

**2.2 — Graph schema implementation**
- [x] Node types: `Scout`, `Advancement` (Rank+MeritBadge), `Requirement`
- [x] Relationship types: `HAS_ADVANCEMENT`, `HAS_REQUIREMENT`, `COMPLETED_REQ`, `STARTED_REQ`
- [ ] Cross-reference relationships (deferred — needs corpus content)
- [ ] RequirementVersion nodes (deferred — needs historical BSA data)

**2.3 — Data loading**
- [x] `backend/src/graph-loader.ts` — MongoDB scoutbook_* → FalkorDB
  - Scout nodes from scoutbook_scouts
  - Advancement nodes (deduplicated by advancementId) from scoutbook_advancement
  - Requirement nodes (deduplicated by reqId+advancementId) from scoutbook_requirements
  - Scout-Advancement edges (HAS_ADVANCEMENT with status/percent/dates)
  - Scout-Requirement edges (COMPLETED_REQ, STARTED_REQ)
  - Full-text index on Requirement(reqName, reqNumber)
- [x] `scripts/load-graph.sh` — runs loader inside backend container on VM
- [ ] Cross-references (deferred — corpus)
- [ ] Requirement version nodes (deferred — historical data)

**2.4 — Vector + full-text indexes**
- [x] Full-text index on Requirement.reqName + reqNumber (BM25)
- [ ] Vector indexes (deferred — needs corpus text chunks + Voyage embeddings)

**2.5 — Backend integration**
- [x] `backend/src/tools/definitions.ts` — `get_scout_status` + `search_bsa_reference` tool schemas
- [x] `backend/src/tools/get-scout-status.ts` — rank progress, rank requirements, merit badges, summary
- [x] `backend/src/tools/search-bsa-reference.ts` — FalkorDB full-text + knowledge doc fallback
- [x] `backend/src/tool-executor.ts` — resolves email→userId, dispatches tool calls
- [x] `backend/src/chat.ts` — tool execution loop (MAX_TOOL_TURNS=5), fake-stream final text

### Test
- Version-aware query: two scouts who started the same badge in different years see different requirements
- Cross-reference query: "what overlaps between Camping and Hiking?"
- Hybrid search: pamphlet-level detail retrieved correctly
- Graph integrity check passes

---

## Phase 3: Tool Refactoring + BSA Write API (2 weeks)

**Goal:** Consolidate tools per the critique. Add BSA write API support.

### Tasks

**3.1 — Tool consolidation**
- [ ] Implement `log_requirement_work` (generic evidence logging with graph validation)
- [ ] Implement `get_my_status` (read-only progress from graph)
- [ ] Remove badge-specific tools: log_chore, log_budget_entry, setup_time_mgmt, log_diary_entry
- [ ] Simplify `update_quest_plan` parameter schema (flatten nested objects)
- [ ] Update all tool descriptions: add "when NOT to use", add examples, constrain to 15-word param descriptions

**3.2 — BSA write API integration**
- [ ] BSA token management: bookmarklet → backend endpoint → stored with TTL
- [ ] Implement `advance_requirement` write-through to BSA API
- [ ] Implement `rsvp_event` tool (new)
- [ ] Implement `create_event` tool (new)
- [ ] Wire `compose_email` to BSA email API (in addition to / instead of direct SMTP)
- [ ] Implement `log_activity` for service hours recording

**3.3 — Guide tool consolidation**
- [ ] Consolidate 7 onboarding tools → 3 (setup_scout, setup_quest, set_character_preferences)
- [ ] Add `get_onboarding_status` read tool
- [ ] Add `get_scout_dashboard` read tool

**3.4 — Admin tool updates**
- [ ] Remove `scoutbook_get_rank_requirements` (redundant with cached knowledge)
- [ ] Add `rebuild_knowledge_cache` trigger
- [ ] Add `validate_graph_integrity` health check

### Test
- Scout logs chore → `log_requirement_work` with evidence_type="log_entry" → validated against graph
- Scout asks "where am I?" → `get_my_status` returns progress → no state mutation
- Requirement marked complete → written to both MongoDB and BSA API
- Tool call accuracy improves with reduced tool count

---

## Phase 4: Micro-Apps + Polish (2-3 weeks)

**Goal:** Build the email review micro-app as a template. Add remaining micro-apps as needed.

### Tasks

**4.1 — Pending action pattern**
- [ ] MongoDB collection for pending actions (type, payload, expires, status)
- [ ] `create_pending_action` tool in backend
- [ ] Backend API: GET /actions/:id, POST /actions/:id/execute, POST /actions/:id/cancel

**4.2 — Email micro-app**
- [ ] Static HTML page at `/email`
- [ ] Loads pending action by ID, renders email preview
- [ ] Edit, send, or cancel buttons
- [ ] YPT enforcement: parent CC non-negotiable, displayed prominently
- [ ] Confirmation screen after send

**4.3 — Progress micro-app**
- [ ] Static HTML page at `/progress`
- [ ] Visual rank progress (badges, requirements, percentages)
- [ ] Links back to chat for questions
- [ ] Read-only — data from backend API

**4.4 — Migrate existing functionality**
- [ ] Move remaining scout-facing tools from MCP to backend
- [ ] Remove MCP server configuration from LibreChat
- [ ] Retire MCP server Docker containers
- [ ] Update deployment scripts

### Test
- Agent composes email → link in chat → scout reviews → sends → confirmed
- Progress page shows correct advancement data
- Full conversation flow works without MCP servers

---

## Phase 5: Corpus Enrichment + Full Knowledge (ongoing)

**Goal:** Process the full BSA corpus through enrichment pipelines. Build the production 200K-token knowledge document.

### Tasks

- [ ] Run distillation pipeline (Claude Opus/Sonnet) on corpus → Layer 1 document
- [ ] Measure token count, optimize to 200K budget
- [ ] Run Contextual Retrieval (Haiku Batch) → enriched chunks for Layer 2
- [ ] Run graph extraction (Sonnet Batch) → structured entities for Layer 3
- [ ] Load enriched data into FalkorDB (vectors + graph nodes)
- [ ] Build evaluation harness (200+ Q&A pairs)
- [ ] Replace interim knowledge document with production version
- [ ] Validate against policy question test suite

---

## Migration Strategy

The existing MCP-based system continues running during migration. Each phase adds capabilities alongside the existing system:

1. **Phase 1:** New "Scout Coach v2" preset alongside existing presets. Both work.
2. **Phase 2-3:** Backend gains tools. Existing MCP tools still work for fallback.
3. **Phase 4:** Once backend handles all tool functions, retire MCP servers.

No big-bang cutover. Scouts can use either path during migration.

---

## Dependencies

```
Corpus Acquisition ──────────────────────────────────────────────┐
(parallel)                                                        │
                                                                  ▼
Phase 1: Backend MVP ──→ Phase 2: FalkorDB ──→ Phase 3: Tools ──→ Phase 5: Full Knowledge
                                                    │
                                                    ▼
                                              Phase 4: Micro-Apps
```

Phases 1 and Corpus Acquisition start immediately in parallel. Phase 5 requires both the corpus and the infrastructure from Phases 1-3.
