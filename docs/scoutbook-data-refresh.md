# Scoutbook Data Refresh Procedure

**Last updated:** 2026-03-15

## Why Manual Refresh?

The automated sync pipeline (`cli.ts` → `sync.ts`) authenticates via `POST my.scouting.org/api/users/{username}/authenticate`. Since ~March 2026, this endpoint returns **503** from all IPs (not just cloud — residential IPs fail too). The endpoint may have been deprecated or placed behind a WAF.

**Workaround:** Log into BSA manually in Chrome (handles CAPTCHA/MFA), extract the JWT from cookies via Chrome DevTools Protocol, then use it to make API calls from Node.js.

**Revisit automated sync if:** BSA auth endpoint starts returning 200 again, or a new auth flow is discovered.

## Prerequisites

- **Chrome** (Windows or Linux) — any recent version
- **Node.js 24+** — via nvm (`nvm exec 24 node ...`)
- **gcloud CLI** — authenticated as `jeremy@hexapax.com` for VM access
- Scripts in `scripts/`:
  - `fetch-all-scoutbook-data.mjs` — fetches all data from BSA API
  - `generate-mongo-import.mjs` — converts JSON to mongosh import script

## Step-by-Step Refresh

### 1. Launch Chrome with Remote Debugging

**From Windows PowerShell/CMD:**
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug" https://my.scouting.org
```

Or **from WSL2** (if X11/display is working):
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug https://my.scouting.org
```

### 2. Log In Manually

1. Enter username (`jebramwell`) and password in the Chrome window
2. Complete reCAPTCHA if prompted
3. Click LOGIN
4. Navigate to `advancements.scouting.org` — verify you see the roster/dashboard
5. **Important:** Don't close the Chrome window until the data fetch is complete

### 3. Verify Chrome Debug Port is Accessible

From WSL2:
```bash
curl -s http://localhost:9222/json/version | head -3
```
Should show `"Browser": "Chrome/..."`. If not, Chrome may not have started with the debug flag.

### 4. Fetch All Data

```bash
source ~/.nvm/nvm.sh
nvm exec 24 node scripts/fetch-all-scoutbook-data.mjs
```

This will:
- Extract the JWT from Chrome's cookies via CDP
- Make ~230 API calls (roster, advancement, per-requirement detail for all scouts)
- Save to `scouting-org-research/data/fresh/` (~230 JSON files)
- Rate-limited at 800ms between requests (~3-4 minutes total)

**If you get "No JWT token found":** Your BSA session expired. Go back to Chrome and log in again at `advancements.scouting.org/login`.

### 5. Generate MongoDB Import Script

```bash
source ~/.nvm/nvm.sh
nvm exec 24 node scripts/generate-mongo-import.mjs 2>/dev/null | tail -n +2 > /tmp/scoutbook-import.js
```

Verify it looks right:
```bash
head -3 /tmp/scoutbook-import.js   # Should start with "// Auto-generated"
tail -3 /tmp/scoutbook-import.js   # Should end with print statements
wc -l /tmp/scoutbook-import.js     # Should be ~3000 lines
```

### 6. Load into Production MongoDB

```bash
# Set gcloud account
gcloud config set account jeremy@hexapax.com

# Upload to VM
gcloud compute scp /tmp/scoutbook-import.js scout-coach-vm:/tmp/scoutbook-import.js \
  --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap

# Copy into MongoDB container and run
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 \
  --tunnel-through-iap --command="
    sudo docker cp /tmp/scoutbook-import.js ai-chat-mongodb:/tmp/scoutbook-import.js && \
    sudo docker exec ai-chat-mongodb mongosh --quiet scoutquest /tmp/scoutbook-import.js
  "
```

Expected output:
```
Scouts: 20
Adults: 15
Advancement: ~420
Requirements: ~2500
Sync log written

=== Collection Counts ===
  scoutbook_scouts: 20
  scoutbook_adults: 15
  scoutbook_advancement: ~420
  scoutbook_requirements: ~2500
  scoutbook_sync_log: N
```

### 7. Verify in ai-chat

Go to `ai-chat.hexapax.com` and ask the assistant to use the `scoutbook_get_scout_advancement` tool for a specific scout. It should return rank, merit badge, and requirement data.

## What Gets Captured

| Data Type | API Endpoint | Per-Scout? | File Pattern |
|---|---|---|---|
| Youth roster | `/organizations/v2/units/{orgGuid}/youths` | No | `org_units_youths.json` |
| Adult roster | `/organizations/v2/units/{orgGuid}/adults` | No | `org_units_adults.json` |
| Parent roster | `/organizations/v2/units/{orgGuid}/parents` | No | `org_units_parents.json` |
| Patrols | `/organizations/v2/units/{orgGuid}/subUnits` | No | `org_units_subUnits.json` |
| Rank progress | `/advancements/v2/youth/{userId}/ranks` | Yes × 20 | `youth_{userId}_ranks.json` |
| Merit badges | `/advancements/v2/youth/{userId}/meritBadges` | Yes × 20 | `youth_{userId}_meritBadges.json` |
| Awards | `/advancements/v2/youth/{userId}/awards` | Yes × 20 | `youth_{userId}_awards.json` |
| Activity summary | `/advancements/v2/{userId}/userActivitySummary` | Yes × 20 | `youth_{userId}_activitySummary.json` |
| Rank requirements | `/advancements/v2/youth/{userId}/ranks/{rankId}/requirements` | Yes × ~7 per scout | `youth_{userId}_rank_{rankId}_requirements.json` |
| Person profile | `/persons/v2/{userId}/personprofile` | Yes × 20 | `person_{userId}_profile.json` |
| Rank definitions | `/advancements/v2/ranks/{rankId}/requirements` | No × 7 | `ref_rank_{rankId}_requirements.json` |
| Reference data | `/advancements/ranks`, `/meritBadges`, `/awards` | No | `ref_*.json` |
| Dashboards | `/organizations/v2/{orgGuid}/advancementDashboard` | No | `org_advancementDashboard.json` |

## MongoDB Collections

| Collection | Documents | What's In It |
|---|---|---|
| `scoutbook_scouts` | 20 | Youth roster with contact info, rank, patrol, activity summary |
| `scoutbook_adults` | 15 | Adult leaders with positions |
| `scoutbook_parents` | varies | Parent contacts linked to youth |
| `scoutbook_advancement` | ~420 | Rank/MB/award progress per scout (type, name, %, status, dates) |
| `scoutbook_requirements` | ~2,535 | Per-requirement completion for each rank for each scout |
| `scoutbook_sync_log` | N | Sync history with timestamps and counts |

## Troubleshooting

| Problem | Solution |
|---|---|
| "No JWT token found" | Session expired. Log into `advancements.scouting.org` again in Chrome. |
| "No scouting.org tab found" | Chrome isn't open or isn't on a scouting.org page. |
| 401 errors on API calls | Token expired mid-run. Log in again and re-run. |
| Chrome not accessible on port 9222 | Ensure Chrome was started with `--remote-debugging-port=9222`. Close ALL other Chrome windows first if not using `--user-data-dir`. |
| mongosh syntax error | Check for stray nvm output in the import file. First line should be `// Auto-generated`. |
| gcloud permission denied | Run `gcloud config set account jeremy@hexapax.com` first. |

## BSA Session Duration

BSA JWT tokens appear to last ~30-60 minutes. The full data fetch takes ~4 minutes (231 calls at 800ms each), so a single login is usually sufficient. If the session expires mid-run, the script will start getting 401 errors — just log in again and re-run (existing files won't be re-fetched unless they were error files).
