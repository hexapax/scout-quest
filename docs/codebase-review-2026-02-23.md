# Scout Quest — Codebase Review

**Date:** 2026-02-23
**Scope:** Full codebase review — infrastructure, application code, scripts, configuration, documentation

---

## Executive Summary

Scout Quest is a well-structured project deploying two independent LibreChat instances plus an AdminJS panel on a single GCP VM, backed by Terraform infrastructure-as-code. The codebase demonstrates solid domain modeling, good TypeScript discipline, and clear separation of concerns. However, several areas need attention before production readiness: authentication gaps in the admin panel, silent failure modes in cron jobs, security hardening across deployment scripts, and missing integration tests.

**Overall Assessment: B+** — Strong foundation with operational maturity gaps.

| Component | Grade | Key Concern |
|-----------|-------|-------------|
| Terraform | B+ | SSH open to internet by default; broad VM scopes |
| MCP Server | B+ | Silent cron failures; missing auth checks per-call |
| Admin Panel | B- | OAuth not wired; audit logging unimplemented |
| Deploy Scripts | B | Sed injection risk; `StrictHostKeyChecking=no` |
| Configuration | A- | Clean layering; well-documented |
| Documentation | A | Comprehensive strategy, state tracking, and plans |

---

## 1. Terraform Infrastructure

### Resources Managed (14 total)

| Resource | Name | Purpose |
|----------|------|---------|
| Compute Instance | `scout-coach-vm` | e2-medium running all services |
| Static IP | `scout-coach-ip` | Shared by all three domains |
| VPC + Subnet | `scout-coach-vpc` | Custom network (10.0.1.0/24) |
| Firewall Rules (2) | `allow-web`, `allow-ssh` | HTTP/S + SSH ingress |
| GCS Bucket | `*-backups` | MongoDB dump storage (30-day lifecycle) |
| DNS Records (7) | root, MX, SPF, DKIM, 3 A records | hexapax.com zone in separate project |

State stored in GCS (`scout-assistant-487523-tfstate`) with versioning.

### Strengths

- Clean modular file organization (compute, network, storage, dns, variables, outputs)
- Idempotent bootstrap script with clear cross-project DNS setup
- Custom VPC with explicit subnets (not default network)
- Templated cloud-init with domain variable substitution
- `create_before_destroy` lifecycle for zero-downtime VM updates

### Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| T1 | `ssh_source_ranges` defaults to `0.0.0.0/0` | High | `variables.tf` |
| T2 | VM service account uses `scopes = ["cloud-platform"]` (all GCP permissions) | High | `compute.tf` |
| T3 | No health checks or monitoring resources | Medium | — |
| T4 | No VM snapshot/image automation (single point of failure) | Medium | — |
| T5 | Subnet CIDR hardcoded (`10.0.1.0/24`) — should be a variable | Low | `network.tf` |
| T6 | No resource labels for cost allocation | Low | `compute.tf` |
| T7 | Backup bucket has 30-day auto-delete with no archive tier | Low | `storage.tf` |
| T8 | Cloud-init clones LibreChat HEAD — should pin to commit/tag | Low | `cloud-init.yaml` |

### Recommendations

1. **Restrict SSH**: Set `ssh_source_ranges` to operator IPs in production tfvars
2. **Narrow VM scopes**: Replace `cloud-platform` with `storage.read_write`, `compute.readonly`
3. **Add health check**: `google_compute_health_check` on Caddy endpoint
4. **Add labels**: `environment`, `app`, `owner` for cost tracking

---

## 2. MCP Server (`mcp-servers/scout-quest/`)

### Overview

~5,000 LOC across 67 TypeScript files. Three entry points (scout, admin, guide), 12 MongoDB collections, cron service sidecar, 21 unit tests.

**Architecture:** Clean tool/resource separation with Zod validation on all inputs. YPT (Youth Protection Training) compliance enforced automatically — parent auto-CC'd on emails, RBAC prevents cross-role tool access, troop isolation works correctly.

### Strengths

- Strict TypeScript with Zod validation everywhere — excellent type safety (9/10)
- YPT compliance is automatic and non-bypassable
- RBAC prevents superuser/admin from calling scout tools
- Well-modeled domain (quest state machines, requirement tracking, budget forecasting)
- Good naming conventions and consistent patterns

### Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| M1 | Cron jobs fail silently on API errors (no retry, no alerting) | Critical | `sessionBackfill.ts`, `planReview.ts` |
| M2 | No MongoDB health check on startup (typo in URI = silent failure) | High | Server startup |
| M3 | Per-call auth not consistently applied (some tools skip `canAccess()`) | Medium | `logChore.ts`, `setCharacter.ts` |
| M4 | ntfy.sh notifications lost if service is down (no persistent queue) | Medium | `notifications.ts` |
| M5 | Notification priority sends number (1-5) but ntfy expects strings | Medium | `notifications.ts:18` |
| M6 | N+1 queries in `guideScouts.ts` — no pagination | Medium | `guideScouts.ts` |
| M7 | No database indexes on `scout_email`, `req_id`, `status` | Medium | All collections |
| M8 | Race condition in plan creation (insert then re-query) | Medium | `updateQuestPlan.ts:60-81` |
| M9 | Streak calculation duplicated in two files | Low | `logChore.ts:75-88`, `guideScouts.ts:130-141` |
| M10 | `updateOne()` doesn't check `matchedCount` in some tools | Low | `setCharacter.ts:47` |
| M11 | Environment variables not validated on startup | Low | `cron.ts:24` |

### Test Coverage

| Area | Tests | Status |
|------|-------|--------|
| Validation logic | 11 | Good |
| Auth rules | 10 | Good |
| Tool execution | 0 | Missing |
| Resource handlers | 0 | Missing |
| Cron jobs | 0 | Missing |
| Integration | 0 | Missing |

### Recommendations

1. **Add startup health check**: `await getDb().admin().ping()` before registering tools
2. **Add `canAccess()` to all tools**: Verify user context matches scout/guide email
3. **Implement cron retry**: Exponential backoff on API failures; log failures persistently
4. **Add integration tests**: Use `testcontainers` for ephemeral MongoDB
5. **Create database indexes**: On `scout_email`, `timestamp`, `req_id`, `status`

---

## 3. Admin Panel (`admin/`)

### Overview

~400 LOC of core application logic (AdminJS + Express + Mongoose). Dual MongoDB connections (Scout Quest + LibreChat). 13 Scout Quest resources + 2 system resources + 2 LibreChat resources.

### Strengths

- Lean, focused codebase with clean architecture
- Financial records properly locked from deletion
- LibreChat data correctly read-only
- Proper Mongoose indexing on critical fields
- Multi-stage Docker build with slim base images
- Requirement status transitions validated

### Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| A1 | **Google OAuth not implemented** — `authenticate()` returns `null` always | Critical | `auth.ts` |
| A2 | **Audit logging not implemented** — schema exists but hooks missing | Critical | All resources |
| A3 | No timeout on LibreChat MongoDB connection (hangs indefinitely) | High | `index.ts` |
| A4 | No CSRF protection on AdminJS mutations | High | `index.ts` |
| A5 | No graceful shutdown (SIGTERM/SIGINT handlers) | Medium | `index.ts` |
| A6 | No rate limiting on login attempts | Medium | `index.ts` |
| A7 | Session collection grows unbounded (no cleanup) | Medium | — |
| A8 | Read operations unaudited (bulk data export with no trace) | Medium | All resources |
| A9 | Requirement state transitions duplicated from MCP server | Low | `resources/scout-quest.ts` |
| A10 | No health check endpoint for Docker monitoring | Low | `index.ts` |

### Recommendations

1. **Implement OAuth immediately**: Wire Passport Google strategy with email allowlist
2. **Add audit logging hooks**: Record admin_email, action, old/new values in `before`/`after` hooks
3. **Add connection timeout**: Wrap LibreChat connection in 20s timeout
4. **Add CSRF middleware**: Validate tokens on all mutations
5. **Add signal handlers**: Close MongoDB connections on SIGTERM

---

## 4. Deployment Scripts

### Scripts Reviewed

| Script | LOC | Purpose |
|--------|-----|---------|
| `deploy-config.sh` | ~450 | Main deployment orchestrator |
| `bootstrap.sh` | ~150 | One-time GCP setup |
| `scripts/deploy-admin.sh` | ~90 | Build + deploy admin panel |
| `scripts/deploy-mcp.sh` | ~60 | Deploy MCP server to VM |
| `scripts/build-admin.sh` | ~30 | TypeScript compilation |
| `scripts/nvm-run.sh` | ~15 | nvm wrapper |
| `scripts/ssh-vm.sh` | ~15 | gcloud SSH wrapper |
| `scripts/update-caddyfile.sh` | ~25 | Caddy proxy rule update |

### Strengths

- `set -euo pipefail` used consistently across all scripts
- Trap handlers for temp directory cleanup
- Health checks after deployment
- Clear separation of concerns (push/pull/deploy/upgrade)
- Good help text and examples

### Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| S1 | **Sed injection risk** — security keys with regex chars corrupt `.env` | Critical | `deploy-config.sh:265-272` |
| S2 | `StrictHostKeyChecking=no` on all SSH connections (MITM risk) | High | `deploy-config.sh:90,169,202` |
| S3 | `deploy-admin.sh` tarballs entire `node_modules/` (100s MB, supply chain risk) | High | `deploy-admin.sh:39` |
| S4 | No intermediate error checks — `gcs_push` failure doesn't stop `deploy` | High | `deploy-config.sh:432-434` |
| S5 | Cloud-init polling uses marker file (stale from previous run) | Medium | `deploy-config.sh:164-187` |
| S6 | Hardcoded zone `us-east4-b` in deploy-mcp.sh | Medium | `deploy-mcp.sh:27,31,55` |
| S7 | `nvm-run.sh` assumes `~/.nvm/nvm.sh` exists without checking | Medium | `nvm-run.sh:10` |
| S8 | No Caddyfile syntax validation before reload | Medium | `update-caddyfile.sh` |
| S9 | Placeholder detection logic is fragile (`FILL_IN` string matching) | Medium | `deploy-config.sh:138-139` |
| S10 | No `--dry-run` mode on any deploy script | Low | All scripts |
| S11 | No structured logging or audit trail | Low | All scripts |

### Recommendations

1. **Fix sed injection**: Use pipe delimiters (`s|...|...|g`) or proper escaping for generated keys
2. **Improve SSH security**: Use `StrictHostKeyChecking=accept-new` minimum; pre-populate `known_hosts`
3. **Optimize admin deploy**: Ship `package.json` + `package-lock.json` only; `npm ci --production` on VM
4. **Add error propagation**: Chain `gcs_push && deploy` to stop on failure
5. **Validate cloud-init**: Use `cloud-init status --long` instead of marker file

---

## 5. Configuration & Architecture

### Configuration Layering

The three-tier configuration model is well-designed:

| Layer | Storage | Security |
|-------|---------|----------|
| Public config | Git (librechat.yaml, docker-compose.override.yml) | Versioned, reviewed |
| Secrets | GCS bucket | Never committed, encrypted at rest |
| Auto-generated | VM filesystem | Created on deploy, unique per instance |

### Instance Configuration

| Aspect | ai-chat | scout-quest | admin |
|--------|---------|-------------|-------|
| Access | Unrestricted | Locked (`enforce: true`) | System visibility |
| MCP Servers | scout-admin (11 tools) | scout-quest + scout-guide (26 tools) | — |
| Models | Full selection | Curated presets only | — |
| Database | LibreChat (conversations) | scoutquest (quest data) | Reads both |

### Architectural Concern

**Single point of failure**: Everything runs on one e2-medium VM. Acceptable for pilot with <50 scouts, but needs HA planning for scale.

---

## 6. Documentation Quality

Documentation is a clear strength of this project:

- **`docs/strategy.md`** — Well-articulated vision with clear goals and non-goals
- **`docs/development-state.md`** — Honest, up-to-date status tracking with critical path defined
- **`docs/future-research.md`** — Dead ends documented with "revisit if" conditions (prevents re-investigation)
- **`docs/plans/`** — 8 design specs covering MCP redesign, admin panel, memory, Scoutbook sync
- **`CLAUDE.md`** — Excellent session guide with command reference and conventions

---

## 7. Current Project Status

### Working
- Infrastructure (GCP VM, Docker, Caddy, Terraform)
- Both LibreChat instances with OAuth, speech, model presets
- Admin panel deployed (but auth incomplete)
- MCP server compiles; 26+ tools register

### Blocked
- **No scout data in MongoDB** — waiting on Scoutbook sync
- **Scoutbook sync incomplete** — API client written but orchestration/CLI missing
- **MCP tools untested end-to-end** — tools register but no real data flow verified
- **Tool hallucination** — models sometimes simulate rather than execute MCP calls

### Critical Path to MVP
1. Complete Scoutbook sync (data foundation)
2. Test MCP tools end-to-end with real data
3. Fix tool hallucination behavior
4. Verify cron system actually runs
5. Onboard 2-3 pilot scouts

---

## 8. Priority Action Items

### Critical (Before Any Users)

1. **Implement admin OAuth** (`admin/src/auth.ts`) — users cannot log in
2. **Add MongoDB startup health check** (MCP server) — silent failures on bad URI
3. **Fix sed injection in deploy-config.sh** — credential corruption risk
4. **Implement cron retry logic** — silent data loss on API failures

### High (Before Production)

5. Add `canAccess()` auth checks to all MCP scout/guide tools
6. Add audit logging hooks in admin panel
7. Add connection timeouts (admin panel LibreChat connection)
8. Restrict SSH source ranges in Terraform
9. Narrow VM service account scopes
10. Replace `StrictHostKeyChecking=no` with safer alternatives

### Medium (Before Scale)

11. Add integration tests for MCP tools (testcontainers + MongoDB)
12. Create database indexes on high-cardinality fields
13. Add CSRF protection to admin panel
14. Implement notification retry queue
15. Add health check endpoints for Docker monitoring
16. Validate Caddyfile syntax before reload

### Low (Quality of Life)

17. Add `--dry-run` mode to deployment scripts
18. Parameterize hardcoded zones/project IDs in scripts
19. Add structured logging to deployment scripts
20. Pin LibreChat clone to specific commit in cloud-init
