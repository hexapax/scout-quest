# Devbox LibreChat + Claude Code — Design

**Date:** 2026-02-24
**Status:** Approved

## Goal

Move scout-quest development off the local machine onto the devbox VM (`hexapax-devbox` project). Provide a web-accessible LibreChat instance backed by Claude Code for collaborative coding, plus headless browser automation. Access via IAP-protected public URL from any device (phone, laptop).

## Architecture

```
Phone/Laptop browser → devbox.hexapax.com (HTTPS)
  → GCP Global HTTPS Load Balancer (managed SSL cert)
    → IAP (Google OAuth: jeremy@hexapax.com)
      → devbox-vm :3080 (no external IP, us-east4-b)
        └── LibreChat (native Node.js)
              ├── MongoDB (Docker, localhost:27017)
              ├── Redis (Docker, localhost:6379)
              ├── MCP: claude-code-mcp (stdio)
              │     └── claude CLI → ~/scout-quest
              └── MCP: @playwright/mcp --headless (stdio)
                    └── headless Chromium
```

## Components

### 1. IAP HTTP(S) Web Access

Public URL `devbox.hexapax.com` protected by Identity-Aware Proxy. Uses a Global HTTPS Load Balancer — the standard GCP pattern for web access to VMs without external IPs.

**GCP Resources (Terraform):**

| Resource | Purpose |
|----------|---------|
| `google_compute_global_address` | Static IP for load balancer |
| `google_compute_managed_ssl_certificate` | Auto-managed cert for `devbox.hexapax.com` |
| `google_compute_instance_group` | Unmanaged, wraps devbox-vm |
| `google_compute_health_check` | HTTP health check on :3080 |
| `google_compute_backend_service` | Backend with IAP enabled |
| `google_compute_url_map` | Routes all traffic to backend |
| `google_compute_target_https_proxy` | HTTPS termination |
| `google_compute_global_forwarding_rule` | Binds static IP to proxy |
| `google_iap_web_backend_service_iam_member` | Grants `jeremy@hexapax.com` access |
| `google_dns_record_set` | A record in `hexapax-com` zone (hexapax-web project) |
| `google_compute_firewall` | Allow health checks + LB (130.211.0.0/22, 35.191.0.0/16) to :3080 |

**IAP OAuth:** Uses the project's OAuth consent screen. IAP is configured on the backend service with `iap { enabled = true }`. Only `jeremy@hexapax.com` is authorized.

### 2. LibreChat (Native Install)

Run LibreChat natively (not Docker) so MCP stdio subprocesses have direct filesystem access to the repo.

- **Node.js:** Already installed via nvm (v24). LibreChat needs >=20.19.0.
- **Install:** `git clone LibreChat`, `npm ci`, `npm run frontend`, `npm run backend`
- **Config:** `.env` + `librechat.yaml` in the LibreChat directory
- **Auth:** Local email/password registration (single user, no OAuth for the app)
- **Models:** API keys for Anthropic, OpenAI, Google in `.env`

### 3. MongoDB + Redis (Docker)

```bash
docker run -d --name librechat-mongo --restart unless-stopped \
  -p 127.0.0.1:27017:27017 \
  -v librechat-mongo-data:/data/db \
  mongo:7

docker run -d --name librechat-redis --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine
```

LibreChat connects via `MONGO_URI=mongodb://localhost:27017/LibreChat` and `REDIS_URI=redis://localhost:6379`.

### 4. claude-code-mcp (MCP Server)

`@steipete/claude-code-mcp` — wraps Claude Code CLI as a single `claude_code` MCP tool. Each call shells out to `claude` with `--dangerously-skip-permissions` (safe on isolated VM).

**librechat.yaml:**
```yaml
mcpServers:
  claude-code:
    type: stdio
    command: npx
    args: ["-y", "@steipete/claude-code-mcp@latest"]
    env:
      CLAUDE_WORK_DIR: /home/devuser/scout-quest
```

**Usage:** Any model preset in LibreChat can call the `claude_code` tool. The LibreChat model describes what it wants done, Claude Code executes it. One-shot per tool call — no persistent sessions.

### 5. @playwright/mcp (Browser Automation)

Official Microsoft Playwright MCP server running headless Chromium.

**librechat.yaml:**
```yaml
mcpServers:
  browser:
    type: stdio
    command: npx
    args: ["@playwright/mcp@latest", "--headless"]
```

**Setup:** `npx playwright install --with-deps chromium` (one-time, installs browser + system deps).

**Capabilities:** 26 tools — navigate, click, fill forms, take screenshots, read page content via accessibility tree snapshots (token-efficient, no vision model required).

