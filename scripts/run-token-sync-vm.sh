#!/bin/bash
# Run Scoutbook sync on the VM using an injected JWT token.
# Usage: SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

# Write the inline sync script to a temp file on the VM, then run it in the API container
# (API container has the MCP server dist + node_modules + access to MongoDB)

INLINE_SCRIPT='
const TOKEN = process.env.SCOUTBOOK_TOKEN;
const payload = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());
const expDate = new Date(payload.exp * 1000);
if (payload.exp * 1000 < Date.now()) { console.error("Token expired at " + expDate.toISOString()); process.exit(1); }
console.log("Token valid — expires " + expDate.toISOString());
console.log("User: " + payload.user + ", UID: " + payload.uid);

const { ScoutbookApiClient } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/api-client.js");
const { syncAll } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/sync.js");

const client = new ScoutbookApiClient();
client.ensureAuth = async () => TOKEN;

console.log("\nOrg GUID: " + client.orgGuid);
console.log("Unit ID:  " + client.unitId);
console.log("\nStarting full sync...\n");

const result = await syncAll(client);

console.log("\n========================================");
console.log("         Full Sync Complete");
console.log("========================================");
console.log("Roster: " + result.roster.scouts + " scouts, " + result.roster.adults + " adults, " + result.roster.parents + " parents");
const ok = result.scoutResults.filter(r => r.success).length;
const fail = result.scoutResults.filter(r => !r.success).length;
console.log("Scout advancement: " + ok + " succeeded, " + fail + " failed");
if (fail > 0) { for (const r of result.scoutResults.filter(r => !r.success)) { console.log("  FAIL: " + r.userId + " -- " + r.error); } }
if (result.events) { console.log("Events: " + result.events.events); }
console.log("Duration: " + (result.totalDurationMs / 1000).toFixed(1) + "s");
process.exit(0);
'

echo "=== Scoutbook Token Sync ==="

# Write inline script to VM temp file
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="cat > /tmp/token-sync.mjs << 'SCRIPT_EOF'
${INLINE_SCRIPT}
SCRIPT_EOF" 2>/dev/null

# Copy script into the API container and run
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="
    sudo -u scoutcoach docker cp /tmp/token-sync.mjs scout-quest-api:/tmp/token-sync.mjs
    sudo -u scoutcoach docker exec \
      -e SCOUTBOOK_TOKEN='${TOKEN}' \
      -e SCOUTBOOK_ORG_GUID='E1D07881-103D-43D8-92C4-63DEFDC05D48' \
      -e SCOUTBOOK_UNIT_ID='121894' \
      -e SCOUTBOOK_USERNAME='jebramwell' \
      -e SCOUTBOOK_PASSWORD='dummy' \
      -e MONGO_URI='mongodb://mongodb:27017/scoutquest' \
      scout-quest-api node /tmp/token-sync.mjs
  " 2>&1

echo ""
echo "=== Sync complete. Run graph loader next: ==="
echo "  ./scripts/ssh-vm.sh 'sudo -u scoutcoach docker exec scout-quest-backend node dist/graph-loader.js'"
