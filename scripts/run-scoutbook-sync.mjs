#!/usr/bin/env node
/**
 * Run Scoutbook sync-all using an injected JWT token.
 * Bypasses the broken BSA auth endpoint.
 *
 * Usage: SCOUTBOOK_TOKEN=eyJ... node scripts/run-scoutbook-sync.mjs
 *
 * Env vars (auto-detected from MongoDB if not set):
 *   SCOUTBOOK_TOKEN        — Required. BSA JWT from manual Chrome login.
 *   SCOUTBOOK_ORG_GUID     — Unit org GUID (default: from scoutbook_scouts collection)
 *   SCOUTBOOK_UNIT_ID      — Unit ID number (default: from scoutbook_scouts collection)
 *   MONGO_URI              — MongoDB URI (default: mongodb://localhost:27017/scoutquest)
 */

const TOKEN = process.env.SCOUTBOOK_TOKEN;
if (!TOKEN) {
  console.error("SCOUTBOOK_TOKEN env var is required.");
  console.error("Get it by logging into my.scouting.org in Chrome DevTools → Application → Cookies");
  process.exit(1);
}

// Decode JWT to check expiration
const payload = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString());
const expDate = new Date(payload.exp * 1000);
const nowMs = Date.now();
if (payload.exp * 1000 < nowMs) {
  console.error(`Token expired at ${expDate.toISOString()} (${Math.round((nowMs - payload.exp * 1000) / 60000)} min ago)`);
  process.exit(1);
}
console.log(`Token valid — expires ${expDate.toISOString()} (${Math.round((payload.exp * 1000 - nowMs) / 60000)} min from now)`);
console.log(`User: ${payload.user}, UID: ${payload.uid}`);

// Set dummy creds so constructor doesn't throw
process.env.SCOUTBOOK_USERNAME = process.env.SCOUTBOOK_USERNAME || "token-injected";
process.env.SCOUTBOOK_PASSWORD = process.env.SCOUTBOOK_PASSWORD || "token-injected";
process.env.SCOUTBOOK_ORG_GUID = process.env.SCOUTBOOK_ORG_GUID || "E1D07881-103D-43D8-92C4-63DEFDC05D48";
process.env.SCOUTBOOK_UNIT_ID = process.env.SCOUTBOOK_UNIT_ID || "121894";

// Import from the MCP server's compiled output
const { ScoutbookApiClient } = await import("../mcp-servers/scout-quest/dist/scoutbook/api-client.js");
const { syncAll } = await import("../mcp-servers/scout-quest/dist/scoutbook/sync.js");

// MongoDB connects lazily via the db module — just needs MONGO_URI set
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest";

// Create client and monkey-patch auth to use injected token
const client = new ScoutbookApiClient();
client.ensureAuth = async () => TOKEN;

console.log(`\nOrg GUID: ${client.orgGuid}`);
console.log(`Unit ID:  ${client.unitId}`);
console.log("\nStarting full sync...\n");

const result = await syncAll(client);

console.log("\n========================================");
console.log("         Full Sync Complete");
console.log("========================================");
console.log(`\nRoster: ${result.roster.scouts} scouts, ${result.roster.adults} adults, ${result.roster.parents} parents`);

const ok = result.scoutResults.filter(r => r.success).length;
const fail = result.scoutResults.filter(r => !r.success).length;
console.log(`Scout advancement: ${ok} succeeded, ${fail} failed`);
if (fail > 0) {
  for (const r of result.scoutResults.filter(r => !r.success)) {
    console.log(`  FAIL: ${r.userId} — ${r.error}`);
  }
}
if (result.events) {
  console.log(`Events: ${result.events.events}`);
}
console.log(`Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

process.exit(0);