### 6. Cross-Project IAM

The devbox VM's default service account needs permissions in other projects so Claude Code can run Terraform, manage DNS, deploy to the scout-quest VM, etc.

| Target Project | Role | Purpose |
|---------------|------|---------|
| `scout-assistant-487523` | `roles/editor` | Terraform for scout-quest infra (VM, firewall, GCS, etc.) |
| `hexapax-web` | `roles/dns.admin` | Manage `hexapax-com` DNS zone records |
| `hexapax-devbox` | Default SA permissions | Home project (already has access) |

**Implementation:** `google_project_iam_member` resources in the devbox Terraform, granting the VM's SA email roles in the target projects. The SA needs `roles/iam.serviceAccountUser` in scout-assistant if it needs to act as `scout-deployer` for certain operations.

**Note:** The existing scout-quest Terraform uses `credentials = file(var.credentials_file)` (SA key). On the devbox, Terraform should use Application Default Credentials (the VM's SA) instead. May need to adjust the scout-quest Terraform provider config or set `GOOGLE_APPLICATION_CREDENTIALS` to use the devbox SA.

## Authentication

Three independent auth layers — no federation needed.

| Layer | Identity | Method | Billing |
|-------|----------|--------|---------|
| **IAP** | `jeremy@hexapax.com` | Google OAuth (GCP org) | N/A |
| **LibreChat app** | Local registered user | Email/password | N/A |
| **LibreChat → AI models** | API keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_KEY` | Per-token |
| **claude-code-mcp → Claude CLI** | `jebramwell@gmail.com` | Anthropic OAuth token on disk | Max plan (included) |

### Claude Code Auth Flow

One-time setup: SSH into devbox, run `claude login` as devuser. Copy the URL to a browser, sign in as `jebramwell@gmail.com` (Max plan), paste code back. Token stored in `~/.claude/`. The claude-code-mcp subprocess inherits this token.

If the token expires, re-auth from any SSH session. Future enhancement: the LibreChat model could detect auth errors and prompt you.

## LibreChat Model Presets

Minimal configuration for development use. Not the full scout-quest preset system.

| Preset | Endpoint | Model | MCP Servers | Purpose |
|--------|----------|-------|-------------|---------|
| Claude Sonnet | `anthropic` | claude-sonnet-4-6 | claude-code, browser | Primary coding assistant |
| Claude Haiku | `anthropic` | claude-haiku-4-5-20251001 | claude-code, browser | Cheap quick tasks |
| GPT-4.1 | `openAI` | gpt-4.1 | claude-code, browser | Alternative, 1M context |
| Quick Chat | `anthropic` | claude-haiku-4-5-20251001 | none | Fast chat, no tools |

## What's NOT in Scope

- **Persistent Claude Code sessions** — each tool call is one-shot. Upgrade path: Agent SDK wrapper MCP server.
- **Model-as-approver hooks** — future enhancement. Each Claude Code invocation runs with full permissions.
- **LibreChat Google OAuth** — local auth only. Single user on isolated VM.
- **Caddy** — not needed. The GCP load balancer handles HTTPS termination.
- **Scoutbook sync / MCP servers** — those stay on the production scout-quest VM.

## Cloud-Init Updates

The existing `cloud-init.yaml` needs updates for the new components:

- Install Playwright system dependencies
- Install LibreChat and build frontend
- Start MongoDB and Redis Docker containers
- Create a systemd service for LibreChat
- Clone scout-quest repo as devuser

These should be scripted rather than in cloud-init (cloud-init runs once). A setup script (`devbox/scripts/setup-librechat.sh`) handles initial provisioning and can be re-run for updates.

## Directory Layout on VM

```
/home/devuser/
  ├── scout-quest/          # Git repo (working directory for Claude Code)
  ├── LibreChat/            # LibreChat installation
  │   ├── .env              # API keys, MongoDB URI
  │   └── librechat.yaml    # MCP servers, model presets
  └── .claude/              # Claude Code OAuth token
```

## Future Enhancements

1. **Agent SDK wrapper MCP** — replace claude-code-mcp with a custom server using `@anthropic-ai/claude-agent-sdk` for persistent sessions and approval routing.
2. **Model-as-approver** — PreToolUse hook calling Haiku/nano to review commands against a policy doc. Escalates only ambiguous cases to the human.
3. **LibreChat Agents endpoint** — configure a Claude Code Agent with fine-grained tool selection instead of model spec presets.
4. **Terraform from devbox** — once IAM is set up, all infra management happens from the devbox. Local machine only needs a browser.
