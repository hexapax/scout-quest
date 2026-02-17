# Scout Quest — System Architecture

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      GCP Project: scout-coach                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              GCE VM (e2-medium, Ubuntu 24.04)                  │  │
│  │              Static External IP + DNS                          │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │                    Caddy :443/:80                         │  │  │
│  │  │         (auto-HTTPS, reverse proxy for both)             │  │  │
│  │  └────────────┬───────────────────────┬─────────────────────┘  │  │
│  │               │                       │                        │  │
│  │  ┌────────────▼──────────┐  ┌────────▼───────────────────┐   │  │
│  │  │  ai-chat stack        │  │  scout-quest stack          │   │  │
│  │  │  :3080                │  │  :3081                      │   │  │
│  │  │  ┌──────┐ ┌────────┐ │  │  ┌──────┐ ┌──────────────┐ │   │  │
│  │  │  │ API  │ │MongoDB │ │  │  │ API  │ │ MongoDB      │ │   │  │
│  │  │  │      │ │        │ │  │  │      │ │              │ │   │  │
│  │  │  └──────┘ └────────┘ │  │  └──┬───┘ └──────────────┘ │   │  │
│  │  │  ┌──────┐            │  │     │  ┌──────────────────┐ │   │  │
│  │  │  │Redis │            │  │     │  │ Scout Quest MCP  │ │   │  │
│  │  │  └──────┘            │  │     │  │ (stdio, Phase 2) │ │   │  │
│  │  │                      │  │     │  └──────────────────┘ │   │  │
│  │  │                      │  │  ┌──▼──┐                    │   │  │
│  │  │                      │  │  │Redis│                    │   │  │
│  │  └──────────────────────┘  │  └─────┘                    │   │  │
│  │                            └─────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────┐                                                   │
│  │ GCS Bucket   │  Terraform state + secret .env files              │
│  └──────────────┘                                                   │
│  ┌──────────────┐                                                   │
│  │ Cloud DNS    │  hexapax.com zone — A records managed by Terraform│
│  └──────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘

External services:
  ├── Anthropic API (Claude — primary model)
  ├── OpenAI API (Whisper STT, TTS, optional GPT)
  ├── DeepSeek API (cheap reasoning)
  ├── OpenRouter (open-source models)
  └── ntfy.sh (push notifications → Will's iPad)
```

## Why This Architecture

**Two instances on one VM** over a single shared instance because:
- Jeremy (admin/developer) needs unrestricted model access for his own use
- Will (scout) needs a locked-down UI with curated presets and memory
- Separate MongoDB databases prevent any data mixing
- Docker Compose derives project names from directory, so no container conflicts

**Single VM with Docker Compose** over Cloud Run because:
- LibreChat needs MongoDB + Redis as sidecars — Cloud Run would need Atlas + Memorystore
- MCP servers run as stdio subprocesses — doesn't map to Cloud Run's request model
- Docker Compose is LibreChat's primary supported deployment path
- An e2-medium ($25-35/mo) handles both instances with ~1.5-2GB RAM total

**Caddy over Nginx** because:
- Automatic HTTPS with Let's Encrypt (zero config)
- Single binary, no Lua/module complexity

**ntfy over email** for reminders because:
- Will uses an iPad — push notifications are native and instant
- No email infrastructure to maintain (no SMTP, no app passwords)
- Free tier is more than enough for personal use

---

## Current Deployment State

Both instances are **deployed and running**:
- `https://ai-chat.hexapax.com` — full-access instance (Jeremy)
- `https://scout-quest.hexapax.com` — locked-down scout instance (Will)

VM path: `/opt/scoutcoach/` with subdirectories `ai-chat/` and `scout-quest/`

**What's live:**
- Docker Compose stacks: api, mongodb, meilisearch, rag_api, vectordb per instance
- Caddy reverse proxy handling HTTPS for both domains
- Cloud DNS: A records for both domains managed by Terraform (`terraform/dns.tf`)
- Google OAuth working (Testing mode = allowlist-based access control)
- AI providers: Anthropic (working), OpenAI, DeepSeek, OpenRouter
- Password sign-up disabled — OAuth only

**What's design-only (not yet deployed):**
- Scout Quest MCP server (see `docs/mcp-server-design.md`)
- ntfy push notifications
- Reminder cron sidecar

---

## Secret Storage (GCS)

`.env` files contain API keys and OAuth secrets — they must NOT be in git. They're stored in GCS:

```
gs://scout-coach-tfstate/config/ai-chat/.env
gs://scout-coach-tfstate/config/scout-quest/.env
```

Workflow:
```bash
# After editing .env files locally
./deploy-config.sh push       # Upload to GCS

# On a new machine or after VM teardown
./deploy-config.sh pull       # Download from GCS

# Deploy to VM (pulls .env from GCS, combines with git-tracked configs)
./deploy-config.sh gcloud
```

The deploy script creates a temp dir, pulls `.env` from GCS, copies git-tracked `librechat.yaml` and `docker-compose.override.yml` alongside them, uploads the combined set to the VM, then cleans up.

---

## Push Notifications (ntfy)

[ntfy.sh](https://ntfy.sh) sends push notifications to Will's iPad without any email infrastructure.

**In-session:** The MCP `send_notification` tool lets Scout Coach push alerts during a conversation (e.g., "LOOT DROP unlocked!").

**Out-of-session:** A cron sidecar (`scripts/reminder-cron.js`) runs every 4 hours via systemd timer, checks MongoDB for overdue items (missed chores, budget updates, diary entries), and POSTs to ntfy.

**Setup:** Install ntfy app on iPad, subscribe to the topic configured in `NTFY_TOPIC`. Free, no account needed.

---

## Feature Mapping

| Feature | ai-chat | scout-quest |
|---|---|---|
| All AI providers (Claude, GPT, DeepSeek, OpenRouter) | Yes | Via curated presets |
| Model selection | Unrestricted | Locked (`modelSpecs.enforce: true`) |
| Voice mode (STT/TTS) | Yes | Yes |
| Persistent memory | No | Yes (quest progress, preferences) |
| MCP server support | No | Yes (Phase 2) |
| Google OAuth | Yes | Yes |
| Password sign-up | Disabled | Disabled |
| Push notifications | No | Yes (ntfy, Phase 2) |

---

## Access Control

Google OAuth in "Testing" mode serves as the access control layer:
1. OAuth consent screen is set to **Testing** mode in GCP Console
2. Only emails added as **test users** can sign in
3. Password sign-up is disabled (`ALLOW_PASSWORD_SIGN_UP=false`)
4. Each instance has its own OAuth client ID
5. Jeremy is admin on both instances; Will's email is only on scout-quest

---

## LibreChat Agent Configuration

Create a "Scout Coach" agent in LibreChat's Agent Builder (Phase 3, after MCP is deployed):

```
Name: Scout Coach
Model: claude-sonnet-4-5-20250514
System Prompt: [Adapted from Tier 1 system prompt]

MCP Servers: scout-quest (all tools enabled)

Instructions additions for MCP:
- When scout asks "where am I?" → call get_quest_summary
- When scout completes a task → call update_quest_state
- When scout needs to email counselor → call compose_email with proper To/CC
- At start of each session → call check_reminders, then get_quest_state
- When discussing purchases → call search_hardware for current prices
- When scout reports chore done → call log_chore and celebrate streak
- For milestone celebrations → call send_notification
```

---

## Known Gotchas

- MongoDB service name is `mongodb` not `mongo` in docker-compose
- MeiliSearch has non-critical fetch errors on startup — ignore
- OpenAI has quota issue — may affect STT/TTS features
- Caddy handles HTTPS automatically — no cert management needed
- First HTTPS request after deploy takes ~30s for cert issuance
- The `docker-compose.override.yml` uses empty user string for mongodb (runs as default internal user)
- `.env` files must be pushed to GCS before deploying — the deploy script pulls from GCS, not local

---

## iMessage Research Note

We considered iMessage for notifications (Will's iPad is Apple), but Apple has no public iMessage API. Blue Bubbles and similar hacks require a dedicated Mac. ntfy was chosen as the pragmatic alternative — free, works on iPad, no infrastructure. See `docs/future-research.md` for details. Revisit if Apple ever opens an API.
