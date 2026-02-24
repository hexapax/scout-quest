#!/usr/bin/env node

/**
 * Scoutbook Sync CLI
 *
 * Usage:
 *   node dist/scoutbook/cli.js [command] [options]
 *
 * Commands:
 *   sync-roster              Sync troop roster (youth, adults, parents)
 *   sync-scout <userId>      Sync advancement for a single scout
 *   sync-events              Sync events for the next 90 days
 *   sync-all                 Run full sync: roster + all scouts + events (default)
 *
 * Options:
 *   --dry-run                Test auth and config only — no DB writes
 *   --help                   Show this help message
 *
 * Required env vars:
 *   SCOUTBOOK_USERNAME       BSA login username
 *   SCOUTBOOK_PASSWORD       BSA login password
 *   SCOUTBOOK_ORG_GUID       Unit org GUID
 *   SCOUTBOOK_UNIT_ID        Unit ID
 *   MONGO_URI                MongoDB connection string (default: mongodb://mongodb:27017/scoutquest)
 */

import { ScoutbookApiClient } from "./api-client.js";
import { syncRoster, syncScout, syncEvents, syncAll } from "./sync.js";
import type { SyncRosterResult, SyncScoutResult, SyncEventsResult, SyncAllResult } from "./sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
Scoutbook Sync CLI

Usage:
  node dist/scoutbook/cli.js [command] [options]

Commands:
  sync-roster              Sync troop roster (youth, adults, parents)
  sync-scout <userId>      Sync advancement for a single scout
  sync-events              Sync events for the next 90 days
  sync-all                 Run full sync: roster + all scouts + events (default)

Options:
  --dry-run                Test auth and config only — no DB writes
  --help, -h               Show this help message

Required env vars:
  SCOUTBOOK_USERNAME       BSA login username
  SCOUTBOOK_PASSWORD       BSA login password
  SCOUTBOOK_ORG_GUID       Unit org GUID
  SCOUTBOOK_UNIT_ID        Unit ID
  MONGO_URI                MongoDB connection string
  `.trim());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  if (ms < 60_000) return `${secs}s`;
  const mins = Math.floor(ms / 60_000);
  const remainSecs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${remainSecs}s`;
}

function printRosterResult(result: SyncRosterResult): void {
  console.log("\n--- Roster Sync Complete ---");
  console.log(`  Scouts:  ${result.scouts}`);
  console.log(`  Adults:  ${result.adults}`);
  console.log(`  Parents: ${result.parents}`);
  console.log(`  Duration: ${formatDuration(result.durationMs)}`);
}

function printScoutResult(result: SyncScoutResult): void {
  console.log("\n--- Scout Sync Complete ---");
  console.log(`  User ID:      ${result.userId}`);
  console.log(`  Ranks:        ${result.ranks}`);
  console.log(`  Merit Badges: ${result.meritBadges}`);
  console.log(`  Awards:       ${result.awards}`);
  console.log(`  Requirements: ${result.requirements}`);
  console.log(`  Duration:     ${formatDuration(result.durationMs)}`);
}

function printEventsResult(result: SyncEventsResult): void {
  console.log("\n--- Events Sync Complete ---");
  console.log(`  Events:   ${result.events}`);
  console.log(`  Duration: ${formatDuration(result.durationMs)}`);
}

function printAllResult(result: SyncAllResult): void {
  console.log("\n========================================");
  console.log("         Full Sync Complete");
  console.log("========================================");

  console.log("\nRoster:");
  console.log(`  Scouts:  ${result.roster.scouts}`);
  console.log(`  Adults:  ${result.roster.adults}`);
  console.log(`  Parents: ${result.roster.parents}`);

  const succeeded = result.scoutResults.filter((r) => r.success).length;
  const failed = result.scoutResults.filter((r) => !r.success).length;
  console.log(`\nScout Advancement:`);
  console.log(`  Synced:  ${succeeded}/${result.scoutResults.length}`);
  if (failed > 0) {
    console.log(`  Failed:  ${failed}`);
    for (const r of result.scoutResults.filter((r) => !r.success)) {
      console.log(`    - ${r.userId}: ${r.error}`);
    }
  }

  if (result.events) {
    console.log(`\nEvents:`);
    console.log(`  Synced: ${result.events.events}`);
  }

  console.log(`\nTotal Duration: ${formatDuration(result.totalDurationMs)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const help = args.includes("--help") || args.includes("-h");
  const positional = args.filter((a) => !a.startsWith("--") && !a.startsWith("-h"));

  if (help) {
    printHelp();
    process.exit(0);
  }

  const command = positional[0] || "sync-all";

  // Step 1: Initialize API client (validates env vars)
  console.log("[cli] Initializing Scoutbook API client...");
  let client: ScoutbookApiClient;
  try {
    client = new ScoutbookApiClient();
    console.log(`[cli] Org GUID: ${client.orgGuid}`);
    console.log(`[cli] Unit ID:  ${client.unitId}`);
  } catch (err) {
    console.error(`[cli] Config error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Step 2: Authenticate
  console.log("[cli] Authenticating with BSA...");
  try {
    await client.authenticate();
    console.log("[cli] Authentication successful.");
  } catch (err) {
    console.error(`[cli] Authentication failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Step 3: Dry run exits here
  if (dryRun) {
    console.log("[cli] --dry-run: Auth succeeded. Exiting without syncing.");
    process.exit(0);
  }

  // Step 4: Initialize MongoDB
  console.log("[cli] Connecting to MongoDB...");
  await import("../db.js");
  console.log("[cli] MongoDB connected.");

  // Step 5: Run the requested command
  console.log(`[cli] Running command: ${command}`);

  switch (command) {
    case "sync-roster": {
      console.log("[cli] Syncing roster...");
      const result = await syncRoster(client);
      printRosterResult(result);
      break;
    }

    case "sync-scout": {
      const userId = positional[1];
      if (!userId) {
        console.error("[cli] Error: sync-scout requires a <userId> argument.");
        console.error("  Usage: node dist/scoutbook/cli.js sync-scout <userId>");
        process.exit(1);
      }
      console.log(`[cli] Syncing scout ${userId}...`);
      const result = await syncScout(client, userId);
      printScoutResult(result);
      break;
    }

    case "sync-events": {
      console.log("[cli] Syncing events (next 90 days)...");
      const result = await syncEvents(client);
      printEventsResult(result);
      break;
    }

    case "sync-all": {
      console.log("[cli] Starting full sync...");
      const result = await syncAll(client);
      printAllResult(result);
      break;
    }

    default: {
      console.error(`[cli] Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  }

  console.log("\n[cli] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[cli] Fatal error: ${err instanceof Error ? err.message : err}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
