# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scout Quest deploys **two independent LibreChat instances** on a single GCP VM:

- **ai-chat** (`ai-chat.hexapax.com`, port 3080) — Full-access AI chat for the admin
- **scout-quest** (`scout-quest.hexapax.com`, port 3081) — Locked-down instance with curated model presets, memory agent, and upcoming MCP server for a Boy Scout quest system

## Common Commands

### Terraform (infrastructure)

```bash
cd terraform
terraform init          # First time / after backend changes
terraform plan          # Preview changes
terraform apply         # Apply infrastructure changes
```

### Deployment

```bash
./deploy-config.sh push              # Upload local .env files to GCS
./deploy-config.sh pull              # Download .env files from GCS
./deploy-config.sh gcloud            # Deploy config to VM via gcloud SSH
./deploy-config.sh <VM_IP>           # Deploy config to VM via direct SSH
./deploy-config.sh update [mode]     # Push .env to GCS + deploy (default: gcloud)
./deploy-config.sh upgrade [mode]    # Pull latest Docker images + restart (default: gcloud)
```

Deploy flow: pulls `.env` from GCS (secrets), combines with git-tracked `librechat.yaml` + `docker-compose.override.yml`, uploads to VM, runs `docker compose up -d`, then HTTP health checks.

### VM Operations (via SSH)

```bash
gcloud compute ssh scoutcoach@scout-coach-vm --zone=us-east4-b
# Logs
docker compose -f /opt/scoutcoach/ai-chat/docker-compose.yml logs -f
docker compose -f /opt/scoutcoach/scout-quest/docker-compose.yml logs -f
# Restart
docker compose -f /opt/scoutcoach/<instance>/docker-compose.yml restart
```

## Architecture

```
Internet → Caddy (auto-HTTPS) → ai-chat:3080 / scout-quest:3081
                                 Each instance: LibreChat + MongoDB + Redis
```

**Dual-instance on one VM** — separate Docker Compose stacks with isolated databases. Docker Compose derives project names from directory names, so no container conflicts.

### Configuration Layers

| Layer | Storage | Examples |
|-------|---------|---------|
| Public (git-tracked) | This repo | `librechat.yaml`, `docker-compose.override.yml`, `.env.example` |
| Secrets (never in git) | GCS bucket `scout-assistant-487523-tfstate` | `.env` files with API keys, OAuth secrets |
| Auto-generated on deploy | VM | `CREDS_IV`, `CREDS_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET` |

### Cross-Project DNS

Terraform manages DNS records in the `hexapax-com` zone owned by the `hexapax-web` GCP project, while all other resources live in the `scout-assistant-487523` project. See `terraform/dns.tf` for import instructions when adding new record types.

## Key Directories

- `config/ai-chat/` — Full-access instance config (librechat.yaml, docker-compose.override.yml, .env.example)
- `config/scout-quest/` — Locked-down instance config (model presets enforced, memory agent enabled)
- `terraform/` — GCP infrastructure: VM, VPC, firewall, static IP, Cloud DNS, GCS backup bucket
- `docs/` — Architecture rationale, MCP server design spec, future research notes

## Conventions

- **Secrets** go in `.env` files synced via GCS, never committed to git
- **Instance configs** (`librechat.yaml`, `docker-compose.override.yml`) are git-tracked and mounted into containers at deploy time
- **`deploy-config.sh`** is the single entry point for all deployment operations — it validates `.env` files for unfilled placeholders before deploying
- **`bootstrap.sh`** is idempotent GCP setup (run once per project)
- **Terraform state** lives in GCS (`scout-assistant-487523-tfstate` bucket)

## MCP Server

A TypeScript MCP server in `mcp-servers/scout-quest/` provides quest state management, chore tracking, email composition (YPT-compliant), reminders, and ntfy push notifications. Two entry points: `dist/scout.js` (scout-facing, registered on scout-quest instance) and `dist/admin.js` (admin-facing, registered on ai-chat instance). Runs as stdio subprocess inside the LibreChat API container, connecting to shared MongoDB. Build with `cd mcp-servers/scout-quest && bash build.sh`. Design spec in `docs/mcp-server-design.md`.
