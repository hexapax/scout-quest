#!/bin/bash
# Scoutbook data sync using a manually-obtained JWT token.
#
# The BSA auth endpoint is broken (503), so we extract the token
# from a Chrome browser session via CDP.
#
# Usage:
#   1. Open Chrome with remote debugging:
#      google-chrome --remote-debugging-port=9222 https://my.scouting.org
#   2. Log in manually in the Chrome window
#   3. Run this script:
#      ./scripts/scoutbook-token-sync.sh
#
# The script will:
#   a) Connect to Chrome CDP on port 9222
#   b) Extract the JWT from cookies
#   c) Run the Scoutbook sync-all against production MongoDB
#   d) Reload the FalkorDB graph

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Scoutbook Token Sync ==="
echo ""

# Step 1: Extract JWT from Chrome CDP
echo "Step 1: Extracting JWT from Chrome CDP (port 9222)..."
TOKEN=$(node -e '
async function main() {
  // Get list of targets from Chrome CDP
  const resp = await fetch("http://localhost:9222/json");
  const targets = await resp.json();

  // Find a my.scouting.org page
  const target = targets.find(t => t.url && t.url.includes("scouting.org"));
  if (!target) {
    console.error("No scouting.org tab found in Chrome. Make sure you are logged in.");
    process.exit(1);
  }

  // Connect via WebSocket to extract cookies
  const wsUrl = target.webSocketDebuggerUrl;
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve) => ws.on("open", resolve));

  // Request cookies
  const id = 1;
  ws.send(JSON.stringify({ id, method: "Network.getAllCookies" }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id === id) {
      const cookies = msg.result?.cookies || [];
      // Look for the JWT token cookie (varies by BSA site)
      const tokenCookie = cookies.find(c =>
        c.name === "Authorization" ||
        c.name === "token" ||
        c.name === "access_token" ||
        (c.value && c.value.startsWith("eyJ") && c.value.length > 100)
      );

      if (tokenCookie) {
        // Output just the token value
        let val = tokenCookie.value;
        if (val.startsWith("bearer%20")) val = decodeURIComponent(val).replace("bearer ", "");
        if (val.startsWith("Bearer ")) val = val.slice(7);
        console.log(val);
      } else {
        // Try localStorage via Runtime.evaluate
        ws.send(JSON.stringify({
          id: 2,
          method: "Runtime.evaluate",
          params: { expression: "localStorage.getItem(\"token\") || sessionStorage.getItem(\"token\") || document.cookie" }
        }));
      }
      ws.close();
    }
  });

  // Timeout after 5 seconds
  setTimeout(() => { console.error("CDP timeout"); process.exit(1); }, 5000);
}
main();
' 2>/dev/null) || true

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo ""
  echo "Could not auto-extract token from Chrome CDP."
  echo ""
  echo "Manual extraction steps:"
  echo "  1. In Chrome (logged into my.scouting.org), open DevTools (F12)"
  echo "  2. Go to Application > Cookies > https://my.scouting.org"
  echo "  3. Find the cookie that starts with 'eyJ' (the JWT)"
  echo "  4. Copy its value and paste it below."
  echo ""
  read -r -p "Paste JWT token: " TOKEN
fi

if [ -z "$TOKEN" ]; then
  echo "No token provided. Aborting."
  exit 1
fi

echo "  Token extracted (${#TOKEN} chars)"

# Validate JWT structure
if ! echo "$TOKEN" | grep -qE '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'; then
  echo "WARNING: Token doesn't look like a valid JWT. Proceeding anyway..."
fi

# Step 2: Run sync with injected token
echo ""
echo "Step 2: Running Scoutbook sync-all..."

# The sync CLI requires SCOUTBOOK_USERNAME/PASSWORD but we'll patch around auth.
# Instead, we write a small inline Node script that injects the token directly.
cd "$PROJECT_ROOT/mcp-servers/scout-quest"

node -e "
import { ScoutbookApiClient } from './dist/scoutbook/api-client.js';
import { syncAll } from './dist/scoutbook/sync.js';
import { connectDb } from './dist/db.js';

// Create client with dummy creds (we inject the token directly)
process.env.SCOUTBOOK_USERNAME = process.env.SCOUTBOOK_USERNAME || 'token-injected';
process.env.SCOUTBOOK_PASSWORD = process.env.SCOUTBOOK_PASSWORD || 'token-injected';
process.env.SCOUTBOOK_ORG_GUID = process.env.SCOUTBOOK_ORG_GUID || '';
process.env.SCOUTBOOK_UNIT_ID = process.env.SCOUTBOOK_UNIT_ID || '';

const client = new ScoutbookApiClient();

// Inject token by overriding ensureAuth
const token = process.argv[1];
client.ensureAuth = async () => token;

await connectDb();
console.log('Starting full sync...');
const result = await syncAll(client);

console.log('\n========================================');
console.log('         Full Sync Complete');
console.log('========================================');
console.log('Roster:', result.roster);
const ok = result.scoutResults.filter(r => r.success).length;
const fail = result.scoutResults.filter(r => !r.success).length;
console.log('Scout advancement:', ok, 'succeeded,', fail, 'failed');
if (result.events) console.log('Events:', result.events.events);
console.log('Duration:', (result.totalDurationMs / 1000).toFixed(1) + 's');

process.exit(0);
" "$TOKEN"

SYNC_EXIT=$?

if [ $SYNC_EXIT -ne 0 ]; then
  echo "Sync failed (exit code $SYNC_EXIT)"
  exit $SYNC_EXIT
fi

# Step 3: Reload FalkorDB graph
echo ""
echo "Step 3: Reloading FalkorDB graph..."
echo "  (Run on VM: docker exec scout-quest-backend node dist/graph-loader.js)"
echo "  Skipping — run this manually on the VM after deploying the new data."

echo ""
echo "=== Scoutbook sync complete ==="
