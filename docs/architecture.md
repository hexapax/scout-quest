# Scout Quest — System Architecture

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                  GCP Project: scout-assistant-487523                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              GCE VM (e2-medium, Ubuntu 24.04)                  │  │
│  │              Static IP: 136.107.90.113                         │  │
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
│  │  │  └──┬───┘ └────────┘ │  │  └──┬───┘ └──────┬───────┘ │   │  │
│  │  │     │                │  │     │             │          │   │  │
│  │  │  ┌──▼──────────────┐ │  │  ┌──▼────────────▼───────┐  │   │  │
│  │  │  │ Admin MCP       │ │  │  │ Scout MCP             │  │   │  │
│  │  │  │ (admin.js)      │─┼──┼──│ (scout.js)            │  │   │  │
│  │  │  └─────────────────┘ │  │  └───────────────────────┘  │   │  │
│  │  │  scout-shared network│  │  scout-shared network       │   │  │
│  │  └──────────────────────┘  └─────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────┐                                                   │
│  │ GCS Bucket   │  Terraform state + secret .env files              │
│  └──────────────┘                                                   │
│  ┌──────────────┐                                                   │
│  │ Cloud DNS    │  hexapax.com zone — A records managed by Terraform│
│  └──────────────┘                                                   │
│  ┌──────────────┐                                                   │
│  │ Secret Mgr   │  8 individual API keys (backup, reference)        │
│  └──────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘

