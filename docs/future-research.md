# Research & Constraints

This document is the **persistent research store** for the Scout Quest project. It captures integration research, cost analysis, platform constraints, and dead-end paths so that future sessions don't repeat work.

**Maintenance rule:** When a session discovers a new constraint, evaluates a new integration, or hits a dead end, update this document. Check this document before pursuing model routing, new integrations, or endpoint changes.

---

## Table of Contents

1. [LibreChat Endpoint & MCP Constraints](#librechat-endpoint--mcp-constraints)
2. [Cost Control & Model Strategy](#cost-control--model-strategy)
3. [Multi-Model Routing & Orchestration](#multi-model-routing--orchestration)
4. [External Integration Research](#external-integration-research)
5. [Dead Ends & Rejected Approaches](#dead-ends--rejected-approaches)

---

## LibreChat Endpoint & MCP Constraints

**Last updated:** 2026-02-21

### Endpoint Types

LibreChat has two fundamentally different endpoint categories that determine MCP tool support:

| Category | Endpoints | MCP Tools Work? | Notes |
|----------|-----------|-----------------|-------|
| **Native (built-in)** | `openAI`, `anthropic`, `google`, `bedrock`, `azureOpenAI` | Yes | Full function calling + MCP dropdown in chat UI |
| **Custom** | OpenRouter, DeepSeek, xAI/Grok (when configured under `endpoints.custom`) | **No** | Function calling NOT_PLANNED ([#4060](https://github.com/danny-avila/LibreChat/issues/4060)) |
| **Agents** | LibreChat Agents endpoint | Yes (best) | Autonomous tool selection, 95% data transfer reduction |

### Key Constraint: Custom Endpoints Cannot Use MCP Tools

This is the single most important constraint for model selection:

- **Function calling for custom endpoints is closed as NOT_PLANNED** by LibreChat maintainer ([issue #4060](https://github.com/danny-avila/LibreChat/issues/4060))
- Messages are **dropped from API requests** when MCP servers are selected on custom endpoints ([discussion #8890](https://github.com/danny-avila/LibreChat/discussions/8890))
- The MCP chat dropdown only appears for "traditional endpoints (OpenAI, Anthropic, Google, Bedrock)" per [official docs](https://www.librechat.ai/docs/features/mcp)
- **Implication:** Any model preset that needs MCP tools MUST use a native endpoint

### xAI/Grok Endpoint Status

LibreChat has **native xAI support** (not just custom endpoint). It can be configured as a pre-configured endpoint with `XAI_API_KEY` env var, pointing to `https://api.x.ai/v1`. However:

- **MCP support status with native xAI endpoint: UNVERIFIED** — xAI is listed in docs as a pre-configured endpoint, but it's unclear if it's in the same category as OpenAI/Anthropic/Google for MCP purposes. The MCP docs specifically list only "OpenAI, Anthropic, Google, Bedrock" as supported.
- **Recommendation:** Test before relying on it for tool use. If xAI native endpoint doesn't support MCP, Grok models can only be used for non-tool presets (Quick Chat, Deep Think equivalents).

### Current Model Presets (implemented 2026-02-21)

**Scout-Quest Instance** (scout-quest.hexapax.com — `enforce: true`, locked UI):

| Preset | Endpoint | Model | MCP Server | Status |
|--------|----------|-------|------------|--------|
| Scout Coach | `anthropic` (native) | claude-sonnet-4-6 | scout-quest | Configured |
| Scout Coach (Gemini) | `google` (native) | gemini-3-flash | scout-quest | Configured, needs GOOGLE_KEY |
| Scout Coach (GPT) | `openAI` (native) | gpt-4.1-mini | scout-quest | Configured |
| Quick Chat | `Deepseek` (custom) | deepseek-chat | None | OK — no tools needed |
| Deep Think | `Deepseek` (custom) | deepseek-reasoner | None | OK — no tools needed |
| Open Explorer | `OpenRouter` (custom) | llama-4-scout | None | Cannot use MCP tools |

**AI-Chat Instance** (ai-chat.hexapax.com — `enforce: false`, admin keeps full access):

| Preset | Endpoint | Model | MCP Server | Status |
|--------|----------|-------|------------|--------|
| Scout Admin | `anthropic` (native) | claude-sonnet-4-6 | scout-admin | Configured |
| Scout Admin (GPT) | `openAI` (native) | gpt-4.1 | scout-admin | Configured |

### Known Issue: Memory Agent + Claude Sonnet 4.6 Temperature

**Last updated:** 2026-02-21

LibreChat's memory agent (configured in `librechat.yaml`) throws `temperature is not supported when thinking is enabled` when using `claude-sonnet-4-6`. LibreChat appears to auto-enable extended thinking for Claude 4.x models, which conflicts with the temperature parameter. The memory agent still processes most requests but logs this error intermittently.

**Workaround options:**
1. Remove temperature from `model_parameters` (already done — LibreChat may still apply a default)
2. Switch memory agent to a non-thinking model (e.g., `claude-haiku-4-5-20251001`)
3. Wait for LibreChat to fix the temperature+thinking conflict

**Status:** Non-blocking — memory agent works despite the error.

### Agents Endpoint (Best MCP Support)

The Agents endpoint offers superior tool integration:
- Agents autonomously decide which tools to use
- Supports deferred/lazy-loaded tools via ToolSearch
- 95% reduction in data transfer (52 KB vs 1 MB per 1000 tokens)
- Fine-grained control over which specific tools are enabled per agent
- Introduced in LibreChat v0.7.6 (November 2024)
- Agent handoff feature exists (v0.8.1+) but has ~40% failure rate — beta quality

**Future consideration:** A LibreChat Agent-based "Scout Coach" could be more powerful than model spec presets, but Agents are configured through the UI (Agent Builder), not declaratively in YAML. This makes them harder to version-control and deploy reproducibly.

---

## Cost Control & Model Strategy

**Last updated:** 2026-02-21

### Model Pricing Comparison (per million tokens)

**Verified 2026-02-21** from [OpenAI pricing](https://pricepertoken.com/pricing-page/provider/openai), [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

#### MCP-Compatible Models (native LibreChat endpoints)

| Model | Endpoint | Input | Output | Tool Reliability | Notes |
|-------|----------|-------|--------|-----------------|-------|
| Claude Opus 4.6 | `anthropic` | $5.00 | $25.00 | Excellent | Top-tier reasoning, overkill for scout use |
| Claude Sonnet 4.6 | `anthropic` | $3.00 | $15.00 | Excellent | Primary Scout Coach — best character + tools |
| Claude Haiku 4.5 | `anthropic` | $1.00 | $5.00 | Good | Budget Claude, still reliable tools |
| GPT-4.1 | `openAI` | $2.00 | $8.00 | Excellent | 1M context, strong tool use. Used for Scout Admin |
| GPT-4o | `openAI` | $2.50 | $10.00 | Excellent | Multimodal (images), 128K context |
| GPT-4.1 mini | `openAI` | $0.40 | $1.60 | Good | Budget Scout Coach with tools |
| GPT-4o mini | `openAI` | $0.15 | $0.60 | Good | Very cheap, solid tools |
| GPT-4.1 nano | `openAI` | $0.10 | $0.40 | Decent | Ultra-budget, may struggle with complex tool chains |
| Gemini 3.1 Pro | `google` | $2.00 | $12.00 | Excellent | **Preview only.** Best agentic support, "thought signatures" |
| Gemini 3 Flash | `google` | $0.50 | $3.00 | Excellent | **Preview only.** Outperforms Gemini 3 Pro on Toolathlon benchmark |
| Gemini 2.5 Pro | `google` | $1.25 | $10.00 | Good | Stable/GA. Huge context (1M tokens) |
| Gemini 2.5 Flash | `google` | $0.15 | $0.60 | Good | Stable/GA. Cheapest stable tool-capable option |
| Gemini 2.5 Flash-Lite | `google` | $0.10 | $0.40 | Decent | Stable/GA. Cheapest Gemini overall |

#### Non-MCP Models (custom endpoints — general chat only)

| Model | Endpoint | Input | Output | Notes |
|-------|----------|-------|--------|-------|
| DeepSeek Chat | `Deepseek` (custom) | $0.14 | $0.28 | Quick Chat preset |
| DeepSeek Reasoner | `Deepseek` (custom) | $0.55 | $2.19 | Deep Think preset |
| Grok 4 Fast | xAI (unverified) | $0.20 | $0.50 | MCP support with native xAI endpoint unverified |

### Cost Tiers for Scout Quest

**Tier 1 — Primary (tool-capable, best quality):**
- Claude Sonnet 4.6: $3/$15 — best character voice, strongest tool use
- Used when: scout is working on merit badge requirements, needs coaching, quest progress

**Tier 2 — Budget with tools:**
- Gemini 3 Flash: $0.50/$3.00 — 6x cheaper than Claude, excellent tool use (preview)
- GPT-4.1 mini: $0.40/$1.60 — 8x cheaper than Claude, good tool use
- Used when: routine check-ins, chore logging, simple status queries

**Tier 3 — No tools needed:**
- DeepSeek Chat: $0.14/$0.28 — quick questions, brainstorming
- DeepSeek Reasoner: $0.55/$2.19 — math, logic, step-by-step reasoning
- Used when: homework help, general questions unrelated to quest

### Estimated Monthly Cost

Assuming ~30 sessions/month, ~15K input + 5K output tokens per session (includes tool calls):

| Model | Est. Cost/Session | Monthly (30 sessions) |
|-------|-------------------|----------------------|
| Claude Sonnet 4.6 | ~$0.12 | ~$3.60 |
| GPT-4.1 | ~$0.07 | ~$2.10 |
| Gemini 3 Flash | ~$0.02 | ~$0.65 |
| Claude Haiku 4.5 | ~$0.04 | ~$1.20 |
| GPT-4.1 mini | ~$0.01 | ~$0.40 |
| Gemini 2.5 Flash | ~$0.005 | ~$0.15 |
| GPT-4.1 nano | ~$0.004 | ~$0.12 |

**Conclusion:** Cost is not a significant concern at personal-use scale. Even all-Claude is about $3.60/month. The multi-model presets exist for **variety and capability testing**, not primarily cost savings. If this scales to multiple scouts in a troop, budget models could serve the whole troop for under $5/month total.

### Tool-Use Reliability Notes

**Verified 2026-02-21.**

- **Claude (all tiers):** Consistently best tool-use reliability. No known issues with multi-step tool chains.
- **GPT-4.1 / 4o family:** Excellent tool use. OpenAI has invested heavily in function calling since GPT-4. Mini and nano tiers are less tested but generally reliable for simple tool schemas.
- **Gemini 3 Flash:** Outperforms Gemini 3 Pro on tool-calling benchmarks ([Toolathlon](https://ai.google.dev/gemini-api/docs/gemini-3)). Excellent for agentic workflows. But see stability caveat below.
- **Gemini 3.1 Pro:** Introduces "thought signatures" — encrypted reasoning tokens passed back in conversation history to maintain context across multi-step tool calls. Most advanced agentic support from Google.
- **Gemini 2.5 Flash/Pro:** Good tool use, well-tested, stable/GA. Less capable than 3.x but no Preview risk.
- **DeepSeek V3:** 81.5% on function calling benchmarks vs Qwen Plus 96.5% ([issue #1108](https://github.com/deepseek-ai/DeepSeek-V3/issues/1108)). Poor at multi-turn function calling. When a tool returns an error, DeepSeek retries repeatedly instead of adapting. V3.1/V3.2 improved but still behind. **Doesn't matter for Scout Quest** — DeepSeek is a custom endpoint and can't use MCP tools anyway.

### Gemini 3.x Preview Stability Caveat

All Gemini 3.x models (3 Flash, 3 Pro, 3.1 Pro) are **Preview** status as of Feb 2026. This means:
- Google may change model behavior before GA
- Potential for deprecation with short notice
- Google recommends **temperature 1.0** for Gemini 3 models — lowering it may cause looping or degraded performance in complex tasks (this is unusual and differs from most other providers)
- Gemini 2.5.x models (Flash, Pro, Flash-Lite) are **Stable/GA** and don't carry this risk

**Decision:** Use Gemini 3 Flash as a Scout Coach preset despite Preview status. The tool-use quality is significantly better than 2.5 Flash, and if it degrades, the scout can switch to Claude or GPT presets. Monitor [Gemini release notes](https://ai.google.dev/gemini-api/docs/changelog) for GA status.

### Admin Instance (ai-chat) Cost

The admin instance is unrestricted and uses whatever models Jeremy selects. No cost control needed — it's personal use with full access to all providers.

---

## Multi-Model Routing & Orchestration

**Last updated:** 2026-02-21

### Approaches Evaluated

| Approach | How It Works | Status | Verdict |
|----------|-------------|--------|---------|
| **LibreChat Model Specs** | User picks preset from dropdown | Working | Current approach — simple, reliable |
| **LibreChat Agent Handoff** | One agent delegates to another | Beta (v0.8.1+) | ~40% failure rate, not production-ready |
| **LibreChat Agent Chains (MoA)** | Sequential agent pipeline | Available | Always executes ALL agents — no conditional routing |
| **OpenRouter Auto Router** | Routes `openrouter/auto` to best model | Available | Character consistency problem — different model each message |
| **OpenRouter Model Fallbacks** | Fallback chain on quota/error | Available | Good for resilience but custom endpoint = no MCP tools |
| **RouteLLM** | Open-source router (LMSYS/UC Berkeley) | Research-grade | Self-hosted, no LibreChat integration, not practical |
| **NVIDIA LLM Router** | Classifier-based routing | Academic | Not available as a product |

### Current Strategy: Manual Model Selection via Presets

The simplest approach that actually works:
1. Scout picks a "Scout Coach" preset (Claude, Gemini, or GPT) — all have MCP tools
2. Scout picks "Quick Chat" or "Deep Think" for non-tool conversations
3. No automatic routing — the scout (or parent) chooses based on need

**Why not automatic routing:**
- LibreChat doesn't support conditional model switching mid-conversation
- Agent handoff is too unreliable (~40% failure)
- Character voice consistency requires the same model throughout a conversation
- At personal-use scale, manual selection is fine

### Future: When to Revisit

Revisit automatic routing if:
- LibreChat Agent Handoff reaches stable quality (>95% success rate)
- LibreChat adds native model fallback support for built-in endpoints
- A scout is actively confused by having to choose presets
- Cost becomes a real concern (unlikely at personal scale)

---

## External Integration Research

**Last updated:** 2026-03-16

### Tier 1 — High Value, Low Cost

| Integration | What It Does | Value | Cost | Maturity | Status |
|-------------|-------------|-------|------|----------|--------|
| **Brave Search MCP** | Web search for hardware prices, BSA info | High | Free (2K queries/mo) | Production | Configured on devbox (2026-03-16) |
| **Perplexity MCP** | Research queries with citations | High | API cost (low) | Production | Configured on devbox (2026-03-16) |
| **Scouting Knowledge Base** | Semantic search over BSA policies + troop knowledge | High | Free (Gemini Embedding 2) | Design approved | Design spec: `docs/plans/2026-03-16-scouting-knowledge-base-design.md` |
| **QuickChart MCP** | Generate progress charts, budget graphs | Medium | Free | Production | Not yet integrated |

### Tier 2 — Moderate Value

| Integration | What It Does | Value | Cost | Maturity | Status |
|-------------|-------------|-------|------|----------|--------|
| **Google Sheets MCP** | Budget tracking in shared spreadsheet | Medium | Free | Beta | Parent visibility benefit |
| **Google Calendar MCP** | Counselor meetings, chore schedules | Medium | Free | Beta | Needs OAuth setup |

### Tier 3 — Lower Priority

| Integration | What It Does | Value | Cost | Maturity | Status |
|-------------|-------------|-------|------|----------|--------|
| **Firecrawl MCP** | Scrape PC part specs from retailer pages | Low-Med | $19/mo | Production | Expensive for occasional use |
| **Playwright MCP** | Browser automation for price checking | Low | Free | Beta | Complex, fragile |

### Not Recommended

| Integration | Why Not |
|-------------|---------|
| **Pinecone** | Overkill for single-scout — MongoDB text search is sufficient |
| **Notion** | Adds complexity without clear benefit over LibreChat's built-in memory |
| **E-commerce scrapers** | Fragile, break when sites change, TOS concerns |

---

## Dead Ends & Rejected Approaches

**Purpose:** Prevent future sessions from re-investigating paths that have been evaluated and rejected.

### iMessage Integration
**Status:** Not feasible (Feb 2026)
**Why rejected:** Apple has no public iMessage API. BlueBubbles/AirMessage require a dedicated Mac running 24/7. Beeper shut down iMessage support under Apple legal pressure.
**Decision:** Use ntfy.sh instead — free, works on iPad, zero infrastructure.
**Revisit if:** Apple opens a public messaging API.

### Custom Endpoints for Tool Use
**Status:** Dead end (Feb 2026)
**Why rejected:** LibreChat maintainer closed function calling for custom endpoints as NOT_PLANNED ([#4060](https://github.com/danny-avila/LibreChat/issues/4060)). Messages are dropped when MCP servers are selected on custom endpoints ([#8890](https://github.com/danny-avila/LibreChat/discussions/8890)).
**Implication:** OpenRouter and DeepSeek presets cannot use MCP tools. Only native endpoints (anthropic, openAI, google, bedrock) support MCP.
**Revisit if:** LibreChat reverses this decision or adds function calling to custom endpoints.

### OpenRouter for Model Fallback with Tools
**Status:** Dead end (Feb 2026)
**Why rejected:** OpenRouter is a custom endpoint in LibreChat. Even though OpenRouter supports function calling on its own API, LibreChat's custom endpoint layer doesn't pass tool calls through. Cannot be used as a fallback for tool-capable presets.
**Alternative:** Use multiple native endpoint presets (Claude + GPT-mini + Gemini) for tool-capable variety.

### Automatic Model Routing in LibreChat
**Status:** Not practical (Feb 2026)
**Why rejected:** No reliable mechanism exists in LibreChat for automatic model routing mid-conversation.
- Agent Handoff: ~40% failure rate
- Agent Chains: Always executes all agents (no conditional)
- OpenRouter Auto: Character consistency problem
- RouteLLM/NVIDIA Router: Academic, no LibreChat integration
**Alternative:** Manual preset selection by the scout. Simple and reliable.
**Revisit if:** LibreChat Agent Handoff stabilizes to >95% success rate.

### DeepSeek for Tool-Capable Presets
**Status:** Not viable (Feb 2026)
**Why rejected:** Two independent blockers:
1. **Custom endpoint** — LibreChat won't pass MCP tools to custom endpoints (see above)
2. **Poor tool reliability** — DeepSeek V3 scores 81.5% on function calling benchmarks vs 96.5% for competitors. Fails at multi-turn tool chains and retries endlessly on tool errors ([issue #1108](https://github.com/deepseek-ai/DeepSeek-V3/issues/1108))
**Decision:** Keep DeepSeek for non-tool presets (Quick Chat, Deep Think) where it excels at cheap general conversation and reasoning.
**Revisit if:** LibreChat adds custom endpoint function calling AND DeepSeek tool reliability improves above 95%.

### BSA Automated Authentication (my.scouting.org API)
**Status:** Broken (March 2026) — workaround available
**Last updated:** 2026-03-18
**What happened:** `POST my.scouting.org/api/users/{username}/authenticate` returns **503** from all sources (GCP VMs, residential IPs, WSL2). The endpoint was working on 2026-02-22 when we captured HAR files. The `advancements.scouting.org` frontend still works — you can log in via browser (the SPA uses a different auth flow or the WAF allows browser sessions).
**Impact:** The Scoutbook sync CLI (`cli.ts sync-all`) cannot authenticate. No automated/cron sync is possible.
**Workaround:** Manual Chrome login + Chrome DevTools Protocol token extraction. See `docs/scoutbook-data-refresh.md` for full procedure. This works reliably — JWT extracted from cookies via CDP, then used for direct API calls from Node.js.

**LibreChat token delivery options (evaluated 2026-03-18):**
The JWT lives in a cookie on `*.scouting.org` — cross-origin, so LibreChat can't read it directly. Options for getting the token to the MCP server:
| Option | Approach | Complexity | UX |
|--------|----------|------------|-----|
| **Bookmarklet** | User logs into BSA, clicks bookmarklet that POSTs token to MCP server endpoint | Low | One click after login |
| **Chrome extension** | Extension with `host_permissions` for `*.scouting.org` auto-extracts token | Medium | Seamless but requires extension install |
| **Admin panel page** | Auth page in admin panel — but cross-origin blocks cookie access | N/A | **Doesn't work** (Same-Origin Policy) |
| **CDP background service** | Local service connects to Chrome debug port, extracts token, pushes to MCP | Medium | Requires Chrome with debug port |

**Recommendation:** Bookmarklet is lowest-friction. MCP server needs a small HTTP endpoint to receive and store the token (with expiry tracking).
**Revisit if:** BSA auth endpoint starts returning 200, or BSA adds OAuth2/OIDC support.

### BSA Write API (Confirmed Working 2026-03-18)
**Status:** Fully mapped — 8 write endpoints confirmed via network interception
**Last updated:** 2026-03-18
**Full reference:** `docs/bsa-api-reference.md`
**Discovery method:** Chrome CDP network interception (`scripts/scoutbook/intercept-api.mjs`) while interacting with `advancements.scouting.org` UI.

All write endpoints use the same JWT bearer token as reads. No additional CSRF or auth required.

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/advancements/v2/youth/ranks/{rankId}/requirements` | POST | Mark requirements complete/approved (batch) |
| `/advancements/v2/users/{userId}/comments/add` | POST | Add comment to a requirement |
| `/advancements/v2/events/{eventId}/invitees` | PUT | RSVP to event (Y/M/N) |
| `/advancements/events/add` | POST | Create calendar event |
| `/advancements/v2/events/{eventId}/invitees` | POST | Add invitees to event |
| `/advancements/v2/{orgGuid}/email` | POST | Send email (uses memberId, not userId) |
| `/advancements/v2/activities/add` | POST | Create activity with per-person hours |
| `/advancements/v2/activities/{id}` | PUT | Update activity |

**Key findings:**
- Email uses `memberId` (not `userId`) for recipients
- Event creation is two-step: create → add invitees
- Activity recording includes per-person service hours via `activityValues`
- Requirement updates are batch — multiple scouts × multiple requirements in one call
- Raw intercept data: `scouting-org-research/data/api-intercept.json`

### Cloud Run Deployment
**Status:** Rejected (architecture decision)
**Why rejected:** LibreChat needs MongoDB + Redis as sidecars. MCP servers run as stdio subprocesses — doesn't map to Cloud Run's request model. Docker Compose is LibreChat's primary supported deployment path.
**Decision:** Single GCP VM (e2-medium) with Docker Compose.

### Firestore Instead of MongoDB
**Status:** Not considered seriously
**Why:** LibreChat requires MongoDB. Adding Firestore would mean maintaining two databases. MongoDB handles both LibreChat's data and the MCP server's quest data.

---

## Communication & Notification Strategy

**Last updated:** 2026-03-18

### Email Delivery Service (Researched 2026-03-18)

**Recommendation: Resend** — free tier (3,000/mo) covers troop volume (200/mo) with 15x headroom. TypeScript-native SDK, CC/BCC/Reply-To as first-class API params (perfect for YPT enforcement). 5-minute setup.

| Service | Free Tier | Cost @200/mo | Deliverability | Verdict |
|---------|-----------|-------------|----------------|---------|
| **Resend** | 3,000/mo forever | $0 | Good | **Recommended** |
| Brevo | 9,000/mo forever | $0 | Decent | Backup (marketing-heavy) |
| Mailgun | 3,000/mo forever | $0 | Poor (declining 2025) | Avoid |
| Amazon SES | 3,000/mo (12 mo only) | $0.02 | Variable | Too much setup |
| Postmark | 100/mo (dev only) | $15/mo | Best (98.7%) | Fallback if deliverability matters |
| SendGrid | None (trial only) | $19.95/mo | Poor (declining) | Avoid |

**Thread continuity pattern:** Use `Reply-To` headers + consistent From name:
```
From: "Jeremy via Scout Quest" <noreply@troop2024.scoutquest.app>
Reply-To: jeremy@gmail.com
CC: parent@example.com  (YPT enforced by backend)
```
Gmail/Outlook/Apple Mail all honor Reply-To for replies. Threading maintained via `Message-ID`/`References` headers, not From address.

**Revisit if:** Resend deliverability degrades. Switch to Postmark ($15/mo) as fallback.

### Notification Channel Strategy (Researched 2026-03-18)

**Context:** Troop lost significant parent engagement ("impressions") moving from TeamSnap to Scoutbook-only. TeamSnap push notifications were effective. Scoutbook SMS is truncated/terrible.

**Key insight:** TeamSnap worked because it was the *single source of truth* — schedule + notification + chat in one place. Multi-channel strategy can replicate this with each channel playing to its strength.

#### Recommended multi-channel approach:

| Message Type | Channel | Why |
|-------------|---------|-----|
| Weekly newsletter / detailed info | **Email (Resend, HTML)** | Rich content, persistent, universal |
| Event schedule | **Calendar subscription (ICS)** | Zero-effort, events just appear |
| Urgent changes | **ntfy.sh + GroupMe** | Immediate, high visibility |
| Day-of reminders | **Wallet pass** (future) | Lock screen, unobtrusive |
| Informal discussion | **GroupMe** | Two-way, SMS fallback, low barrier |

#### Channels evaluated:

| Channel | Cost/mo | Reach | Engagement | Annoyance | Verdict |
|---------|---------|-------|------------|-----------|---------|
| Email (HTML) | $0 | 95%+ | 40-60% open | Low | **Foundation — enhance with templates** |
| Calendar (ICS) | $0 | 80-90% | High (events) | Very low | **Implement — 3-5hr effort** |
| ntfy.sh | $0 | 40-60% | High | Low | **Keep — expand adoption** |
| GroupMe | $0 | 70-85% | 60-70% | Moderate | **Add — bot API for automation** |
| Wallet passes | $99/yr | 75-85% | High | Very low | **Future — highest TeamSnap replacement potential** |
| SMS (Twilio) | $10-40 | 95% | 98% open | HIGH | Reserve for emergencies only |
| Web/PWA push | $0 | 50-65% | Variable | Low | iOS too unreliable |
| WhatsApp | $15-40 | 40-60% | 90% | Moderate-high | Skip — incomplete US reach |

#### Wallet passes — the high-impact future investment:
Apple/Google Wallet passes are the closest thing to replicating TeamSnap's "always visible" quality:
- Persistent presence on every parent's phone
- Lock screen notifications on event updates (bypass most DND)
- Location-aware: auto-surfaces at meeting location
- Very low annoyance (contextual, not broadcast)
- Requires: $99/yr Apple Developer + 20-40hr development
- **Revisit when:** communication infrastructure is stable and multi-channel is working

#### Not recommended:
- **SMS/Twilio:** Too expensive ($10-40/mo), high annoyance, TCPA liability ($500-1500/message fines)
- **WhatsApp Business:** Only ~41% US penetration, awkward for scout troop
- **Discord:** Wrong audience, youth safety concerns
- **PWA Push:** iOS reliability genuinely poor — notifications fail silently after device restarts, require home-screen install
- **Gmail Actions/AMP:** Require 100+ emails/day to qualify — impossible at troop scale

---

## Research Process Notes

When conducting new research:
1. **Check this document first** — the answer or a dead-end may already be documented
2. **Update findings immediately** — don't wait for a "documentation phase"
3. **Include source links** — GitHub issues, docs pages, discussion threads
4. **Date your updates** — add "Last updated: YYYY-MM-DD" to section headers
5. **Be explicit about "revisit if"** — document what would change the decision
6. **Distinguish "won't work" from "not worth it"** — constraints vs. preferences
