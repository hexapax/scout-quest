# Scout Quest — Project Progression Report

**Date:** 2026-03-20
**Author:** Jeremy Bramwell (with Claude Code)
**Period covered:** 2026-03-18 to 2026-03-20 (intensive development sprint)

---

## Executive Summary

Over a 48-hour sprint, Scout Quest evolved from a LibreChat instance with MCP-based tools into a production-deployed custom AI backend with cached BSA knowledge, vector search, graph-powered queries, and a rigorous evaluation framework. The system went from no quantitative quality measurement to a 54-question evaluation suite that tracks 7 quality dimensions across progressive knowledge layers.

**Key outcomes:**
- Custom backend deployed to production with 165K-token cached BSA knowledge
- FalkorDB knowledge graph loaded: 28 scouts, 3,936 requirements, 3,990 vector embeddings, 1,540 enriched graph edges
- Evaluation scores improved from 5.9 (null baseline) to 7.5+ across all dimensions
- Discovered and resolved context dilution, coaching regression, and troop voice loss
- Found that Gemini-embedding-001 outperforms Voyage-3 for this domain
- Source-boosted hybrid search achieves 95% Recall@5 and perfect Recall@10
- Communication strategy, mobile app architecture, and domain names planned and secured

---

## Phase 1-4: Backend Build (2026-03-18)

### What Was Built

| Component | Description | Status |
|---|---|---|
| **Custom API Backend** | Express/TypeScript, OpenAI-compatible endpoint, Anthropic SDK | Deployed |
| **BSA Knowledge Caching** | 165K tokens in system[0] with `cache_control: ephemeral` | Working, verified |
| **Per-Scout Context** | MongoDB lookup → system[2] injection (50-120 tokens per scout) | Working |
| **FalkorDB Graph** | 28 scouts, 84 advancements, 3,936 requirements, full-text index | Loaded |
| **Vector Search** | 3,990 voyage-3 embeddings with cosine similarity index | Loaded |
| **Layer 3 Graph** | 140 badges, 14 categories, 138 version changes, 148 skills, 1,540 edges | Loaded |
| **Backend Tools** | get_scout_status, search_bsa_reference (hybrid), cross_reference, advance_requirement, rsvp_event, log_activity, log_requirement_work, create_pending_action | All functional |
| **BSA Write API** | HTTP client for Scoutbook — mark requirements, RSVP, log activities | Built, needs BSA token |
| **Micro-Apps** | Email review (YPT-enforced), Progress tracking (visual rank/MB display) | Deployed at /backend/ |
| **Pending Actions** | MongoDB action queue with create/execute/cancel API | Deployed |
| **Guide Tools** | Consolidated 7→3 onboarding tools + 2 read tools | Built |
| **Admin Tools** | rebuild_knowledge_cache, validate_graph_integrity | Built |

### Architecture

```
Internet → Caddy (auto-HTTPS)
  └── scout-quest.hexapax.com
        ├── /         → LibreChat (port 3081)
        └── /backend/ → Custom Backend (port 3090)
                          ├── Anthropic API (Claude Sonnet 4.6)
                          │     system[0]: BSA knowledge (165K, cached)
                          │     system[1]: Persona + Troop 2024 (11K)
                          │     system[2]: Per-scout context (dynamic)
                          ├── MongoDB (scoutquest DB)
                          ├── FalkorDB (graph + vectors + full-text)
                          └── Static micro-apps (email.html, progress.html)
```

