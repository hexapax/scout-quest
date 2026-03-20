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
6. [Push Notification & Native App Shell Research](#push-notification--native-app-shell-research)
7. [Android Conversational Notifications in Capacitor](#android-conversational-notifications-in-capacitor)
8. [Embedding & Vector Search: Google Ecosystem vs Current Plan](#embedding--vector-search-google-ecosystem-vs-current-plan)

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

**Last updated:** 2026-03-20

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

### Discussion/Forum Platform (Researched 2026-03-18)

**Recommendation: Discourse (self-hosted) + Spond** — Discourse for persistent threaded discussions with email-in support; Spond for quick coordination, RSVPs, and day-of updates.

**Why Discourse:**
- Best-in-class email integration: parents can reply to email notifications and replies land in the correct thread on the web forum. No adoption barrier for email-only parents.
- Categories, pinning, search, trust levels — discussions don't get lost
- Full REST API for automation (backend can create topics, post announcements)
- YPT: group permissions enforce 2-adult visibility; scouts restricted to public categories
- Self-hosted (GPLv3) on existing GCP VM or $5/mo sidecar. Docker-based install.
- "Mailing list mode" makes it function as both web forum AND email list simultaneously

**Why not the alternatives:**
- **Slack:** 90-day history on free tier — decisions vanish. Paid = $830/mo for 95 users.
- **GroupMe:** Flat chat, no threading, poor UX.
- **Google Groups:** Weak web UI, no pinning/categories, "slightly better email" not "communication upgrade"
- **BAND:** Feed-based (not topic-based), planning discussions get buried under newer posts. Good for announcements/photos, weak for organized planning.
- **Circle / Mighty Networks:** $41-89/mo. Built for creator businesses.
- **Build your own:** Reply-via-email is very hard to build (MIME parsing, token matching, thread routing). Discourse spent years on this.
- **Groups.io Premium ($20/mo):** Viable runner-up if Discourse is too much overhead. Better Google Groups with calendar/polls/wiki. But no modern forum UI.

**Communication architecture (5-layer):**

| Layer | Tool | Handles |
|-------|------|---------|
| Broadcast/Push | ntfy.sh + Resend email | Announcements, reminders, urgent alerts |
| Schedule/Events | ICS calendar feed + Spond | Events appear in calendars, RSVPs |
| Discussion/Forum | Discourse (email-in) | Planning, decisions, persistent threads |
| Audit/Compliance | Discourse archive + backend logs | All scout-adult communication logged |
| AI Coaching | Scout Quest/Guide (if adopted) | Advancement coaching — enhancement, not dependency |

Layers 1-4 work independently of the AI assistant.

---

## Push Notification & Native App Shell Research

**Last updated:** 2026-03-18

**Context:** The existing notification stack (ntfy.sh + Resend email + GroupMe) works but ntfy requires parents to install a niche app, and iOS web push remains unreliable. The goal is reliable push notifications on iOS and Android that deep-link to specific pages in the web app, without building a full native app from scratch. Target audience: ~80 users (scouts + parents + leaders), volunteer-run troop.

### Executive Summary

**Recommended approach: Capacitor (Ionic) + FCM/APNs + OneSignal (optional)**

Capacitor is the clear winner for wrapping an existing Express/Node.js web app in a native shell with push notifications. It requires near-zero native code, has mature push + deep-linking plugins, and produces real App Store/Play Store apps. The main investment is App Store setup and compliance, not framework complexity.

PWA web push on iOS remains unreliable and should not be the primary push channel. Expo is overkill for a WebView wrapper. Tauri Mobile lacks production push notification support. TWA on Android is excellent but doesn't solve iOS.

### Approach 1: Capacitor (Ionic) — RECOMMENDED

**What it is:** Capacitor wraps your existing web app in a native WebView (WKWebView on iOS, Chromium WebView on Android) controlled by a bridge runtime. Your web app loads inside this shell and can call native APIs through JavaScript plugins. Unlike Cordova (its predecessor), Capacitor gives you full access to the native Xcode/Android Studio projects for customization.

**How it wraps the web app:**
- Config option 1: Point `serverUrl` at your production URL (e.g., `https://troopquest.com`) — the app loads your remote web app
- Config option 2: Bundle static assets locally via `webDir` — faster cold start but requires app update for web changes
- For development: point at `http://localhost:3000` for hot reload
- The Capacitor bridge injects `window.Capacitor` into the WebView, giving your JS code access to native plugins

**Push notifications (FCM + APNs):**
- Official plugin: `@capacitor/push-notifications` — unified JS API for both platforms
- Under the hood: FCM on Android, APNs on iOS (FCM handles APNs token translation)
- Setup: `npm install @capacitor/push-notifications && npx cap sync`
- iOS requires: Apple Developer account ($99/yr), APNs key (.p8 file), Firebase project
- Android requires: Firebase project, `google-services.json` in Android project
- iOS opt-in rates: 29-73% (median ~51% in 2025). Android: 81-95%. iOS requires earning permission with clear value proposition.
- Reliability: Excellent — native APNs delivery, same as any native iOS app
- Rich notifications: images, action buttons, custom sounds, badges — all supported
- Background/silent notifications supported with `UIBackgroundModes` config
- Pro tip: Use APNs Certificates (.p12) not Authentication Keys for more reliable delivery via Firebase Console

**Deep linking from push notifications:**
- `pushNotificationActionPerformed` event fires when user taps notification
- Notification payload carries custom data (e.g., `{ url: "/quest/camping-merit-badge" }`)
- Your JS code extracts the URL and navigates via your router (works with any framework — vanilla JS, React, Vue)
- Also supports Universal Links (iOS) and App Links (Android) for links from email/web
- Requires server-side config: `.well-known/apple-app-site-association` (iOS) and `assetlinks.json` (Android) — both served from your Express backend

**Native code required:** Near zero for the base case.
- Push notifications: zero custom native code (plugin handles everything)
- Deep linking: zero custom native code (plugin + config files)
- Custom features (NFC, Wallet): community plugins exist, may need small native wrappers
- Only need Swift/Kotlin if building features with no existing plugin

**Wallet passes / NFC:**
- Apple Wallet: `capacitor-pass-to-wallet` plugin — download .pkpass, base64 encode, call `addToWallet()`. Need backend to generate signed .pkpass files (use `passkit-generator` npm package). Requires Apple Developer certificate.
- NFC: `@exxili/capacitor-nfc` community plugin — read/write NDEF tags. Requires NFC entitlement in provisioning profile.
- Google Wallet: Less mature plugin ecosystem, but Google Wallet passes can be added via URL scheme

**Setup time estimate (solo developer):**
- Prerequisites (Xcode + Android Studio installed): 2-4 hours one-time
- Capacitor project init + config: 1-2 hours
- Push notification setup (Firebase + APNs): 2-4 hours
- Deep linking config + testing: 2-3 hours
- App Store/Play Store submission prep: 4-8 hours (screenshots, descriptions, privacy policy, review notes)
- **Total to first working app: 2-3 days**

**App Store submission complexity:**
- Apple requires $99/yr developer account
- Google requires $25 one-time developer account
- Guideline 4.2 (Minimum Functionality) is the biggest Apple risk for WebView apps — Apple rejects "web wrapper" apps that add nothing beyond Safari
- To pass review: must include push notifications, native navigation elements (tab bar), offline capability, and at least one native feature (camera, biometrics, etc.)
- Push notifications alone are often sufficient as "native value add" — Safari on iOS doesn't support web push reliably, so this is a genuine native-only feature
- For youth apps: must set correct age rating, comply with COPPA if collecting data from under-13s
- **COPPA exemption for nonprofits:** COPPA expressly exempts nonprofit entities not subject to Section 5 of the FTC Act. A volunteer-run Scout troop app operated by a 501(c)(3) council is likely exempt, but should still follow best practices for data minimization.
- New state laws (App Store Accountability Acts — Utah May 2026, Louisiana July 2026, Texas, California): app stores will share verified age categories with developers. Apps for minors may face additional review scrutiny.
- Initial Apple review: typically 24-48 hours (90% reviewed in <24h), but youth-focused apps may take longer
- Subsequent updates: same review process, but usually faster

**Ongoing maintenance:**
- Capacitor version updates: ~1-2 times/year, usually non-breaking
- iOS/Android SDK updates: annual (each fall with new OS release)
- Push certificate renewal: APNs keys don't expire; APNs certificates expire annually
- Low maintenance overall — web app changes deploy instantly (if using remote URL), native shell updates only needed for Capacitor/OS updates

**Cost:**
- Apple Developer: $99/yr
- Google Play Developer: $25 one-time
- Firebase: free (FCM is free, no limits)
- OneSignal (optional): free tier covers unlimited mobile push subscribers
- **Total recurring: $99/yr** (just Apple)

### Approach 2: Expo (React Native Wrapper) — NOT RECOMMENDED

**What it is:** Expo is a framework and platform for React Native apps. It can embed a WebView, but it's architecturally designed for building React Native UIs, not wrapping existing web apps.

**Can it wrap an existing web app?** Technically yes, via `react-native-webview`, but:
- You must create a React Native app that hosts a WebView component — you can't just point Expo at a URL
- The WebView is isolated from Expo's native plugins — you need manual `postMessage`/`onMessage` bridges
- Push notifications (`expo-notifications`) work in the React Native layer, not inside the WebView
- To deep-link from a notification into your web app, you must: receive notification in RN layer -> extract URL -> inject JavaScript into WebView -> navigate. This is fragile.

**Push notification support:**
- `expo-notifications` library: comprehensive, well-documented
- But: cannot be tested in Expo Go (development app) — must build production APK/IPA to test
- This kills development velocity for notification features

**Why it's overkill:**
- Expo's value is React Native UI components, routing, and the managed build service
- If your app is 100% web content in a WebView, you're paying Expo's complexity tax for no benefit
- Capacitor is purpose-built for this exact "web app in native shell" use case
- Expo adds: React Native dependency, Metro bundler, EAS Build service, and a React Native project structure — all unnecessary for a WebView wrapper

**Setup time:** 2-4 days (more than Capacitor due to React Native overhead)
**Verdict:** Use Expo if you're building a React Native app. Don't use it to wrap an existing web app.

### Approach 3: PWA + Firebase Cloud Messaging (No Native Shell) — UNRELIABLE ON iOS

**Current state of iOS web push (2025-2026):**
- Safari 16.4 (March 2023) added Web Push API support for PWAs added to Home Screen
- FCM **cannot directly deliver push messages to Safari** — Safari uses Apple Push Notification Service with its own implementation, separate from how FCM works on Chrome/Android
- Workaround services (OneSignal, PushEngage) have built custom bridges but reliability is inconsistent
- iOS web push requires: (1) HTTPS, (2) Service Worker, (3) user must add PWA to Home Screen first, (4) user must grant permission from within the installed PWA
- The "add to Home Screen" requirement is a huge adoption barrier — most users don't know how
- After device restart, iOS may not re-register the Service Worker, causing silent notification failure
- No badge API on iOS (can't show notification count on app icon)
- Permission persistence is unreliable across Safari sessions
- iOS Service Workers have stricter memory/execution limits than Android

**Real-world reliability:**
- iOS web push delivery: estimated 60-75% of native push reliability (based on developer reports)
- Opt-in rates: much lower than native due to the Home Screen install requirement
- Silent failures are common — no error, notification just doesn't arrive
- Apple's implementation diverges from the WHATWG spec in ways that break common patterns

**Rich notifications on iOS:**
- Action buttons: not reliably supported on iOS web push
- Images: limited/unreliable
- Deep linking: works on Android (Service Worker `clients.openWindow(url)`), unreliable on iOS

**What works well:**
- Android Chrome: FCM web push is excellent — reliable delivery, rich notifications, deep linking
- Desktop browsers: generally reliable across Chrome, Firefox, Edge

**Verdict:** PWA web push is not viable as the primary notification channel for iOS. It can supplement native push for users who don't install the app, but cannot be relied upon for time-sensitive communications (event changes, meeting cancellations).

**Revisit if:** Apple significantly improves iOS web push reliability and removes the Home Screen install requirement.

### Approach 4: TWA (Android) + Minimal iOS Shell — VIABLE HYBRID

**Trusted Web Activity on Android:**
- TWA wraps your PWA in Chrome (not a WebView) — full Chrome engine, zero URL bar, full PWA features
- Service Workers, offline caching, and FCM web push all work identically to the browser
- Push notifications: yes — FCM via Service Worker, same as regular PWA but packaged as an app
- Tools: Bubblewrap CLI (Google-maintained) or PWABuilder (Microsoft) can generate TWA packages
- Setup: 2-4 hours to generate signed APK/AAB and publish to Play Store
- Deep linking: works via Service Worker `push` event -> `clients.openWindow(url)`
- No native code required — it's literally Chrome running your PWA
- Digital Asset Links verification required (host `assetlinks.json` on your domain)

**Minimal iOS Swift shell:**
- A bare-bones Swift app with WKWebView + native push notification handling
- Architecture: WKWebView loads your web app; UNNotificationCenter handles push; JavaScript bridge passes notification data to WebView
- Push flow: APNs delivers notification -> Swift delegate receives it -> evaluates JavaScript in WebView to trigger navigation
- Can be as minimal as ~200 lines of Swift code (AppDelegate + ViewController + notification handling)
- Must still pass App Store Guideline 4.2 — needs native tab bar, splash screen, offline indicator at minimum

**Pros of this hybrid:**
- Android: zero native code, Chrome engine (best web compatibility), easy Play Store publishing
- iOS: minimal native code, full native push reliability
- Single web codebase serves both platforms
- No framework dependency (no Capacitor, no Expo)

**Cons:**
- Two different build/deploy pipelines (TWA tooling vs Xcode)
- iOS shell needs manual maintenance for Swift/Xcode version updates
- Less ecosystem support than Capacitor (no plugin marketplace, DIY everything)
- Deep linking on iOS requires custom bridge code

**When this makes sense:** If you want absolute minimal dependencies and are comfortable with basic Swift. For a solo developer who may not maintain the iOS app frequently, Capacitor's plugin ecosystem and unified tooling is probably less maintenance long-term.

**Setup time:** 3-5 days (TWA: 1 day, iOS shell: 2-4 days including App Store submission)

### Approach 5: Push-as-a-Service (OneSignal / Pushover / Firebase / ntfy)

#### OneSignal — BEST ALL-AROUND SERVICE

**What it is:** Multi-channel engagement platform (push, email, SMS, in-app messages).

**Free tier (2025-2026):**
- Unlimited mobile push subscribers + unlimited sends
- Up to 10,000 web push subscribers (unlimited sends)
- 10,000 emails/month free
- 1 active In-App Message
- Basic segmentation, A/B testing, Journeys automation
- For 80 users: completely free, massive headroom

**Paid tier:** Growth plan at $19/mo + $0.012/MAU for mobile push. Not needed at troop scale.

**iOS + Android:** Full native SDK for both platforms. Also works via Capacitor plugin.
**Web push:** Yes — handles the Safari/Chrome differences for you.
**Rich notifications:** Action buttons, images, deep links, custom data — all supported.

**Deep linking:** Notification payload includes `url` or `data` fields. SDK handles launching the correct screen. Works with Capacitor's notification listener.

**Node.js/Express integration:**
- REST API + official Node SDK (`@onesignal/node-onesignal`)
- Send notification: single API call with `include_player_ids` or segments
- 30-45 minutes to send first notification from backend

**Privacy/minors:** Collects device IDs and behavioral data. GDPR-compliant. COPPA compliance possible with configuration (disable behavioral tracking, limit data collection). As a nonprofit, COPPA likely doesn't apply (see exemption above), but data minimization is still best practice.

**OneSignal vs doing-it-yourself with FCM:** OneSignal abstracts away: token management, platform differences, delivery optimization, analytics, segmentation. For a solo developer, this saves significant time. The free tier makes the cost argument irrelevant.

**Verdict:** If using Capacitor, OneSignal is the easiest path to production push notifications. It can also serve as the push backend if you later add a web PWA fallback channel.

#### Firebase Cloud Messaging (Direct) — POWERFUL BUT MORE SETUP

**Free tier:** Unlimited messages, no billing required (Spark plan).
**iOS + Android + Web:** Yes, all three.
**Rich notifications:** Full support.
**Deep linking:** Via notification `data` payload — your app handles routing.

**Setup complexity:** Moderate-to-challenging for first-timers.
- Firebase project creation + service account JSON
- Firebase Admin SDK in Node.js backend
- iOS: APNs key upload to Firebase Console
- Android: `google-services.json` in project
- Token management: you must store and manage device tokens yourself
- 1-2 hours for first notification, but ongoing token lifecycle management adds complexity

**When to use FCM directly:** If you want full control and no third-party dependency. Good if you're already in the Google ecosystem. But for a solo developer, OneSignal's abstraction saves time.

#### Pushover — SIMPLE BUT LIMITED

**Pricing:** $5 one-time per-platform (users must buy the Pushover app on iOS/Android).
**Free tier:** 7,500 messages/month (for 80 users: ~94 per user/month — borderline).
**Rich notifications:** Basic priority levels and sounds only. No action buttons. No images.
**Web push:** No — native apps only.
**Deep linking:** No built-in support.

**Verdict:** The per-user app purchase ($5/platform) is a non-starter for a volunteer troop. Parents won't pay for a notification app. Also limited in features compared to alternatives.

#### ntfy — CURRENT SOLUTION, PRIVACY-BEST

**Already in use** in Scout Quest. Self-hostable, zero tracking, simple HTTP POST API.
**Limitation:** Requires parents to install the ntfy app — adoption friction is the main problem.
**Rich notifications:** Basic (text, priority, tags, action URLs). Improving but not as rich as OneSignal/FCM.
**Deep linking:** Action URLs can open specific pages, but it's "open URL" not "navigate within app."

**ntfy's role going forward:** Keep as a backend delivery mechanism. If using Capacitor + OneSignal, ntfy becomes the "power user" option for those who prefer it, while the main app handles push natively.

### Approach 6: Tauri 2.0 Mobile — NOT READY

**What it is:** Tauri wraps web apps in the system's native web renderer (WebKit on iOS, Chromium on Android) with a Rust backend for system integration. Tauri 2.0 (late 2024) added mobile support.

**Maturity (March 2026):** Pre-production for mobile.
- Desktop: production-ready (Windows, macOS, Linux)
- Mobile: early production — rapidly improving but missing key features
- Push notifications: **not officially supported** — no stable API exposed. Community plugins exist (`tauri-plugin-fcm-push-notifications`) but are undocumented and untested in production. The Tauri team acknowledges this gap but hasn't committed to a timeline.
- Deep linking: partially supported (custom URI schemes + Universal/App Links), but requires Rust code to handle events
- Binary size advantage: ~600KB vs Capacitor's ~5-10MB — nice but not a deciding factor for this use case

**Rust requirement:** All native-side logic must be written in Rust. For a JavaScript developer, the learning curve is substantial (ownership, borrowing, lifetimes). This is a deal-breaker for a solo developer wanting quick results.

**Verdict:** Tauri is architecturally elegant and security-focused, but mobile push notification support is the critical missing piece. Do not use for this project until push notifications are officially supported.

**Revisit if:** Tauri adds stable, documented push notification support for iOS and Android.

### Approach Comparison Matrix

| Criterion | Capacitor | Expo | PWA+FCM | TWA+iOS Shell | OneSignal (service) | Tauri Mobile |
|-----------|-----------|------|---------|---------------|-------------------|-------------|
| **Setup effort** | 2-3 days | 2-4 days | 1-2 days | 3-5 days | 2-4 hours (service only) | 4-7 days |
| **iOS push reliability** | Excellent (native APNs) | Excellent (native APNs) | Poor (60-75% of native) | Excellent (native APNs) | Excellent (native APNs) | No support |
| **Deep linking** | Yes (plugin) | Yes (complex bridge) | Android yes, iOS unreliable | Yes (custom code) | Yes (with native app) | Partial (Rust required) |
| **Rich notifications** | Yes (images, buttons) | Yes (images, buttons) | Android yes, iOS limited | Yes | Yes (images, buttons) | No support |
| **App Store submission** | Standard | Standard | N/A (no app) | Standard | Requires native app | Standard |
| **Native code required** | Near zero | React Native wrapper | Zero | ~200 lines Swift | Near zero (with Capacitor) | Rust backend required |
| **Ongoing maintenance** | Low | Medium | Very low | Medium (2 pipelines) | Very low | Medium-high |
| **Cost (annual)** | $124 (Apple + Google) | $124 (Apple + Google) | $0 | $124 (Apple + Google) | $0 (free tier) | $124 (Apple + Google) |
| **Wallet/NFC** | Yes (plugins) | No | No | No (DIY) | No | No |
| **Framework lock-in** | Low (web-first) | High (React Native) | None | None | None (service) | Medium (Rust) |

### What Small Organizations Actually Use

Based on research into churches, sports leagues, PTAs, and scout troops:

**Most common (non-technical orgs):**
- Remind (texting service) + Facebook Groups + email newsletters
- GroupMe / WhatsApp for informal coordination
- No custom apps — they use whatever platform has lowest adoption friction

**Tech-forward small orgs:**
- OneSignal-powered web portal where parents opt in
- Capacitor-wrapped web app for "App Store presence" + push
- Spond (popular in European scouting and youth sports)

**Pattern: "thin native shell + push service"** is a real and growing approach:
1. Web app at `myorg.example.com` (existing)
2. Capacitor wraps it into iOS/Android apps
3. OneSignal or FCM handles push across native app + web fallback
4. Same codebase, minimal native code

**Discourse + push:** Discourse (self-hosted forum) has built-in web push support. A "Discourse Hub" mobile app exists but is minimal/unmaintained. Custom native wrappers around Discourse web UI exist but require active development. For the Scout Quest use case, Discourse is better as the forum/discussion layer (already recommended above), not as the push notification backbone.

### Recommended Implementation Plan

**Phase 1 — Capacitor shell + FCM push (2-3 days):**
1. `npm install @capacitor/cli @capacitor/core` in the web app project
2. `npx cap init` + `npx cap add ios` + `npx cap add android`
3. Configure `serverUrl` to point at `https://troopquest.com` (or `troop2024.ai`)
4. Install `@capacitor/push-notifications`
5. Set up Firebase project, upload APNs key
6. Implement push registration + deep link handling in web app JS
7. Backend: store device tokens in MongoDB, send via Firebase Admin SDK (or OneSignal)

**Phase 2 — App Store submission (1-2 days):**
1. Add native tab bar (Home, Schedule, Chat, Settings) — satisfies Guideline 4.2
2. Add splash screen with troop branding
3. Add basic offline indicator / cached content
4. Generate screenshots, write descriptions, set age rating
5. Submit to App Store + Play Store

**Phase 3 — Enhance (ongoing):**
1. Rich notifications (event images, action buttons for RSVP)
2. Deep links for all micro-apps (quest progress, chore log, merit badge tracker)
3. Wallet passes for events (Phase 3+, requires `passkit-generator` backend work)
4. NFC for attendance tracking at meetings (future)

**Cost summary:**
| Item | Cost | Frequency |
|------|------|-----------|
| Apple Developer Program | $99 | Annual |
| Google Play Developer | $25 | One-time |
| Firebase (FCM) | $0 | Free |
| OneSignal (if used) | $0 | Free tier |
| Capacitor | $0 | Open source |
| **Total Year 1** | **$124** | |
| **Total Year 2+** | **$99** | |

---

## Android Conversational Notifications in Capacitor

**Last updated:** 2026-03-18

**Context:** The app is an AI coaching chatbot (LibreChat web UI inside a Capacitor WebView) that sends push notifications to scouts and parents. This research evaluates whether Android's rich conversational notification features (MessagingStyle, bubbles, inline reply, conversation widgets) can work in a Capacitor app, and what the iOS equivalent looks like.

### 1. MessagingStyle Notifications in Capacitor

**Can `@capacitor/push-notifications` create Android MessagingStyle notifications?**
No. The official Capacitor push notification plugin (v5.0+ as of 2026) uses basic `NotificationCompat.Builder` internally. It does not expose MessagingStyle, Person objects, conversation shortcuts, or any of the Android Conversations API. The community plugin `@capacitor-firebase/messaging` (capawesome) is more capable (topics, foreground notifications, silent push) but also does not expose MessagingStyle.

**What you need instead:**
- **Option A (recommended): Custom Capacitor native plugin.** Write a Java/Kotlin Capacitor plugin that receives FCM data messages and builds `NotificationCompat.MessagingStyle` notifications natively. Capacitor's plugin system (`@CapacitorPlugin` annotation, `registerPlugin()` in `MainActivity.java`) is well-documented for this. The plugin intercepts FCM data payloads in a `FirebaseMessagingService` subclass and constructs the notification with full Android API access.
- **Option B: Modify the generated Android project directly.** After `npx cap sync`, modify files in `android/app/src/main/java/...` to add a custom `FirebaseMessagingService`. This works but is fragile — `cap sync` can overwrite changes.

**FCM payload format for MessagingStyle:**
You must use **data-only messages** (no `notification` key), because Android auto-displays `notification` messages before your code can intercept them. The data payload carries the conversation metadata; your native code builds the MessagingStyle notification:

```json
{
  "message": {
    "token": "device_token_here",
    "data": {
      "type": "conversation",
      "conversationId": "quest_camping_merit_badge",
      "senderName": "Scout Coach",
      "senderIcon": "https://troopquest.com/img/coach-avatar.png",
      "messageText": "Great job completing the fire safety requirement!",
      "timestamp": "1710768000000",
      "shortcutId": "scout_coach_conv"
    }
  }
}
```

The native handler then:
1. Creates a `Person` object from `senderName`/`senderIcon`
2. Builds `NotificationCompat.MessagingStyle` with the message
3. Associates a long-lived `ShortcutInfo` (required for conversation section)
4. Posts the notification via `NotificationManagerCompat`

**Effort estimate:** 2-4 days for a working custom plugin with MessagingStyle support. Requires Java/Kotlin knowledge.

### 2. Android Notification Bubbles (Chat Heads)

**Can a Capacitor app use bubbles?**
Technically yes, but with significant caveats. Bubbles are a native Android API feature — they are not tied to how the app was built. Any app (including Capacitor WebView apps) can post bubble-enabled notifications if the native notification code is correct.

**Requirements checklist:**

| Requirement | Detail |
|---|---|
| **targetSdk** | 30+ (Android 11+). Current Play Store requirement is 34 as of 2026. |
| **Notification channel** | Must have `importance = IMPORTANCE_HIGH` and `setShowBubbles(true)` |
| **MessagingStyle** | Required — bubbles only work with MessagingStyle notifications |
| **ShortcutInfo** | Must publish a long-lived dynamic shortcut via `ShortcutManager.pushDynamicShortcut()` before posting the notification. Max 5 dynamic shortcuts at a time. |
| **BubbleMetadata** | Must create `NotificationCompat.BubbleMetadata` with a `PendingIntent` pointing to an Activity, an icon, and a desired height |
| **Person** | ShortcutInfo must have a `Person` associated via `.setPerson()` |
| **POST_NOTIFICATIONS** | Required permission on Android 13+ |

**The critical problem: What does the bubble open?**
When the user taps a bubble, Android opens the Activity specified in the `BubbleMetadata`'s `PendingIntent`. In a Capacitor app, this would be the main `BridgeActivity` (the WebView). However:
- Bubbles open the Activity in a **small floating window** (configurable height, ~75% screen width)
- The Capacitor WebView would render inside this cramped bubble window
- A full chat UI (LibreChat) would be barely usable in this constrained space
- There is no way to open a "lightweight" bubble view while keeping the full WebView for the main app — you'd need a separate native Activity for the bubble content, which defeats the purpose of a WebView app

**Practical assessment for this use case:** Bubbles are not worth implementing. The LibreChat UI is not designed for the small bubble window. Native chat apps (WhatsApp, Messages) work well in bubbles because they have purpose-built, minimal conversation views. A WebView rendering a full web chat UI in a bubble would provide a poor experience.

**Verdict:** Skip bubbles. The effort-to-value ratio is very poor for a WebView-based chat app.

### 3. Inline Reply from Notification

**Can users reply directly from the notification shade?**
Yes, but it requires custom native code. The Android `RemoteInput` API allows text input directly in the notification shade. This works regardless of whether the app uses a WebView.

**How it works:**
1. When building the notification (in your custom native plugin), attach a `NotificationCompat.Action` with a `RemoteInput`
2. When the user types and sends, Android fires a `PendingIntent` (to a `BroadcastReceiver` or `Service`)
3. The receiver extracts the reply text from `RemoteInput.getResultsFromIntent(intent)`
4. The reply must be routed back to the web app/backend

**Routing the reply back — three options:**

| Option | How | Complexity | Reliability |
|---|---|---|---|
| **Direct API call** | BroadcastReceiver makes HTTP POST to your backend API with the reply text + conversationId | Low | High (no WebView needed) |
| **Capacitor bridge** | BroadcastReceiver calls `notifyListeners()` on a Capacitor plugin, which fires a JS event in the WebView | Medium | Medium (requires WebView to be alive) |
| **Store-and-forward** | BroadcastReceiver writes reply to local SQLite/SharedPreferences; WebView reads on next launch | Low | High |

**Recommended approach for this use case:** Direct API call from the BroadcastReceiver. The backend already has chat endpoints (LibreChat API). The native receiver can POST the reply directly without involving the WebView at all. This is the same pattern WhatsApp and Telegram use — the inline reply goes straight to the server.

**Important limitation:** For an AI chatbot, inline reply has a UX problem. The user sends a reply, but the AI response comes asynchronously (could take seconds). The notification shade can't display a streaming AI response. The user would send "yes I completed that requirement" and then... nothing happens in the notification. They'd need to open the app to see the AI's response. This makes inline reply less useful for an AI chat than for human-to-human messaging.

**Effort estimate:** 1-2 days on top of the MessagingStyle plugin. The BroadcastReceiver + RemoteInput is straightforward.

### 4. Conversation Widget (Android 11+ / Conversation Section)

**Can conversations appear in Android's conversation section of the notification shade?**
Yes, with the same requirements as MessagingStyle. Android 11+ (API 30+) shows a dedicated "Conversations" section at the top of the notification shade. From Android 14+ (API 34, `UPSIDE_DOWN_CAKE`), MessagingStyle notifications associated with a valid conversation shortcut are **automatically** placed in this section.

**Requirements (all must be met):**

1. **MessagingStyle notification** — the notification must use `NotificationCompat.MessagingStyle`
2. **Long-lived sharing shortcut** — must call `ShortcutManagerCompat.pushDynamicShortcut()` with `.setLongLived(true)` before posting the notification
3. **setShortcutId()** — the notification builder must call `.setShortcutId(shortcutId)` linking to the published shortcut
4. **Person on shortcut** — the shortcut should have `.setPerson(person)` for proper rendering
5. **LocusId (optional but recommended)** — improves ranking accuracy: `.setLocusId(new LocusId(shortcutId))`
6. **Category** — set `.setCategory(NotificationCompat.CATEGORY_MESSAGE)` on the notification

**For a Capacitor app:** All of this is native-only code. The Capacitor plugin system cannot reach the `ShortcutManager` or `MessagingStyle` APIs. You need the same custom native plugin described in section 1.

**What users get:**
- "Scout Coach" conversations appear in the prioritized Conversations section
- Users can long-press to set the conversation as "Priority" (always shows at top, even in DND)
- The conversation shortcut appears in the launcher's long-press menu
- On Android 12+, conversation shortcuts can power homescreen Conversation Widgets

**Practical value for this use case:** High. Having "Scout Coach" appear as a real conversation in the notification shade (alongside WhatsApp, Messages, etc.) significantly elevates the app's perceived quality. It signals to Android that this is a real messaging app, not just a notification spammer.

### 5. Practical Assessment: Capacitor WebView Chat vs. Native

**Feature comparison for this specific use case (AI coaching chatbot):**

| Feature | Capacitor (with custom plugin) | Native App (Kotlin) | Effort Delta |
|---|---|---|---|
| Basic push notification | Yes (plugin) | Yes (built-in) | Same |
| MessagingStyle | Yes (custom plugin, 2-4 days) | Yes (trivial) | +2-4 days |
| Conversation section | Yes (same custom plugin) | Yes (trivial) | Included above |
| Inline reply | Yes (custom plugin, +1-2 days) | Yes (trivial) | +1-2 days |
| Notification bubbles | Technically yes, but poor UX | Good UX (dedicated view) | Not recommended |
| Tap-to-chat navigation | Yes (deep link to WebView) | Yes (native navigation) | Same |
| Chat UI quality | Good (LibreChat web UI) | Would need to build from scratch | WebView wins |
| AI streaming responses | Excellent (SSE in WebView) | Must implement (OkHttp SSE) | WebView wins |
| Offline support | Limited (WebView needs network) | Can cache conversations | Native wins |
| App size | ~15-25 MB | ~10-15 MB | Minor |
| Development time (total) | 1-2 weeks | 2-4 months | WebView wins massively |

**How good would the Android experience ACTUALLY be vs WhatsApp/iMessage?**

With the custom native plugin implementing MessagingStyle + conversation shortcuts + inline reply:
- **Notification experience: 85-90% of WhatsApp.** Notifications look identical in the shade — same conversation grouping, same person avatars, same priority section. The only tell is that tapping opens a WebView instead of a native view.
- **In-app experience: 70-80% of WhatsApp.** The LibreChat web UI is a good chat interface but has WebView overhead (slower initial load, no native gestures like swipe-to-reply). For an AI coaching chatbot (not a real-time group chat), this is perfectly adequate.
- **Without the custom plugin: 40-50% of WhatsApp.** Basic push notifications with no conversation grouping, no inline reply, generic notification style. Looks like any random app sending alerts, not a chat app.

**What's realistic for a solo developer?**

| Tier | Features | Effort | Quality |
|---|---|---|---|
| **Tier 1: Basic** | Standard push notifications via `@capacitor/push-notifications` or OneSignal. Tap opens WebView chat. | 2-3 days | Functional but generic |
| **Tier 2: Conversational** | Custom native plugin with MessagingStyle + conversation shortcuts. Notifications appear in Conversations section. | 1-2 weeks | Feels like a real chat app |
| **Tier 3: Full chat UX** | Tier 2 + inline reply + notification grouping + reply routing to backend API | 2-3 weeks | Near-native quality notifications |

**Recommendation:** Start with Tier 1, ship the app, then upgrade to Tier 2 when time permits. Tier 2 is the sweet spot — the conversation section placement and MessagingStyle are the highest-impact features for perceived quality. Inline reply (Tier 3) is lower priority because AI responses can't be shown in the notification shade anyway.

### 6. iOS Comparison: Communication Notifications

**Does iOS have equivalent conversational notification features?**
Yes. iOS 15+ introduced **Communication Notifications** via the `INSendMessageIntent` framework (part of SiriKit/Intents). These provide:
- Contact avatars on notifications (instead of just the app icon)
- Siri suggestions based on communication patterns
- Focus mode exceptions (notifications from "important" conversations can break through DND)
- Notification grouping by conversation

**How Communication Notifications work on iOS:**
1. A **Notification Service Extension** (separate binary target in Xcode) intercepts incoming push notifications
2. The extension creates an `INSendMessageIntent` with sender info (name, avatar, conversation ID)
3. The extension attaches the intent to the notification content via `UNMutableNotificationContent.contentProvidingIntent`
4. iOS renders the notification with the contact's avatar and places it in the communication category

**Requirements for Capacitor apps:**
- Must add a **Notification Service Extension** target in the Xcode project (native Swift code, cannot be done from JavaScript)
- Must add `INSendMessageIntent` to `NSUserActivityTypes` in the main app's `Info.plist`
- Must add `INSendMessageIntent` to `IntentsSupported` in the extension's `Info.plist`
- The extension runs in a separate process with limited memory (24 MB on older devices)
- Extension has ~30 seconds to modify the notification before iOS displays the original

**Can this work with a Capacitor WebView app?**
Yes, but the Notification Service Extension is entirely native Swift code. Capacitor's plugin system does not help here. You must:
1. Open the Xcode project generated by Capacitor (`npx cap open ios`)
2. Add a new target: File -> New -> Target -> Notification Service Extension
3. Implement `didReceive(request:withContentHandler:)` in Swift
4. Create `INSendMessageIntent` with sender info extracted from the push payload

**Key difference from Android:** iOS Communication Notifications are simpler to implement than Android's full conversational stack (no ShortcutManager, no BubbleMetadata). But they provide less functionality — no bubbles, no inline reply from notification (iOS has no equivalent of Android's RemoteInput in the notification shade), no conversation widget.

**iOS vs Android feature comparison:**

| Feature | Android | iOS |
|---|---|---|
| Conversation grouping in shade | Yes (MessagingStyle + shortcut) | Yes (Communication Notifications) |
| Contact avatar on notification | Yes (Person object) | Yes (INSendMessageIntent) |
| Inline reply from notification | Yes (RemoteInput) | No (must open app) |
| Notification bubbles | Yes (BubbleMetadata) | No equivalent |
| Conversation widget on homescreen | Yes (Android 12+) | No equivalent |
| DND bypass for priority conversations | Yes (Important conversations) | Yes (Focus mode exceptions) |
| Native code required in Capacitor | Yes (custom plugin) | Yes (Notification Service Extension) |
| Effort for Capacitor app | 2-4 days (custom plugin) | 1-2 days (NSE target) |

### Summary and Recommendations

**For the Scout Quest Capacitor app:**

1. **Ship with basic push first (Tier 1).** Use `@capacitor/push-notifications` or `@capacitor-firebase/messaging`. Get the app in stores with working notifications. This alone is a massive improvement over ntfy.sh (no separate app install, native delivery).

2. **Add Android MessagingStyle + conversation shortcuts later (Tier 2).** This is the highest-impact upgrade. Write a custom Capacitor native plugin (~200-300 lines of Java/Kotlin) that builds MessagingStyle notifications from FCM data messages. "Scout Coach" will appear as a real conversation in the Android notification shade alongside WhatsApp and Messages.

3. **Add iOS Communication Notifications.** Add a Notification Service Extension (~50-100 lines of Swift) to show the Scout Coach avatar on iOS notifications and enable Focus mode bypass.

4. **Skip bubbles entirely.** The LibreChat WebView UI does not work well in a bubble's constrained window. Not worth the effort.

5. **Inline reply is low priority.** For an AI chatbot, the user sends a reply but can't see the AI's response in the notification shade. The UX is awkward. Only implement if forum/group messaging (human-to-human) becomes a notification source.

6. **FCM data messages are the key architectural decision.** Send data-only FCM messages (no `notification` key) so your native code always has the opportunity to build rich notifications. If you send `notification` messages, Android auto-displays them as basic notifications before your code runs, and you lose the ability to use MessagingStyle.

**Revisit if:** Capacitor adds a plugin that exposes MessagingStyle/conversation APIs (unlikely — too Android-specific). Or if a community plugin emerges for this (check npm for `capacitor-messaging-style` or similar periodically).

---

## Embedding & Vector Search: Google Ecosystem vs Current Plan

**Last updated:** 2026-03-18
**Context:** Architecture v2 plan uses Voyage AI embeddings + FalkorDB vector indexes. This research evaluates whether Google's embedding/vector ecosystem could replace or complement that approach.

### 1. Google Embedding Models (as of March 2026)

#### gemini-embedding-001 (GA, text-only)
- **Status:** Generally available (launched July 2025)
- **Dimensions:** 3072 default; supports Matryoshka Representation Learning (MRL) truncation to 1536 or 768 with minimal quality loss
- **Max input:** 2,048 tokens
- **Pricing:** $0.15/million tokens (paid tier); free tier available with 1,500 RPD limit
- **MTEB score:** 68.32 overall average — **#1 on English MTEB leaderboard** as of March 2026
- **MTEB retrieval score:** 67.71 (best among API models)
- **Task types:** Supports `RETRIEVAL_QUERY`, `RETRIEVAL_DOCUMENT`, `SEMANTIC_SIMILARITY`, `CLASSIFICATION`, `CLUSTERING`, and others
- **Languages:** 100+
- **Key advantage:** Best overall MTEB scores among commercial models, good free tier
- **Key limitation:** 2,048 token max input is shorter than Voyage's 32K context

#### gemini-embedding-2-preview (public preview, multimodal)
- **Status:** Public preview (launched March 2026)
- **Dimensions:** 3072 default; MRL truncation to any size 128-3072 (768 recommended for production)
- **Max input:** 8,192 tokens for text (4x gemini-embedding-001)
- **Pricing:** $0.20/million text tokens ($0.10/M via batch API)
- **Modalities:** Text, images, video, audio, PDFs in a single unified vector space
- **Note:** Embedding spaces are incompatible with gemini-embedding-001 — switching requires re-embedding
- **Key advantage:** Multimodal; longer input context than embedding-001
- **Key limitation:** Still in preview; 33% more expensive than embedding-001 for text

#### text-embedding-004 (deprecated)
- **Status:** Deprecated January 14, 2026. Do not use for new projects.

### 2. Voyage AI Embedding Models (as of March 2026)

#### voyage-3.5
- **Dimensions:** 1024
- **Max input:** 32,000 tokens (16x Gemini embedding-001)
- **Pricing:** $0.06/million tokens
- **Free tier:** 200 million tokens per account
- **Quality:** Strong domain-specific retrieval; "measurably better results on domain-specific tasks" per independent comparisons
- **Key advantage:** Very long context (32K), excellent domain-specific performance, generous free tier

#### voyage-context-3 (launched July 2025)
- **What it does:** Contextualized chunk embedding — automatically captures full document context in each chunk's embedding without manual metadata or LLM-based context augmentation
- **Drop-in replacement** for standard embedding models (same dimensions, same interface)
- **Outperforms contextual retrieval** (Anthropic's approach) by 6.76% on chunk-level and 2.40% on document-level retrieval tasks
- **Key insight:** This model directly replaces the "Contextual Retrieval" step in our architecture plan (the Haiku batch enrichment step). Instead of using an LLM to prepend context to each chunk before embedding, voyage-context-3 captures that context natively in the embedding itself.
- **Pricing:** Same as standard Voyage models
- **Impact on current plan:** Could eliminate the $3-6 Haiku batch contextual enrichment cost and the pipeline complexity

### 3. Embedding Model Comparison Matrix

| Dimension | gemini-embedding-001 | gemini-embedding-2 | voyage-3.5 | voyage-context-3 | OpenAI text-3-small |
|---|---|---|---|---|---|
| MTEB overall | **68.32 (#1)** | ~65.2 | ~63-64 (est) | N/A (chunk-level) | ~62.3 |
| MTEB retrieval | **67.71** | ~65 | Strong (domain) | +6.76% vs CR | ~61 |
| Price/MTok | $0.15 | $0.20 | $0.06 | ~$0.06 | **$0.02** |
| Max input | 2,048 tok | 8,192 tok | **32,000 tok** | **32,000 tok** | 8,191 tok |
| Default dims | 3072 | 3072 | 1024 | 1024 | 1536 |
| MRL (dim flex) | Yes (768/1536/3072) | Yes (128-3072) | No | No | Yes (256-3072) |
| Free tier | 1,500 RPD | Preview (free) | **200M tokens** | 200M tokens | None |
| Multimodal | No | **Yes** | No | No | No |
| Domain-specific | Good (general MTEB) | Good | **Excellent** | **Best** (contextual) | Good |
| Context-aware | No | No | No | **Yes (built-in)** | No |

### 4. Google Vector Search Options

#### Vertex AI Vector Search (v1 — legacy provisioned)
- **Architecture:** Requires provisioned index endpoints that run continuously
- **Pricing:** Node-hour based — always-on cost regardless of query volume
- **Minimum cost:** Prohibitive for small/sporadic workloads (estimated $100+/month minimum)
- **Verdict:** **Not suitable for this project.** "The provisioned endpoint model makes it a poor financial fit for sporadic use cases" (Google Cloud community post)

#### Vertex AI Vector Search 2.0 (launched late 2025, in preview)
- **Key improvements:**
  - Auto-embeddings (generates embeddings via Gemini automatically)
  - Unified storage (eliminates separate feature store)
  - Self-tuning indexes (auto ANN configuration)
  - Built-in hybrid search (semantic + keyword in one API)
  - kNN for small datasets (brute-force, zero setup)
  - ANN for large datasets (auto-configured)
- **Pricing:** Not yet fully public. Expected to improve on v1's always-on model.
- **kNN mode:** Perfect for development and small datasets — zero setup, instant, 100% accuracy
- **Verdict:** Promising for enterprise use, but still requires Vertex AI / GCP. Overkill for <10K vectors. Monitor pricing when GA.

#### BigQuery Vector Search (serverless)
- **Architecture:** Serverless, pay-per-query
- **How it works:** Store vectors in BigQuery tables, use `VECTOR_SEARCH()` SQL function
- **Pricing:** Standard BigQuery pricing (per TB scanned)
- **Advantage:** No provisioned infrastructure, pure pay-per-use
- **Verdict:** Could work for infrequent queries on small datasets, but BigQuery is not a real-time serving layer. Not a fit for interactive chat retrieval.

### 5. Firestore Vector Search

- **Status:** Available (launched ~2024, progressively improved)
- **How it works:** Store embedding vectors as a field in Firestore documents; query with `findNearest()`
- **Dimensions:** Supports up to 2048 dimensions
- **Index:** Uses Firestore's built-in vector indexing
- **Pricing:** Standard Firestore pricing ($0.18/100K reads, $0.26/GB stored)
- **Known issues:**
  - **Performance complaints:** Reddit reports of "prohibitively slow" queries on large collections
  - **2048 dimension limit** — won't work with Gemini's default 3072 (but works with 768 MRL truncation or Voyage's 1024)
  - Extension compatibility issues reported
- **Verdict:** **Not recommended.** Immature vector search, performance concerns, dimension limitations. For a small project, adding Firestore just for vector search adds complexity without clear benefit.

### 6. AlloyDB AI / Cloud SQL pgvector

#### AlloyDB (managed)
- **What it is:** Fully managed PostgreSQL-compatible with ScaNN integration (Google's similarity search algorithm)
- **Vector search:** 10x faster than standard pgvector (uses ScaNN under the hood)
- **Minimum cost:** ~$530/month for smallest HA configuration (4 vCPU, 32GB). Non-HA is cheaper but still $200+/month
- **Verdict:** **Way too expensive for this project.** Enterprise pricing for enterprise workloads.

#### AlloyDB Omni (self-hosted)
- **What it is:** Downloadable AlloyDB as a Docker container, runs anywhere
- **Licensing:** Free for development/testing; per-vCPU license for production
- **Includes:** Columnar engine, pgvector, alloydb_scann extension
- **Verdict:** Interesting for professional work. For Scout Quest, the FalkorDB plan already provides graph + vector + full-text in one container. AlloyDB Omni would add PostgreSQL overhead without the graph capabilities.

#### Cloud SQL with pgvector
- **Smallest instance:** ~$7-15/month (f1-micro / db-f1-micro)
- **pgvector:** Supported
- **Verdict:** Cheapest managed Google option, but still adds a separate database to manage. Self-hosted FalkorDB on the existing VM is $0 incremental.

### 7. Context Caching Comparison (Gemini vs Anthropic)

| Feature | Anthropic Prompt Caching | Gemini Context Caching |
|---|---|---|
| Discount | **90% off** cached input tokens | **90% off** cached reads (2.5+ models) |
| Storage cost | **None** | $1-4.50/million tokens/hour |
| Cache control | Explicit (`cache_control` markers) | Explicit + implicit (auto) |
| Min tokens | ~1,024 (auto) | 1,024 (Flash) / 2,048 (Pro) explicit: 32,768 |
| TTL | 5 min base, extendable to 1 hour | Default 1 hour, configurable |
| Write premium | Yes (25% surcharge on first write) | Yes (varies by model) |

**Key finding for this project:** Anthropic's prompt caching is cheaper for the Scout Quest use case because there are no storage fees. With a 200K-token BSA knowledge base cached in the system prompt, Anthropic's approach costs ~$0.04/query (cache hit) with no hourly storage cost. Gemini would charge $1/M tokens/hour for storage, meaning the 200K-token cache would cost ~$0.20/hour ($4.80/day) just to keep alive, even with zero queries. This makes Gemini context caching uneconomical for low-query-volume applications unless implicit caching suffices.

### 8. Compatibility: Mix-and-Match Embeddings + Vector DBs

**Critical finding: Gemini embeddings work with ANY standard vector database.**

Gemini embeddings produce standard floating-point vectors. Google officially documents compatibility with: Pinecone, Weaviate, Qdrant, Milvus, Chroma, Redis (with vector extension), pgvector, and their own AlloyDB/Vector Search. Multiple production examples exist of Gemini embeddings stored in pgvector and Qdrant.

Similarly, Voyage/OpenAI embeddings can be stored in Google's vector search products (they accept any float vectors of the configured dimension).

**Therefore: The embedding model choice and the vector DB choice are fully independent.** You can use Gemini embeddings with FalkorDB, or Voyage embeddings with Vertex AI Vector Search, etc.

### 9. Comparison Matrix: Current Plan vs Google All-In vs Hybrid

| Dimension | Current Plan (Voyage + FalkorDB) | Google All-In (Gemini Embed + VS 2.0) | Recommended Hybrid |
|---|---|---|---|
| **Embedding quality** | Strong domain-specific (Voyage) | #1 MTEB overall (Gemini) | Voyage-context-3 or Gemini-embed-001 |
| **Embedding cost** | $0.06/MTok + free 200M tier | $0.15/MTok + free 1,500 RPD | Either works; both <$1/mo at this scale |
| **One-time corpus embed cost** | ~$0.50 | ~$1.25 | Negligible either way |
| **Vector DB cost** | $0 (self-hosted FalkorDB) | $100+/month (VS) or $0 (self-hosted) | **$0 (FalkorDB on existing VM)** |
| **Setup complexity** | Medium (FalkorDB container) | High (Vertex AI setup) or Medium (self-hosted) | Medium (FalkorDB already planned) |
| **Retrieval quality** | Excellent with voyage-context-3 | Excellent with Gemini embed-001 | Both excellent |
| **Graph capability** | **Yes (Cypher queries)** | No (pure vector) | **FalkorDB (graph + vector)** |
| **Full-text/BM25** | **Yes (built-in)** | Only in VS 2.0 (preview) | **FalkorDB (built-in)** |
| **Hybrid search** | **Yes (vector + BM25 + graph)** | VS 2.0 only (preview) | **FalkorDB** |
| **Integration w/ Anthropic** | Native (same ecosystem) | Works fine (standard vectors) | Either |
| **Integration w/ Gemini** | Works fine | Native | Either |
| **Self-hosted option** | **Yes (Docker, $0)** | Omni only; VS requires GCP | **FalkorDB (Docker, $0)** |
| **Managed option** | No | Yes (Vertex AI) | Not needed at this scale |
| **Contextual retrieval** | voyage-context-3 replaces LLM step | Need separate LLM enrichment | **voyage-context-3 (simpler)** |
| **Max input length** | **32,000 tokens** | 2,048 (embed-001) / 8,192 (embed-2) | **Voyage wins for long chunks** |
| **Enterprise learning value** | Good (Voyage is popular) | **Excellent (GCP ecosystem)** | Both |

### 10. Recommendations

#### For Scout Quest (this project)

**Stick with the current plan (Voyage + FalkorDB) with one upgrade: use voyage-context-3.**

Rationale:
1. **FalkorDB is irreplaceable in this architecture.** It provides graph + vector + full-text in a single self-hosted container at $0 cost. No Google product matches this combination. The knowledge graph (Layer 3 in the architecture) is a core differentiator.
2. **voyage-context-3 eliminates the Contextual Retrieval complexity.** The architecture plan calls for Haiku batch enrichment ($3-6 one-time, plus pipeline complexity). voyage-context-3 does this natively in the embedding model, outperforming Anthropic's contextual retrieval approach by 6.76%. This simplifies the pipeline and saves the enrichment cost.
3. **Voyage's 32K context window matters.** BSA policy documents can be long. Gemini embedding-001's 2,048-token limit would require more aggressive chunking.
4. **Cost is negligible either way.** At <10K vectors and <$1/month embedding cost, the price difference between Voyage ($0.06/MTok) and Gemini ($0.15/MTok) is irrelevant. Both have generous free tiers.
5. **Anthropic prompt caching has no storage fee.** Gemini context caching charges $1/M tokens/hour for storage, which adds up for always-on cached context in a low-volume application.

**Updated one-time corpus processing budget with voyage-context-3:**

| Task | Original (Voyage + Contextual Retrieval) | Updated (voyage-context-3) |
|------|---|----|
| Layer 1: Distill cached context | $30-60 | $30-60 (unchanged) |
| Layer 2: Contextual Retrieval enrichment (Haiku Batch) | $3-6 | **$0 (eliminated)** |
| Layer 2: Embeddings | $0.50 (Voyage) | $0.50 (voyage-context-3) |
| Layer 3: Knowledge graph extraction | $25-50 | $25-50 (unchanged) |
| Validation & re-processing | $20-40 | $20-40 (unchanged) |
| **Total** | **$80-170** | **$76-165** |

The savings are small in dollars but significant in pipeline complexity — one less LLM batch processing step to build, test, and maintain.

#### For Professional/Enterprise Context

Gemini embeddings are worth understanding for enterprise work:
- **gemini-embedding-001** is the MTEB leader and well-integrated with GCP
- **Vertex AI Vector Search 2.0** (when GA) could be a strong managed option for large-scale applications
- **AlloyDB Omni** is interesting for on-prem/hybrid PostgreSQL deployments with vector search
- The key enterprise advantage of Google's stack is the integrated pipeline: auto-embeddings in VS 2.0 eliminate the need for separate embedding pipelines

**Revisit if:**
- Gemini embedding-2 reaches GA with clear pricing advantage over Voyage
- Vertex AI Vector Search 2.0 launches with serverless/pay-per-query pricing suitable for small workloads
- FalkorDB's vector search proves inadequate in testing (latency, recall quality)
- Google releases a combined graph + vector database product
- voyage-context-3 proves problematic in practice (limited real-world reports as of March 2026)

---

## Model Comparison for AI Coaching (Researched 2026-03-20)

**Context:** Evaluating models for the Scout Coach role — needs character consistency (Woody archetype), tool reliability, 165K cached context handling, and youth safety.

### Recommended Test Matrix

| Tier | Model | Price (in/out) | Context | Character Voice | Tool Use | Action |
|------|-------|---------------|---------|----------------|----------|--------|
| **Primary** | Claude Sonnet 4.6 | $3/$15 | 1M | Best | Best | Keep (current) |
| **Budget** | Gemini 2.5 Flash | $0.15/$0.60 | 1M | Moderate | Good | Test next |
| **Alternative** | GPT-4.1 | $2/$8 | 1M | Weak (drift) | Excellent | Test for comparison |
| **Preview** | Gemini 3 Flash | $0.50/$3 | 1M | Moderate | Best budget | Already configured |

### Models Eliminated

| Model | Why |
|-------|-----|
| **Grok (all models)** | **Safety disqualified for youth.** Common Sense Media: "inadequate age-detection, weak safety guardrails, frequent inappropriate content for teen users." 131K context also too small for 165K knowledge. |
| **Claude Haiku 4.5** | 200K context — too tight with 165K knowledge + conversation history |
| **GPT-4o** | Deprecated Feb 2026, 128K context too small |
| **GPT-5.4** | 2x pricing surcharge above 272K tokens — cost surprise with 165K knowledge block |
| **Gemini 2.5 Pro** | Hourly cache storage = ~$120/month for 165K block. Use Flash instead. |
| **Llama 4 Scout/Maverick** | No tool use data, custom endpoint only (no MCP) |
| **Qwen 3.5** | Strong benchmarks but Alibaba API, untested English coaching persona |
| **Mistral Large 2** | No advantage over Claude/GPT/Gemini for this use case |

### Key Findings

**Character voice ranking:** Claude >> Gemini > GPT. RPEval benchmark: Gemini 2.5 Pro scored 59.75% in-character consistency; GPT-4o scored 5.81%. Claude has "warm, empathetic character expression across extended conversations" but documented sycophancy risk.

**Caching economics (for 165K knowledge block):**

| Provider | Cache read discount | Storage fee | Monthly cost @30 sessions |
|----------|-------------------|-------------|--------------------------|
| Anthropic | 90% | **$0** | ~$1.50 |
| OpenAI | 50% | $0 | ~$5.00 |
| Google (explicit) | 90% | $0.165/hr = **$120/mo** | ~$122 |
| Google (implicit) | varies | $0 | ~$0.50 |

Anthropic wins on caching economics for low-volume applications.

**Persona stability:** All models show persona drift after ~8-10 turns. Mitigation: re-inject persona in system block every request (already done by the backend architecture).

**Architecture for multi-model testing:** Backend receives OpenAI format, translates to Anthropic. Adding GPT-4.1 = skip translation (trivial). Adding Gemini = new provider adapter (moderate). OpenRouter is an option but adds middleman.

**Revisit if:** GPT-5.x improves character consistency, Gemini Flash implicit caching is confirmed free, or a new model excels at both tool use and persona maintenance.

---

## Research Process Notes

When conducting new research:
1. **Check this document first** — the answer or a dead-end may already be documented
2. **Update findings immediately** — don't wait for a "documentation phase"
3. **Include source links** — GitHub issues, docs pages, discussion threads
4. **Date your updates** — add "Last updated: YYYY-MM-DD" to section headers
5. **Be explicit about "revisit if"** — document what would change the decision
6. **Distinguish "won't work" from "not worth it"** — constraints vs. preferences
