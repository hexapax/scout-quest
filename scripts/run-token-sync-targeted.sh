#!/bin/bash
# Targeted Scoutbook sync — only syncs a specific list of scout userIds.
# Much faster than full sync when you only need fresh data for a few scouts.
# Usage: SCOUTBOOK_TOKEN=eyJ... SCOUT_IDS="12352438,8539237,..." bash scripts/run-token-sync-targeted.sh
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"
SCOUT_IDS="${SCOUT_IDS:?SCOUT_IDS env var is required (comma-separated userIds)}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

INLINE_SCRIPT='
const TOKEN = process.env.SCOUTBOOK_TOKEN;
const IDS = (process.env.SCOUT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const payload = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());
if (payload.exp * 1000 < Date.now()) { console.error("Token expired"); process.exit(1); }
console.log("Token valid for user " + payload.user + " — syncing " + IDS.length + " scout(s)");

const { ScoutbookApiClient } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/api-client.js");
const { syncScout } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/sync.js");

const client = new ScoutbookApiClient();
client.ensureAuth = async () => TOKEN;

const start = Date.now();
let ok = 0, fail = 0;
for (const id of IDS) {
  try {
    const r = await syncScout(client, id);
    console.log("  ✓ " + id + " — " + r.ranks + " ranks, " + r.meritBadges + " MBs, " + r.requirements + " reqs, " + (r.durationMs/1000).toFixed(1) + "s");
    ok++;
  } catch (err) {
    console.log("  ✗ " + id + " — " + (err instanceof Error ? err.message : err));
    fail++;
  }
}
console.log("\nDone: " + ok + " succeeded, " + fail + " failed in " + ((Date.now()-start)/1000).toFixed(1) + "s");
process.exit(0);
'

echo "=== Targeted Scoutbook Sync ==="
echo "Scout IDs: $SCOUT_IDS"

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="cat > /tmp/token-sync-targeted.mjs << 'SCRIPT_EOF'
${INLINE_SCRIPT}
SCRIPT_EOF" 2>/dev/null

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="
    sudo -u scoutcoach docker cp /tmp/token-sync-targeted.mjs scout-quest-api:/tmp/token-sync-targeted.mjs
    sudo -u scoutcoach docker exec \
      -e SCOUTBOOK_TOKEN='${TOKEN}' \
      -e SCOUT_IDS='${SCOUT_IDS}' \
      -e SCOUTBOOK_ORG_GUID='E1D07881-103D-43D8-92C4-63DEFDC05D48' \
      -e SCOUTBOOK_UNIT_ID='121894' \
      -e SCOUTBOOK_USERNAME='jebramwell' \
      -e SCOUTBOOK_PASSWORD='dummy' \
      -e MONGO_URI='mongodb://mongodb:27017/scoutquest' \
      scout-quest-api node /tmp/token-sync-targeted.mjs
  " 2>&1