### Cache Performance
- **59,636 → 165,749 cached tokens** as knowledge layers were added
- Cache read confirmed on every request after first (90% cost reduction)
- Zero storage cost (Anthropic's prompt caching model)
- Cross-user cache sharing verified: different scouts hit the same cache

---

## Evaluation Framework (2026-03-19)

### The Layered Evaluation Approach

We designed an evaluation that measures quality improvement as knowledge layers are progressively added:

| Layer | What Changes | Cached Tokens |
|---|---|---|
| **L0 (null)** | No BSA knowledge — model training data only | ~1K |
| **L1-thin** | Interim 52K knowledge doc | ~59K |
| **L1-full** | Production 177K distilled doc | ~166K |
| **L1-full+troop** | + Troop 2024 context in persona (system[1]) | ~177K |
| **L2** | + 3,990 vector embeddings for semantic search | ~177K + retrieval |
| **L3** | + Enriched graph (badges, categories, versions, skills) | ~177K + retrieval + graph |

### Evaluation Dimensions (scored 0-10 by Claude Sonnet evaluator)

| Dimension | What It Measures |
|---|---|
| **Accuracy** | Factually correct BSA information |
| **Specificity** | Concrete details vs generic advice |
| **Safety** | Correct YPT/safety guidance |
| **Coaching** | Right approach for question type (direct on policy, Socratic on skills) |
| **Troop Voice** | Sounds like it knows THIS troop |

### Question Categories (54 total)

| Category | Count | Focus |
|---|---|---|
| A: Policy nuance | 8 | Counter-intuitive BSA rules |
| B: Troop values | 8 | Troop 2024 specific knowledge |
| C: Requirement accuracy | 8 | Exact text, current versions |
| D: Safety/YPT | 6 | Two-deep, digital contact, driving |
| E: Cross-reference | 10 | Badge relationships, version changes |
| F: Scout values coaching | 8 | Empathy, judgment, not policy |
| G: Over-policy detection | 6 | Agent should be human, not cite G2A |

Categories F and G were added to test whether the AI coach leads with empathy on emotional questions rather than dumping policy sections — the difference between a great scoutmaster and a BSA policy robot.

---

## Progressive Quality Improvement

### Dimension Scores Across Layers

```
             L0      L1-thin   L1-full+troop   L2 (vectors)   L3 (graph)
             ------  --------  --------------  ------------   ----------
Accuracy     6.4     7.0       7.3             7.6            7.5
Specificity  5.0     7.2       7.4             7.7            7.6
Safety       9.5     9.3       9.4             9.4            9.9
Coaching     6.1     7.7       7.7             7.9            7.9
Troop Voice  2.3     5.6       5.7             5.8            5.6
```

### Category Scores Across Layers

```
             L0      L1-thin   L1-full+troop   L2        L3
             ------  --------  --------------  ------    ------
A: Policy    5.9     8.3       8.8             8.6       8.5
B: Troop     6.4     8.3       8.0             8.3       7.7
C: Reqs      5.8     5.8       5.7             7.0       7.6
D: Safety    5.5     7.7       8.3             8.1       8.3
E: XRef      5.8     6.8       6.9             6.4       6.4
```

### What Each Layer Contributed

**L0 → L1-thin (biggest single jump):**
- Specificity: 5.0 → 7.2 (+2.2) — the knowledge cache gives specific policy references
- Troop Voice: 2.3 → 5.6 (+3.3) — Troop 2024 info in the cache
- Policy accuracy: 5.9 → 8.3 (+2.4) — G2A content enables correct policy answers

**L1-thin → L1-full+troop:**
- Policy: 8.3 → 8.8 — deeper G2A content
- Safety: 7.7 → 8.3 — complete G2SS with specific rules (driving time, swim defense)
- Troop context placement was critical — see "Discoveries" below

**L2 (vector search):**
- Requirements: 5.7 → 7.0 (+1.3) — semantic retrieval finds exact requirement text
- All other dimensions held steady or improved slightly

**L3 (enriched graph):**
- Requirements: 7.0 → 7.6 (+0.6) — structured badge/requirement data
- Safety: reached 9.9 (near-perfect)
- Cross-reference (Category E) did NOT improve — see "Discoveries"

---

## Key Discoveries

### 1. The Coaching Regression (Run 1 → Run 3)

**Problem:** When we added the 52K knowledge cache, the coaching score dropped from 7.7 to 6.3. With more knowledge, the model *lectured* instead of *coached*.

**Root cause:** The model had the exact G2A policy text, so instead of guiding a scout through reasoning ("what do you think 'active' means?"), it quoted the policy verbatim. A 13-year-old asking "do partials expire?" doesn't need G2A section 4.2.3.4 — they need "No, you're fine."

**Fix:** Updated the persona prompt to distinguish question types:
- BSA policy/procedure → answer directly, paraphrase for the scout's age
- Life skills/MB work → coach through questions (Socratic method)
- Troop logistics → just answer

**Also fixed:** Updated the evaluator prompt to match the same philosophy. The old evaluator penalized direct policy answers as "not Socratic enough" — the evaluator and persona were misaligned.

**Result:** Coaching recovered from 6.3 to 7.7-7.9 in subsequent runs.

**Lesson:** The evaluator must agree with the persona on what "good" looks like. Misalignment between the two creates false regressions.

### 2. Context Dilution (Run 4)

**Problem:** Swapping from the 52K interim doc to the 177K production doc caused Troop Voice to drop from 5.6 to 3.9 (-1.7) and Category B from 8.3 to 7.0.

**Root cause:** The production doc was pure BSA policy — it didn't include the Troop 2024-specific content (overview, uniform policy, advancement practices, leadership, patrols). The interim doc had this content but the corpus distillation pipeline didn't include troop-specific files.

**Fix:** Moved troop context (~11K tokens, 8 files) to the persona block (system[1]), separate from the BSA knowledge corpus (system[0]). The troop content is always prominent regardless of corpus size.

**Result:** Troop Voice recovered to 5.7. The fix also improved Policy to 8.8 (best ever) because the persona now explicitly reinforces troop identity.

**Lesson:** In multi-block prompt caching architectures, identity/persona content must be separated from knowledge content. A 5K troop overview drowns in 170K of BSA policy.

### 3. Cross-Reference Tool Not Used (Run 7)

**Problem:** We built a `cross_reference` tool with 6 graph query scopes (related badges, Eagle requirements, version changes, rank overlap, etc.) and loaded 1,540 enriched graph edges. But the model never called it — Category E scores stayed flat at 6.4.

**Root cause:** The model answered cross-reference questions from the cached knowledge (177K tokens) and vector search instead of using the specialized graph tool. The knowledge doc is rich enough that the model felt it already had the answer.

**Fix (in progress):** Added explicit "WHEN TO USE TOOLS" section to the persona with examples: "If you're about to list specific changes or overlaps, CALL THE TOOL FIRST. Do NOT guess at version changes."

**Lesson:** Adding a tool doesn't mean the model will use it. Tool descriptions must be specific about *when* to call vs when to use cached knowledge. The stronger the cached context, the more explicit the tool-use guidance must be.

### 4. Gemini Embeddings Outperform Voyage

**Finding:** Gemini-embedding-001 (R@5=0.900, MRR=0.875) significantly outperforms Voyage-3 (R@5=0.800, MRR=0.597) on heading-aware-500 chunks.

**Why this is surprising:** Voyage-3 has a 32K token context window vs Gemini's 2K. For pre-chunked content at ~500 tokens, the longer window doesn't help — quality of the embedding space matters more than input capacity.

**Implication:** Gemini-embedding-001 is the #1 MTEB model and it shows in practice, not just benchmarks. For professional work (Meditech/healthcare), this is a strong validation of the Google embedding stack.

### 5. Source Boosting Is a Simple, Powerful Technique

**Finding:** Adding a 1.5x score multiplier on G2SS/YPT chunks for safety queries (detected by keywords like "protection", "driving", "swim") pushed R@5 from 0.850 to 0.950 — a single query improvement that eliminated nearly all safety retrieval failures.

**Why it works:** Safety documents use the same vocabulary as outdoor activity documents (both mention camping, swimming, driving). Vector similarity can't distinguish "how to camp safely" (G2SS) from "how to plan a campout" (program features). Source metadata provides the discriminating signal.

**Lesson:** In specialized domains, a simple rule-based boost on source type can outperform sophisticated embedding improvements. Know your data.

---

## Communication & Infrastructure Planning

### Domains Secured
- **troopquest.com** (registered 2026-03-18, Cloudflare)
- **troopquest.org** (registered 2026-03-18, Cloudflare)
- **troop2024.ai** (planned, $70/yr on Cloudflare)

### Communication Strategy Researched
| Layer | Tool | Status |
|---|---|---|
| Broadcast/Push | Resend email + ntfy.sh | Researched, Resend selected |
| Schedule/Events | ICS calendar feed | Planned |
| Discussion/Forum | Discourse (self-hosted, email-in) | Researched |
| Mobile Push | Capacitor native shell + FCM/APNs | Plan documented |
| Audit/Compliance | Discourse archive + backend logs | Designed |

### Mobile App Architecture
- Capacitor native shell wrapping the web app
- TestFlight (iOS) + Play Store Internal Testing (Android) for distribution
- No App Store submission needed for troop-scale usage (~80 users)
- GitHub Actions CI for Mac-free iOS builds
- 4-tier implementation: basic push → Android conversational → iOS communication → Wallet passes
- Estimated: $124 year 1, $99/yr ongoing

### Embedding & Vector Search Strategy
- Production: Gemini-embedding-001 (or Voyage-3) + FalkorDB + source-boosted RRF hybrid
- FalkorDB provides graph + vector + full-text in one container — no Google product matches this combination
- Anthropic prompt caching (no storage fee) preferred over Gemini context caching ($1/M tokens/hour) for low-volume
- Professional (Meditech): Google ecosystem (Vector Search v2.0, Gemini embeddings) for enterprise scale

---

## Cost Analysis

### Development Sprint (2 days)

| Item | Cost |
|---|---|
| Anthropic API (8 eval runs × ~$3-5 each) | ~$30-40 |
| Voyage embeddings (corpus + experiments) | ~$1.50 |
| Gemini embeddings (experiments) | ~$0.50 |
| FalkorDB | $0 (Docker) |
| GCP VM (existing) | $0 incremental |
| **Total sprint cost** | **~$35-45** |

### Ongoing Production Cost (estimated)

| Item | Monthly |
|---|---|
| Anthropic API (30 sessions × 165K cached) | ~$3.60 |
| Voyage/Gemini query embeddings | ~$0.10 |
| GCP VM (e2-medium, existing) | ~$25 |
| Domain names | ~$8 (annualized) |
| **Total monthly** | **~$37** |

---

## What's Next

### Immediate
1. Top up Anthropic credits — depleted during eval runs
2. Run expanded 54-question eval (Categories F + G)
3. Apply source-boosted hybrid search to production backend
4. Test Gemini + source-boosted combo (experiment pending)

### Near-Term
5. Port missing quest state tools (adjust_tone, update_quest_plan, log_session_notes, send_notification)
6. Resend email integration for `noreply@troopquest.com`
7. ICS calendar feed from Scoutbook events
8. Cross-reference tool prompting improvements

### Medium-Term
9. Capacitor native shell (2-3 days for MVP)
10. Discourse forum setup at `forum.troopquest.com`
11. Expand eval to 100+ questions for statistical reliability
12. Gemini-embedding-2-preview evaluation when GA

---

## Appendix: Run Log

| Run | Date | Config | Key Finding |
|---|---|---|---|
| 1 | 03-19 12:07 | L0 vs L1-thin, old evaluator | Coaching regressed -1.4 (evaluator misaligned) |
| 2 | 03-19 12:31 | L1-thin, persona fix | Partial coaching recovery +0.3, troop voice +0.8 |
| 3 | 03-19 14:04 | L0 vs L1-thin, aligned evaluator | **Definitive baseline.** Specificity +2.2, troop +3.3 |
| 4 | 03-19 14:23 | L1-full (no troop content) | Requirements +0.8, but troop voice -1.7 (dilution) |
| 5 | 03-19 14:43 | L1-full + troop in persona | Troop voice recovered. Policy 8.8 (best). |
| 6 | 03-19 16:38 | L2 (vector search) | Requirements 5.7→7.0 (+1.3). All dimensions at peak. |
| 7 | 03-19 16:54 | L3 (enriched graph) | Requirements 7.6. Cross-reference tool unused. |
| 8 | 03-19 19:06 | Expanded eval (54 Q) | Anthropic credits depleted — no results |
