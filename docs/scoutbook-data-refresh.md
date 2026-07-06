# Scoutbook Data Refresh Procedure

**Last updated:** 2026-07-06

## Current State of BSA Auth

The JSON-API auth endpoint (`POST my.scouting.org/api/users/{username}/authenticate`) has returned **503** from all IPs since ~March 2026. The browser sign-in flow at `advancements.scouting.org` still works. All refresh workflows therefore run on an **injected JWT** obtained from a real browser session.

**Revisit automated credential auth if:** the BSA auth endpoint starts returning 200 again, or a new auth flow is discovered. When that happens, retire `scripts/run-token-sync-vm.sh` and call `node dist/scoutbook/cli.js sync-all` directly — the CLI is the canonical path.

## Canonical Workflow (Token-Injection Sync)

Since 2026-05-15 all sync flows are collapsed into a single path: the `sync-with-token` subcommand of `mcp-servers/scout-quest/dist/scoutbook/cli.js`, invoked on the VM via the thin SSH wrapper `scripts/run-token-sync-vm.sh`. Token validation, the auth shim, per-scout iteration, jitter, and the `syncSkip` filter all live in the CLI, not the wrapper.

### 1. Get a JWT token

**Option A — Playwright token refresh (preferred, mostly unattended).** See `scripts/scoutbook-auth/README.md`. One-time interactive bootstrap signs into `advancements.scouting.org` in a persistent Chrome profile (reCAPTCHA scores low on a residential IP); after that, `refresh-token.mjs` re-derives a fresh JWT headlessly from the persisted session cookies (~30-day lifetime). Windows wrappers + Task Scheduler installer live in `scripts/scoutbook-auth/windows/`.

**Option B — manual copy.** Log into `my.scouting.org` / `advancements.scouting.org` in Chrome, then DevTools (F12) → Application → Cookies → copy the JWT starting with `eyJ`.

### 2. Run the sync

```bash
# Sync ALL scouts in the roster:
SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh

# Sync only specific scouts by userId (space or comma separated):
SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh 8539237 12352438
SCOUTBOOK_TOKEN=eyJ... SCOUT_IDS="8539237,12352438" bash scripts/run-token-sync-vm.sh
```

Notes:
- Runs inside the `scout-quest-api` container on the VM against `mongodb://mongodb:27017/scoutquest`.
- Scouts flagged `syncSkip` in MongoDB are suppressed (known-bad syncs; added 2026-05-13).
- From the devbox, cross-project SSH needs `CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT` — see `docs/gcloud-admin-mode.md`.

### 3. Reload the FalkorDB graph

The graph is loaded from MongoDB, so it must be refreshed after every sync:

```bash
./scripts/ssh-vm.sh 'sudo -u scoutcoach docker exec scout-quest-backend node dist/graph-loader.js'
```

### 4. Verify

Ask the assistant (ai-chat, or the scout-quest backend) for a specific scout's advancement — e.g. via `scoutbook_get_scout_advancement` or `get_scout_status` — and confirm rank/merit-badge/requirement data is current. `scoutbook_sync_log` in MongoDB records timestamps and counts per sync.

## MongoDB Collections

| Collection | Documents | What's In It |
|---|---|---|
| `scoutbook_scouts` | ~20 | Youth roster with contact info, rank, patrol, activity summary |
| `scoutbook_adults` | ~15 | Adult leaders with positions |
| `scoutbook_parents` | varies | Parent contacts linked to youth |
| `scoutbook_advancement` | ~420 | Rank/MB/award progress per scout (type, name, %, status, dates) |
| `scoutbook_requirements` | ~2,535 | Per-requirement completion for each rank for each scout |
| `scoutbook_sync_log` | N | Sync history with timestamps and counts |

## Troubleshooting

| Problem | Solution |
|---|---|
| Token rejected / 401 on API calls | JWT expired. Re-run the Playwright refresh or copy a fresh cookie. |
| Playwright refresh fails headlessly | Persisted session cookies expired (~30 days). Re-run the interactive bootstrap — see `scripts/scoutbook-auth/README.md`. |
| gcloud permission denied | `gcloud config set account jeremy@hexapax.com`, or set the impersonation env var per `docs/gcloud-admin-mode.md`. |
| A scout consistently fails to sync | Set `syncSkip` on that scout to suppress it, then investigate. |
| Graph queries return stale data | You forgot step 3 — re-run `graph-loader.js`. |

## Legacy: Chrome CDP Bulk Fetch (retired)

The original workaround (documented here until 2026-07-06) launched Chrome with `--remote-debugging-port=9222`, extracted the JWT via the Chrome DevTools Protocol, bulk-fetched ~230 JSON files with `scripts/scoutbook/fetch-all-data.mjs`, and loaded them with `scripts/mongo/load-fresh-data.mjs`. It was superseded by the token-injection sync above (single-path consolidation, 2026-05-15). The scripts remain in the tree for the API-endpoint catalog embedded in them but should not be used for refreshes; they are deletion candidates once the endpoint reference is captured in `docs/bsa-api-reference.md`.
