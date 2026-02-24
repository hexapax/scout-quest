# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scout Quest deploys **two independent LibreChat instances** on a single GCP VM:

- **ai-chat** (`ai-chat.hexapax.com`, port 3080) — Full-access AI chat for the admin
- **scout-quest** (`scout-quest.hexapax.com`, port 3081) — Locked-down instance with curated model presets, memory agent, and MCP server for a Boy Scout quest system
- **admin** (`admin.hexapax.com`, port 3082) — AdminJS web panel for MongoDB visibility and system observability

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
./scripts/deploy-admin.sh [gcloud]   # Build + deploy admin app to VM
./scripts/update-caddyfile.sh        # Update Caddy reverse proxy rules on VM
```

Deploy flow: pulls `.env` from GCS (secrets), combines with git-tracked `librechat.yaml` + `docker-compose.override.yml`, uploads to VM, runs `docker compose up -d`, then HTTP health checks.

### Helper Scripts

```bash
./scripts/nvm-run.sh <cmd> [args]    # Run any command with nvm Node.js 24
./scripts/build-admin.sh [--docker]  # Build admin app (TS compile, optional Docker)
./scripts/deploy-admin.sh [gcloud]   # Full admin deploy: build, SCP, Docker, start
./scripts/ssh-vm.sh "command"        # Run a command on the VM via gcloud SSH
./scripts/update-caddyfile.sh        # Update Caddy with all three reverse proxy rules
```

### Devbox (remote development)

```bash
terraform -chdir=devbox/terraform plan      # Preview devbox infra changes
terraform -chdir=devbox/terraform apply     # Apply devbox infra changes
bash devbox/scripts/deploy-librechat.sh     # Deploy LibreChat to devbox VM
gcloud compute ssh devbox-vm --zone=us-east4-b --project=hexapax-devbox --tunnel-through-iap  # SSH into devbox
```

### VM Operations (via SSH)

```bash
./scripts/ssh-vm.sh "docker compose -f /opt/scoutcoach/ai-chat/docker-compose.yml logs -f"
./scripts/ssh-vm.sh "docker compose -f /opt/scoutcoach/scout-quest/docker-compose.yml logs -f"
./scripts/ssh-vm.sh "docker compose -f /opt/scoutcoach/admin/docker-compose.yml logs -f"
./scripts/ssh-vm.sh "cd /opt/scoutcoach/<instance> && docker compose restart"
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
- `config/admin/` — Admin panel deployment config (docker-compose.yml, .env.example)
- `admin/` — Admin panel source (AdminJS + Express + Mongoose, TypeScript)
- `scripts/` — Helper bash scripts for building, deploying, and VM operations
- `terraform/` — GCP infrastructure: VM, VPC, firewall, static IP, Cloud DNS, GCS backup bucket
- `docs/` — Architecture, designs, research, and requirements
- `docs/strategy.md` — **Project vision, goals, and strategic direction. Read first for context on why this project exists and where it's heading.**
- `docs/development-state.md` — **Current state of every component, critical path to MVP, known issues. Read to understand what's working and what's not.**
- `docs/future-research.md` — **Research store: constraints, cost analysis, dead ends. Read before pursuing new integrations or model changes.**
- `docs/plans/` — Design specs and implementation plans
- `mcp-servers/scout-quest/` — MCP server source (TypeScript, two entry points)

## Conventions

- **Secrets** go in `.env` files synced via GCS, never committed to git
- **Instance configs** (`librechat.yaml`, `docker-compose.override.yml`) are git-tracked and mounted into containers at deploy time
- **`deploy-config.sh`** is the single entry point for all deployment operations — it validates `.env` files for unfilled placeholders before deploying
- **`bootstrap.sh`** is idempotent GCP setup (run once per project)
- **Terraform state** lives in GCS (`scout-assistant-487523-tfstate` bucket)

## MCP Server

A TypeScript MCP server in `mcp-servers/scout-quest/` provides quest state management, chore tracking, email composition (YPT-compliant), reminders, and ntfy push notifications. Two entry points: `dist/scout.js` (scout-facing, registered on scout-quest instance) and `dist/admin.js` (admin-facing, registered on ai-chat instance). Runs as stdio subprocess inside the LibreChat API container, connecting to shared MongoDB. Build with `cd mcp-servers/scout-quest && bash build.sh`. Design spec in `docs/plans/2026-02-21-mcp-server-redesign.md`.

## Admin Panel

An AdminJS-based web admin panel in `admin/` provides CRUD visibility into Scout Quest MongoDB, read-only access to LibreChat MongoDB, and a dashboard with system health widgets. Design doc: `docs/plans/2026-02-21-admin-app-design.md`. Implementation plan: `docs/plans/2026-02-21-admin-app-implementation.md`.

## Bash Command Conventions

**Use helper scripts for complex commands.** Claude Code's permission system has a known bug with commands containing quotes, `$()` substitutions, and array syntax like `@()`. To avoid permission prompts:

1. **NEVER use `cd /path && command` compound patterns** — the permission system treats `&&` as a security boundary, so `Bash(cd *)` won't match `cd /path && npx tsc`. Instead use absolute paths: `npx tsc --project /abs/path/tsconfig.json` or `git -C /abs/path status`
2. **Write a bash script in `scripts/`** instead of running complex inline commands
3. **Use `./scripts/nvm-run.sh`** to wrap any command that needs nvm/Node.js 24
4. **Use `./scripts/ssh-vm.sh "command"`** instead of inline `gcloud compute ssh` with complex commands
5. **Never use `@()` array syntax** in inline Bash tool calls — it triggers permission bugs
6. **Prefer heredocs in scripts** over inline heredocs in Bash tool calls
7. **For git commits** use `git commit -m "simple message"` — avoid heredocs in commit messages when possible
8. **For npx/npm in subdirectories** use `npx --prefix /abs/path <command>` instead of `cd /path && npx <command>`

When a command would require quotes-within-quotes or shell expansions that trip the permission system, create a temporary script in `scripts/` and run it with `bash scripts/my-script.sh`.

## Research & Multi-Session Protocol

- **Before pursuing new integrations, model strategies, or endpoint changes:** read `docs/future-research.md` — it contains evaluated options, known constraints, and dead ends
- **Update findings immediately** — when a session discovers a constraint or evaluates an option, update `docs/future-research.md` before the session ends
- **Dead ends must include:** why it failed, source links, and a "Revisit if:" condition
- **Key constraint:** MCP tools only work on native LibreChat endpoints (`openAI`, `anthropic`, `google`, `bedrock`). Custom endpoints (OpenRouter, DeepSeek) cannot use MCP tools. See `docs/future-research.md` for details.
- **Multi-session safety:** check `git status` before editing shared config files — another session may have uncommitted changes. Use git worktrees for parallel implementation work.
