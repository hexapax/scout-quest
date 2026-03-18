# Scout Quest Architecture v2

**Status:** Approved
**Date:** 2026-03-18
**Supersedes:** MCP-only architecture (docs/plans/2026-02-21-mcp-server-redesign.md remains as historical reference)
**Source:** Refactor analysis from inbox/scout-quest-refactor/ + existing repo state + BSA write API discovery (2026-03-18)

---

## Overview

Scout Quest v2 adds a **custom API backend** between LibreChat and Anthropic that enables prompt caching (200K-token BSA knowledge), per-scout context injection, tool execution control, and micro-app handoffs. LibreChat remains the chat UI. FalkorDB replaces pgvector as the unified knowledge store (graph + vectors + full-text).

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          LIBRECHAT                                │
│  scout-quest.hexapax.com (scout/guide presets)                   │
│  ai-chat.hexapax.com (admin preset)                              │
│                                                                   │
│  Configured with OpenAI-compatible custom endpoint                │
│  pointing to the custom backend                                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │ OpenAI-format chat completions
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CUSTOM API BACKEND                             │
│  Node.js / TypeScript — runs on same VM                          │
│                                                                   │
│  1. Receive OpenAI-format request from LibreChat                 │
│  2. Identify persona + scout from auth context                   │
│  3. Construct Anthropic API payload:                             │
│     ┌──────────────────────────────────────────────────────┐     │
│     │ system[0]: BSA_KNOWLEDGE (200K tok, cache_control)   │     │
│     │ system[1]: AGENT_PERSONA (role-specific instructions)│     │
│     │ system[2]: SCOUT_CONTEXT (profile, active badges,    │     │
│     │            recent session notes — from MongoDB)       │     │
│     │ tools: [role-appropriate tool set]                    │     │
│     │ messages: [conversation from LibreChat]               │     │
│     └──────────────────────────────────────────────────────┘     │
│  4. Call Anthropic API with prompt caching                       │
│  5. Execute tool calls against FalkorDB / MongoDB / BSA API     │
│  6. Stream response back in OpenAI format                        │
└──────────────┬──────────────┬──────────────┬─────────────────────┘
               │              │              │
       ┌───────┘      ┌──────┘      ┌───────┘
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌──────────────┐
│  FalkorDB  │ │  MongoDB   │ │ BSA API      │
│            │ │            │ │              │
│ Knowledge  │ │ Scout      │ │ Scoutbook    │
│ graph      │ │ profiles   │ │ read/write   │
│ Vectors    │ │ Sessions   │ │ (via JWT)    │
│ Full-text  │ │ Quest data │ │              │
└────────────┘ └────────────┘ └──────────────┘