External services:
  ├── Anthropic API (Claude — primary model, MCP tool use)
  ├── OpenAI API (GPT-4.1, Whisper STT, TTS)
  ├── Google Gemini API (Gemini 3 Flash — budget MCP tool use)
  ├── DeepSeek API (cheap reasoning, no MCP)
  ├── OpenRouter (open-source models, no MCP)
  └── ntfy.sh (push notifications → Will's iPad)
```

### Admin Panel

A standalone AdminJS container (`scout-admin`, port 3082) provides CRUD visibility into Scout Quest MongoDB and read-only access to LibreChat MongoDB. It connects to both databases via the `scout-shared` Docker network. Deployed via `scripts/deploy-admin.sh` (build locally, tarball SCP, Docker image on VM).

### Docker Compose Services (per instance)

Each LibreChat instance runs 5 containers from the upstream `docker-compose.yml`:

| Service | Container Name Pattern | Purpose |
|---------|----------------------|---------|
| api | `{instance}-api` | LibreChat API + MCP subprocess |
| mongodb | `{instance}-mongodb` | Document store (bind mount: `./data-node`) |
| meilisearch | `{instance}-meilisearch` | Full-text search (bind mount: `./meili_data_v1.35.1`) |
| vectordb | `{instance}-vectordb` | pgvector for RAG embeddings |
| rag_api | `{instance}-rag-api` | RAG API service |

### Docker Networking

- Each LibreChat instance has its own default bridge network (`ai-chat_default`, `scout-quest_default`)
- `scout-shared` is an external bridge network connecting all three stacks
- ai-chat's API and MongoDB containers join `scout-shared` (API for MCP, MongoDB for admin panel read-only access)
- scout-quest's MongoDB joins `scout-shared` to accept connections from ai-chat MCP and admin panel
- The admin container (`scout-admin`) joins `scout-shared` to reach both MongoDB instances

## Why This Architecture

**Two instances on one VM** over a single shared instance because:
- Jeremy (admin/developer) needs unrestricted model access for his own use
- Will (scout) needs a locked-down UI with curated presets and memory
- Separate MongoDB databases prevent any data mixing
- Docker Compose derives project names from directory, so no container conflicts

**Single VM with Docker Compose** over Cloud Run because:
- LibreChat needs MongoDB as a sidecar — Cloud Run would need Atlas
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

All three services are **deployed and running**:
- `https://ai-chat.hexapax.com` — full-access instance (Jeremy)
- `https://scout-quest.hexapax.com` — locked-down scout instance (Will)
- `https://admin.hexapax.com` — AdminJS panel (Jeremy, email-allowlist auth)

VM path: `/opt/scoutcoach/` with subdirectories `ai-chat/`, `scout-quest/`, and `admin/`
VM user: `scoutcoach` (UID=997, GID=986) with Docker group access
Node.js: v24 via nvm (for MCP server builds — build locally, SCP bundle to VM)

**What's live:**
- Docker Compose stacks: api, mongodb, meilisearch, rag_api, vectordb per instance
- Caddy reverse proxy handling HTTPS for both domains
- Cloud DNS: A records for both domains (static IP `136.107.90.113`)
- Google OAuth working (External + Testing mode = allowlist-based access)
- MCP servers: scout-quest (11 scout tools) + scout-admin (11 admin tools) + scout-guide (15 guide tools)
- Model presets wired to MCP via `modelSpecs` with `mcpServers` field
- AI providers: Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, OpenRouter
- Password sign-up disabled — OAuth only
- `scout-shared` Docker network for cross-instance MCP and admin access
- Admin panel: AdminJS on port 3082, CRUD for Scout Quest + read-only LibreChat MongoDB

**What's not yet deployed:**
- Admin panel DNS: `admin.hexapax.com` A record defined in Terraform but not yet applied
- Admin panel auth: Google OAuth wiring (currently email-allowlist with session cookie)
- Cron sidecar for background checks and ntfy notifications (implemented, pending deployment)
- Guide endpoint (`guide.js`) for parent/SM onboarding (implemented, pending deployment)
- Brave Search MCP integration (see `docs/future-research.md`)

---

## MCP Server Architecture

Two entry points from the same TypeScript codebase (`mcp-servers/scout-quest/`):

| Entry Point | Instance | Tools | Resources | Connects To |
|-------------|----------|-------|-----------|-------------|
| `dist/scout.js` | scout-quest | 11 scout tools | 10 resources | Local MongoDB (`mongodb:27017/scoutquest`) |
| `dist/admin.js` | ai-chat | 11 admin tools | 5 resources | Remote MongoDB (`scout-quest-mongodb:27017/scoutquest`) via scout-shared network |
| `dist/guide.js` | scout-quest | 15 guide tools | 5 resources | Local MongoDB (`mongodb:27017/scoutquest`) |

The guide endpoint (`guide.js`) serves parents, scoutmasters, and other trusted adults. It provides guided onboarding to set up a scout's profile, ongoing monitoring of scout progress, and plan adjustment tools.

A **cron sidecar** container runs alongside each LibreChat instance, performing background checks (missed chores, budget gaps, diary reminders) and sending ntfy push notifications. It connects to the same MongoDB and logs all activity to the `cron_log` collection.

MCP servers run as stdio subprocesses inside the LibreChat API container. They are bind-mounted from `./mcp-servers/scout-quest/` on the host into `/app/mcp-servers/scout-quest/` in the container.

**Build & deploy pattern:** Build locally (`npm run build`), tar the `dist/` + `node_modules/` + `package.json`, SCP to VM, extract into both instance directories. npm on the VM has auth issues — always build locally.

---

## Model Presets & MCP Wiring

MCP tools only work on native LibreChat endpoints (`anthropic`, `openAI`, `google`, `bedrock`). Custom endpoints (OpenRouter, DeepSeek) cannot use MCP tools. See `docs/future-research.md` for details.

### Scout-Quest Instance (`enforce: true` — locked UI)

| Preset | Endpoint | Model | MCP | Purpose |
|--------|----------|-------|-----|---------|
| Scout Coach | `anthropic` | claude-sonnet-4-6 | scout-quest | Primary — best character voice + tools |
| Scout Coach (Gemini) | `google` | gemini-3-flash | scout-quest | Budget — great tool use, 6x cheaper |
| Scout Coach (GPT) | `openAI` | gpt-4.1-mini | scout-quest | Budget — solid tool use, 8x cheaper |
| Quick Chat | `Deepseek` (custom) | deepseek-chat | None | Fast general chat, no tools |
| Deep Think | `Deepseek` (custom) | deepseek-reasoner | None | Step-by-step reasoning, no tools |
| Open Explorer | `OpenRouter` (custom) | llama-4-scout | None | Open-source models, no tools |

### AI-Chat Instance (`enforce: false` — admin keeps full access)

| Preset | Endpoint | Model | MCP | Purpose |
|--------|----------|-------|-----|---------|
| Scout Admin | `anthropic` | claude-sonnet-4-6 | scout-admin | Primary admin tools |
| Scout Admin (GPT) | `openAI` | gpt-4.1 | scout-admin | Budget admin tools |

---

## Secret Storage (GCS)

`.env` files contain API keys and OAuth secrets — they must NOT be in git. They're stored in GCS:

```
gs://scout-assistant-487523-tfstate/config/ai-chat/.env
gs://scout-assistant-487523-tfstate/config/scout-quest/.env
gs://scout-assistant-487523-tfstate/config/admin/.env
```

Individual API keys are also stored in GCP Secret Manager for reference/recovery.

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

**Out-of-session (not yet deployed):** A cron sidecar would run periodically, check MongoDB for overdue items (missed chores, budget updates, diary entries), and POST to ntfy.

**Setup:** Install ntfy app on iPad, subscribe to the topic configured in `NTFY_TOPIC`. Free, no account needed.

---

## Feature Mapping

| Feature | ai-chat | scout-quest | admin |
|---|---|---|---|
| All AI providers (Claude, GPT, Gemini, DeepSeek, OpenRouter) | Yes | Via curated presets | N/A |
| Model selection | Unrestricted | Locked (`modelSpecs.enforce: true`) | N/A |
| Voice mode (STT/TTS) | Yes | Yes | N/A |
| Persistent memory | No | Yes (MCP-based: session notes + quest plans) | N/A |
| MCP server | Yes (scout-admin, 11 tools) | Yes (scout-quest, 9 tools) | N/A |
| Google OAuth | Yes | Yes | Email allowlist |
| Password sign-up | Disabled | Disabled | N/A |
| Push notifications (in-session) | No | Yes (ntfy via MCP tool) | N/A |
| MongoDB CRUD (Scout Quest) | No | No | Yes |
| MongoDB read-only (LibreChat) | No | No | Yes |

---

## Access Control

Google OAuth in "External + Testing" mode serves as the access control layer:
1. OAuth consent screen is set to **External** user type, **Testing** publishing status
2. Only emails added as **test users** can sign in
3. Password sign-up is disabled (`ALLOW_PASSWORD_SIGN_UP=false`)
4. `ALLOW_SOCIAL_REGISTRATION=true` required for OAuth users to create accounts
5. Both instances share the same OAuth client ID
6. Jeremy is admin on both instances; Will's email is added as test user

---

## Known Gotchas

### Deployment
- **SCP nesting:** `gcloud compute scp --recurse dir dest` nests inside `dest` if it already exists. Deploy script cleans remote temp dirs first to prevent stale files from prior failed deploys.
- **Volume permissions:** Docker named volumes are root-owned. Upstream compose runs services as `user: "${UID}:${GID}"` (997:986). Don't override volumes — let upstream bind mounts (`./data-node`, `./meili_data_v1.35.1`) work. Data directories must exist and be owned by `scoutcoach` before `docker compose up`.
- **Container hostnames:** Inter-container DNS uses the `container_name` value (e.g., `scout-quest-mongodb`), NOT the service name with a `-1` suffix.
- **MCP server builds:** npm on the VM has auth issues. Build locally, tar `dist/` + `node_modules/` + `package.json`, SCP to VM.
- **`.env` files must be pushed to GCS before deploying** — the deploy script pulls from GCS, not local.

### LibreChat
- **`ALLOW_SOCIAL_REGISTRATION=true`** is required separately from `ALLOW_SOCIAL_LOGIN=true` for Google OAuth users to create accounts.
- **MCP tools only work on native endpoints** — custom endpoints (OpenRouter, DeepSeek) cannot use MCP tools. This is NOT_PLANNED by the LibreChat maintainer.
- **`mcpServers` field placement:** In modelSpecs, `mcpServers` goes inside the `preset` object, not at the model spec list item level.
- MeiliSearch has non-critical fetch errors on startup — ignore.
- First HTTPS request after deploy takes ~30s for Caddy cert issuance.

### Security
- **`<GENERATE>` tokens:** The deploy script auto-generates `CREDS_IV`, `CREDS_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET` on first deploy. Regenerating these invalidates all existing sessions.
- **OAuth consent screen "not eligible" warning:** Google may show this for `@gmail.com` test users even in External+Testing mode. The warning is often cosmetic — try signing in anyway.
