#!/bin/bash
# Run Scoutbook sync on the VM using an injected JWT token.
#
# Usage:
#   # Sync ALL scouts in the roster:
#   SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh
#
#   # Sync only specific scouts by userId (space or comma separated):
#   SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh 8539237 12352438
#   SCOUTBOOK_TOKEN=eyJ... SCOUT_IDS="8539237,12352438" bash scripts/run-token-sync-vm.sh
#
# Features:
# - Prints per-scout progress so you can see it's working.
# - Filters local test scouts (personGuid missing).
# - Overrides BOTH ensureAuth and authenticate to use our JWT, so a transient 401
#   does NOT trigger a real BSA auth call with dummy credentials (which cascades
#   to 503 from BSA's auth throttle).
# - Adds randomized jitter between scouts (3-6s) on top of the built-in 1s
#   per-request rate limit, to look less like a burst to BSA.
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

# Collect scout IDs from args (positional) OR env var
SCOUT_IDS="${SCOUT_IDS:-}"
if [ $# -gt 0 ]; then
  SCOUT_IDS="${SCOUT_IDS:+$SCOUT_IDS,}$(IFS=,; echo "$*")"
fi
# Normalize to comma-separated with no spaces
SCOUT_IDS="$(echo "$SCOUT_IDS" | tr ' ' ',' | tr -s ',' | sed 's/^,//;s/,$//')"

INLINE_SCRIPT='
const TOKEN = process.env.SCOUTBOOK_TOKEN;
const SCOUT_IDS_RAW = (process.env.SCOUT_IDS || "").trim();
const TARGET_IDS = SCOUT_IDS_RAW ? SCOUT_IDS_RAW.split(",").filter(Boolean) : null;

const payload = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());
const expDate = new Date(payload.exp * 1000);
if (payload.exp * 1000 < Date.now()) { console.error("Token expired at " + expDate.toISOString()); process.exit(1); }
console.log("Token valid — expires " + expDate.toISOString());
console.log("User: " + payload.user + ", UID: " + payload.uid);

const { ScoutbookApiClient } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/api-client.js");
const sync = await import("/app/mcp-servers/scout-quest/dist/scoutbook/sync.js");
const { scoutbookScouts } = await import("/app/mcp-servers/scout-quest/dist/scoutbook/collections.js");

const client = new ScoutbookApiClient();

// Override BOTH auth methods so the 401-retry path in api-client.ts does not
// call BSA auth with our dummy credentials.
client.ensureAuth = async () => TOKEN;
client.authenticate = async () => {
  client.jwt = TOKEN;
  // Set expiry to payload.exp so ensureAuth does not trigger a refresh loop
  client.jwtExp = payload.exp;
};

// Jitter helper: random delay between min and max ms.
const jitter = (minMs, maxMs) => new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

console.log("Org GUID: " + client.orgGuid);
console.log("Unit ID:  " + client.unitId);
if (TARGET_IDS) {
  console.log("Targeted sync: " + TARGET_IDS.length + " scout(s) — " + TARGET_IDS.join(", "));
} else {
  console.log("Full sync: all scouts in roster");
}

const t0 = Date.now();

if (!TARGET_IDS) {
  console.log("\n[1/4] Roster...");
  const roster = await sync.syncRoster(client);
  console.log(`  ✓ ${roster.scouts} scouts, ${roster.adults} adults, ${roster.parents} parents (${(roster.durationMs/1000).toFixed(1)}s)`);
} else {
  console.log("\n[1/4] Roster... (skipped for targeted sync)");
}

const scoutsCol = await scoutbookScouts();
const filter = TARGET_IDS
  ? { userId: { $in: TARGET_IDS } }
  : { personGuid: { $type: "string" } };
const scouts = await scoutsCol
  .find(filter, { projection: { userId: 1, firstName: 1, lastName: 1, personGuid: 1 } })
  .toArray();

// Still strip any that have no personGuid (test scouts cannot sync regardless)
const realScouts = scouts.filter(s => typeof s.personGuid === "string" && s.personGuid.length > 0);
const skipped = scouts.length - realScouts.length;

if (TARGET_IDS && realScouts.length === 0) {
  console.error("No real scouts matched. Targeted IDs: " + TARGET_IDS.join(","));
  process.exit(1);
}

console.log(`\n[2/4] Scouts (${realScouts.length} to sync${skipped > 0 ? ", " + skipped + " test/no-guid skipped" : ""})...`);
let ok = 0, fail = 0;
for (let i = 0; i < realScouts.length; i++) {
  const s = realScouts[i];
  const label = `${s.userId} ${s.firstName || ""} ${s.lastName || ""}`.trim().padEnd(36);
  const idx = String(i + 1).padStart(2, " ") + "/" + realScouts.length;

  // Randomized pause BETWEEN scouts (skip before the first one).
  if (i > 0) {
    const delayMs = 3000 + Math.random() * 3000;  // 3-6s
    process.stdout.write(`  [${idx}] (pause ${(delayMs/1000).toFixed(1)}s) `);
    await jitter(delayMs, delayMs);
    process.stdout.write("\r");
  }

  try {
    const r = await sync.syncScout(client, s.userId);
    ok++;
    console.log(`  [${idx}] ✓ ${label}  ranks=${r.ranks} MBs=${r.meritBadges} reqs=${r.requirements} (${(r.durationMs/1000).toFixed(1)}s)`);
  } catch (err) {
    fail++;
    const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 90);
    console.log(`  [${idx}] ✗ ${label}  ${msg}`);

    // If we see a 503, pause much longer before the next scout to let BSA cool off.
    if (msg.includes("503")) {
      console.log(`         BSA returned 503 — cooling off 30-60s before next scout`);
      await jitter(30000, 60000);
    }
  }
}
console.log(`  → ${ok} succeeded, ${fail} failed`);

// Only run events/dashboards if this is a full sync
if (!TARGET_IDS) {
  console.log("\n[3/4] Events (next 90 days)...");
  try {
    const ev = await sync.syncEvents(client);
    console.log(`  ✓ ${ev.events} events (${(ev.durationMs/1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n[4/4] Dashboards...");
  try {
    const d = await sync.syncDashboards(client);
    console.log(`  ✓ advancement=${d.advancement} activities=${d.activities} (${(d.durationMs/1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
  }
} else {
  console.log("\n[3/4] Events...    (skipped for targeted sync)");
  console.log("[4/4] Dashboards... (skipped for targeted sync)");
}

console.log(`\n✓ Sync complete in ${((Date.now()-t0)/1000).toFixed(1)}s`);
process.exit(0);
'

echo "=== Scoutbook Token Sync ==="
if [ -n "$SCOUT_IDS" ]; then
  echo "Targeted: $SCOUT_IDS"
fi

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="cat > /tmp/token-sync.mjs << 'SCRIPT_EOF'
${INLINE_SCRIPT}
SCRIPT_EOF" 2>/dev/null

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
  --command="
    sudo -u scoutcoach docker cp /tmp/token-sync.mjs scout-quest-api:/tmp/token-sync.mjs
    sudo -u scoutcoach docker exec \
      -e SCOUTBOOK_TOKEN='${TOKEN}' \
      -e SCOUT_IDS='${SCOUT_IDS}' \
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