Optional (Phase 2+):
┌──────────────┐
│ Micro-apps   │
│ /email       │  Static HTML pages for actions
│ /progress    │  with consequences (send email,
│ /prep        │  mark requirement, RSVP)
└──────────────┘
```

## Three-Layer Knowledge System

| Layer | What | Where | Latency | Cost/Query |
|-------|------|-------|---------|------------|
| **1. Embodied** | Distilled BSA knowledge (200K tokens) — always in context | Anthropic prompt cache | 0ms retrieval | ~$0.04 (cache hit) |
| **2. Deep Reference** | Full pamphlet text, safety procedures, meeting plans | FalkorDB vector + BM25 | 50-200ms | ~$0 (self-hosted) |
| **3. Knowledge Graph** | Structured relationships, cross-refs, version-aware requirements | FalkorDB Cypher | <10ms | ~$0 (self-hosted) |

**Design principle:** Knowledge is embodied, not retrieved. The model *is* a knowledgeable Scoutmaster. Tools are for actions and personalized state, not for answering policy questions.

## Tool Rationalization

### Scout-Facing (11 → 7 tools)

| Tool | Action | Notes |
|------|--------|-------|
| `log_requirement_work` | **NEW** — generic evidence logging | Replaces log_chore, log_budget_entry, setup_time_mgmt, log_diary_entry |
| `get_my_status` | **NEW** — read-only progress check | Currently missing; most needed tool |
| `advance_requirement` | **KEEP** — refine description | Core state machine |
| `compose_email` | **KEEP** | YPT compliance critical |
| `send_notification` | **KEEP** | Simple, correct |
| `adjust_tone` | **KEEP** | Clean design |
| `update_quest_goal` | **KEEP** — simplify | Good scope |

**Removed:** `log_chore`, `log_budget_entry`, `setup_time_mgmt`, `log_diary_entry` (badge-specific, replaced by generic `log_requirement_work`)
**Kept but simplified:** `update_quest_plan` merged into backend session management, `log_session_notes` becomes automatic

### Guide-Facing (15 → 10 tools)

Consolidate 7 onboarding tools → 3 (`setup_scout`, `setup_quest`, `set_character_preferences`). Add `get_onboarding_status` and `get_scout_dashboard`.

### Admin-Facing (18 → 14 tools)

Keep sync tools. Remove `scoutbook_get_rank_requirements` (redundant with cached knowledge). Add `rebuild_knowledge_cache`, `validate_graph_integrity`.

## BSA Write API Integration

Newly discovered (2026-03-18) — the BSA API supports writes with the same JWT used for reads. Full reference: `docs/bsa-api-reference.md`.

| Capability | Endpoint | Integration Point |
|-----------|----------|------------------|
| Mark requirement complete | `POST /advancements/v2/youth/ranks/{rankId}/requirements` | `advance_requirement` tool |
| Add comment | `POST /advancements/v2/users/{userId}/comments/add` | `log_requirement_work` tool |
| RSVP to event | `PUT /advancements/v2/events/{eventId}/invitees` | New `rsvp_event` tool |
| Create event | `POST /advancements/events/add` | New `create_event` tool |
| Send email | `POST /advancements/v2/{orgGuid}/email` | `compose_email` tool |
| Record activity | `POST /advancements/v2/activities/add` | `log_requirement_work` tool |

**Auth flow:** Bookmarklet extracts JWT from BSA session cookie → POSTs to backend endpoint → stored with TTL for API calls.

## What Stays, What Changes, What's New

| Component | Decision | Rationale |
|-----------|----------|-----------|
| LibreChat instances | **KEEP** as UI layer | Handles chat, auth, history, file uploads |
| Custom API backend | **BUILD NEW** | Enables prompt caching, context injection, tool control |
| FalkorDB | **BUILD NEW** | Replaces pgvector; unifies graph + vectors + full-text |
| BSA knowledge doc (200K) | **BUILD NEW** | Requires corpus acquisition first |
| MCP tool implementations | **MIGRATE** to backend | TypeScript code reused, exposed through backend |
| pgvector knowledge base | **REPLACE** with FalkorDB | FalkorDB does everything pgvector does, plus graph |
| MongoDB quest state | **KEEP + EXTEND** | Add pending actions, preferences |
| Scoutbook sync (read) | **KEEP** | Working, 20 scouts loaded |
| Scoutbook write API | **BUILD NEW** | Requirement updates, events, email, RSVP |
| Admin panel | **KEEP** | MongoDB visibility |
| Micro-apps | **BUILD NEW (Phase 2+)** | After backend is working |
| bsa-corpus repo | **BUILD NEW** | Separate repo for source material |

## Infrastructure

All runs on existing GCP VM. New containers:

| Container | Purpose | Resources |
|-----------|---------|-----------|
| `scout-quest-backend` | Custom API (Node.js) | ~256MB RAM |
| `scout-quest-falkordb` | FalkorDB (Redis + module) | ~512MB RAM |
| `scout-quest-reranker` (optional) | BGE-reranker-v2-m3 | ~512MB RAM, CPU only |

## Monthly Cost at Troop Scale

| Component | Cost |
|-----------|------|
| Infrastructure (existing VM) | $0 incremental |
| FalkorDB, reranker (self-hosted) | $0 |
| Claude API (Sonnet, cached context, ~100 queries/day) | $15-40/month |
| Voyage embeddings (query-time) | <$1/month |
| **Total incremental** | **$15-40/month** |

## One-Time Corpus Processing Budget

| Task | Estimated Cost |
|------|---------------|
| Layer 1: Distill cached context (Sonnet/Opus) | $30-60 |
| Layer 2: Contextual Retrieval enrichment (Haiku Batch) | $3-6 |
| Layer 2: Embeddings (Voyage) | $0.50 |
| Layer 3: Knowledge graph extraction (Sonnet Batch) | $25-50 |
| Validation & re-processing | $20-40 |
| **Total one-time** | **$80-170** |
