# Scout Quest Admin App — Design Document

**Date:** 2026-02-21
**Status:** Approved

## Overview

A web-based admin panel for Scout Quest that provides visibility into the system's MongoDB data, LibreChat usage, and operational health. Built on AdminJS (auto-generated Node.js admin framework) with Mongoose adapters, hosted on the same GCP VM alongside the two LibreChat instances.

**Primary user:** Jeremy (admin/developer)
**Secondary users:** Future co-admins (e.g., another parent helping manage scouts)

## Architecture

### Hosting

- Runs on the existing GCE VM (`scout-coach-vm`, e2-medium)
- New Docker Compose stack in `/opt/scoutcoach/admin/`
- Port 3082, reverse-proxied by Caddy at `admin.hexapax.com`
- Joins `scout-shared` Docker network to reach both MongoDB instances

### Authentication

- Google OAuth (same client ID as LibreChat instances)
- Allowlist of admin emails in environment config
- No password login — OAuth only, same pattern as the LibreChat instances

### Network Topology

```
Internet → Caddy :443
             ├── ai-chat.hexapax.com     → ai-chat-api:3080
             ├── scout-quest.hexapax.com  → scout-quest-api:3081
             └── admin.hexapax.com        → scout-admin:3082
                                               │
                                               ├── scout-quest-mongodb:27017/scoutquest
                                               └── ai-chat-mongodb:27017/LibreChat
```

## Data Views (3 Tiers)

### Tier 1: Core Observability (Scout Quest MongoDB)

Full CRUD on the 9 Scout Quest collections:

| Collection | View | Edit | Notes |
|---|---|---|---|
| `scouts` | Yes | Yes | Scout profiles, character config |
| `requirements` | Yes | Yes | Merit badge requirements and approval status |
| `chore_logs` | Yes | Yes | Chore completion records |
| `budget_entries` | Yes | Yes | Earnings, spending, savings |
| `time_mgmt` | Yes | Yes | Time management entries |
| `loan_analysis` | Yes | Yes | Loan analysis records |
| `emails_sent` | Yes | Read-only | Audit trail — no modifications |
| `reminders` | Yes | Yes | Scheduled reminders |
| `users` | Yes | Yes | Scout Quest user records |

### Tier 2: Chat Visibility (LibreChat MongoDB — Read-Only)

Read-only access to LibreChat's own database for observability:

| Collection | Purpose |
|---|---|
| `conversations` | See conversation metadata — who talked, when, which model |
| `messages` | Read message content for debugging/review |
| `users` | See registered users and login activity |

These are read-only to avoid corrupting LibreChat's internal state.

### Tier 3: System Health & External Links

- **Dashboard widgets:** Active scouts count, recent chore activity, budget summaries, last conversation timestamps
- **GCP Log links:** Preset filtered links to Cloud Logging console for each container (api, mongodb, meilisearch per instance)
- **IAM requirement:** Grant `jebramwell@gmail.com` the `roles/logging.viewer` role on `scout-assistant-487523` project so log links work for co-admins

## Technical Stack

| Component | Choice | Rationale |
|---|---|---|
| Framework | AdminJS + Express | Auto-generates CRUD UI from Mongoose schemas |
| Database adapter | `@adminjs/mongoose` | Native Mongoose integration |
| Auth | `@adminjs/express` + Passport Google OAuth | Same OAuth flow as LibreChat |
| MongoDB driver | Mongoose (dual connections) | One connection per MongoDB instance |
| Runtime | Node.js (same version as MCP server) | Consistency with existing stack |
| Containerization | Docker Compose | Same deployment pattern as LibreChat instances |

### Project Structure

```
admin/
├── src/
│   ├── index.ts              # Express + AdminJS setup
│   ├── auth.ts               # Google OAuth + allowlist
│   ├── models/
│   │   ├── scout-quest/      # Mongoose schemas for Scout Quest collections
│   │   │   ├── scout.ts
│   │   │   ├── requirement.ts
│   │   │   ├── chore-log.ts
│   │   │   ├── budget-entry.ts
│   │   │   ├── time-mgmt.ts
│   │   │   ├── loan-analysis.ts
│   │   │   ├── email-sent.ts
│   │   │   ├── reminder.ts
│   │   │   └── user.ts
│   │   └── librechat/        # Mongoose schemas for LibreChat collections (read-only)
│   │       ├── conversation.ts
│   │       ├── message.ts
│   │       └── user.ts
│   ├── resources/            # AdminJS resource configs (list fields, edit fields, actions)
│   │   ├── scout-quest.ts
│   │   └── librechat.ts
│   └── dashboard/            # Custom dashboard component
│       └── index.tsx
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

### Mongoose Schema Strategy

AdminJS requires Mongoose schemas to generate its UI. The MCP server uses the native MongoDB driver. These coexist — Mongoose schemas in the admin app define the same document shapes but are independent from the MCP server's code. If the MCP server adds a field, add it to the admin's Mongoose schema too.

## Data Editing Safety

### Access Levels by Collection Type

| Type | Collections | Permissions |
|---|---|---|
| Scout Quest data | scouts, requirements, chore_logs, budget_entries, time_mgmt, loan_analysis, reminders, users | Full CRUD |
| Audit trails | emails_sent | Read-only (no edit/delete) |
| LibreChat data | conversations, messages, users | Read-only (no edit/delete) |

### Guardrails

- **State machine enforcement:** Requirement status transitions follow the defined workflow (e.g., `not_started` → `in_progress` → `pending_approval` → `approved`). AdminJS `before` hooks validate transitions.
- **Soft delete preferred:** Where applicable, mark records inactive rather than hard-deleting. Budget entries and chore logs should never be deleted — they're financial records.
- **Audit logging:** All write operations logged with timestamp, admin email, old value, and new value. Stored in a dedicated `admin_audit_log` collection.
- **Confirmation dialogs:** Destructive actions (delete, status rollback) require confirmation in the AdminJS UI.

## Deployment

### DNS

- Add `admin.hexapax.com` A record pointing to `136.107.90.113` (same static IP)
- Managed via Terraform in `terraform/dns.tf`

### Caddy

Add reverse proxy rule for `admin.hexapax.com` → `scout-admin:3082` (Caddy auto-handles HTTPS).

### Docker Compose

New stack in `config/admin/` following the same pattern as `config/ai-chat/` and `config/scout-quest/`:
- `docker-compose.yml` with the admin service
- `.env` with `MONGO_URI_SCOUT`, `MONGO_URI_LIBRECHAT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`
- Joins `scout-shared` network

### Build & Deploy

Same pattern as existing instances:
- Build locally (TypeScript → JavaScript)
- Deploy via `deploy-config.sh` (extend to support the admin instance)
- Or: build inside Docker (multi-stage Dockerfile) since this is a standalone app, not a bind-mounted subprocess

## Future Considerations

- **Cost dashboards:** If AI providers expose usage APIs, add cost tracking widgets to the dashboard
- **Webhook alerts:** AdminJS can trigger webhooks on data changes — could notify via ntfy
- **Multi-scout scaling:** Current design handles multiple scouts naturally since all data is per-scout in MongoDB
