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
 *   sync-with-token          Full sync using an injected SCOUTBOOK_TOKEN
 *                            (workaround for BSA's broken automated auth).
 *                            Honours SCOUT_IDS for targeted sync; adds
 *                            per-scout jitter + per-scout progress output.
 *
 * Options:
 *   --dry-run                Test auth and config only — no DB writes
 *   --help                   Show this help message
 *
 * Required env vars:
 *   SCOUTBOOK_USERNAME       BSA login username (dummy OK for sync-with-token)
 *   SCOUTBOOK_PASSWORD       BSA login password (dummy OK for sync-with-token)
 *   SCOUTBOOK_ORG_GUID       Unit org GUID
 *   SCOUTBOOK_UNIT_ID        Unit ID
 *   MONGO_URI                MongoDB connection string (default: mongodb://mongodb:27017/scoutquest)
 *
 * Additional env vars (sync-with-token):
 *   SCOUTBOOK_TOKEN          JWT pulled from a my.scouting.org cookie.
 *   SCOUT_IDS                Optional comma/space-separated userIds for
 *                            targeted sync (skips roster/events/dashboards).
 */

import { ScoutbookApiClient } from "./api-client.js";
import {
  syncRoster,
  syncScout,
  syncEvents,
  syncDashboards,
  syncAll,
  getScoutsToSync,
} from "./sync.js";
import type {
  SyncRosterResult,
  SyncScoutResult,
  SyncEventsResult,
  SyncAllResult,
} from "./sync.js";

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
  sync-with-token          Full sync using injected SCOUTBOOK_TOKEN
                           (workaround for broken BSA auth). Honours SCOUT_IDS.

Options:
  --dry-run                Test auth and config only — no DB writes
  --help, -h               Show this help message

Required env vars:
  SCOUTBOOK_USERNAME       BSA login username (dummy OK for sync-with-token)
  SCOUTBOOK_PASSWORD       BSA login password (dummy OK for sync-with-token)
  SCOUTBOOK_ORG_GUID       Unit org GUID
  SCOUTBOOK_UNIT_ID        Unit ID
  MONGO_URI                MongoDB connection string

Additional env vars (sync-with-token):
  SCOUTBOOK_TOKEN          JWT from a my.scouting.org cookie
  SCOUT_IDS                Optional comma-separated userIds for targeted sync
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

  // Step 2: Authenticate.
  // sync-with-token short-circuits the BSA login flow with an injected JWT
  // (we'd otherwise 503 with dummy SCOUTBOOK_PASSWORD).
  if (command === "sync-with-token") {
    const token = process.env.SCOUTBOOK_TOKEN;
    if (!token) {
      console.error(
        "[cli] sync-with-token requires SCOUTBOOK_TOKEN (JWT from a my.scouting.org cookie).",
      );
      process.exit(1);
    }
    try {
      client.injectToken(token);
      const expSec = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ).exp as number;
      if (expSec * 1000 < Date.now()) {
        console.error(
          `[cli] SCOUTBOOK_TOKEN expired at ${new Date(expSec * 1000).toISOString()}`,
        );
        process.exit(1);
      }
      console.log(
        `[cli] Token injected; expires ${new Date(expSec * 1000).toISOString()}`,
      );
    } catch (err) {
      console.error(
        `[cli] Token injection failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  } else {
    console.log("[cli] Authenticating with BSA...");
    try {
      await client.authenticate();
      console.log("[cli] Authentication successful.");
    } catch (err) {
      console.error(
        `[cli] Authentication failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
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

    case "sync-with-token": {
      // Per-scout loop with jitter + verbose progress, but the scout filter
      // and the per-scout work are the SAME as sync-all — see getScoutsToSync
      // and syncScout. Do not add a parallel filter here.
      const rawIds = (process.env.SCOUT_IDS || "").trim();
      const targetIds = rawIds
        ? rawIds.split(/[,\s]+/).filter(Boolean)
        : undefined;
      const isTargeted = targetIds !== undefined && targetIds.length > 0;

      const t0 = Date.now();

      if (!isTargeted) {
        console.log("\n[1/4] Roster...");
        const roster = await syncRoster(client);
        console.log(
          `  ✓ ${roster.scouts} scouts, ${roster.adults} adults, ${roster.parents} parents (${formatDuration(roster.durationMs)})`,
        );
      } else {
        console.log("\n[1/4] Roster... (skipped for targeted sync)");
      }

      const scouts = await getScoutsToSync({ targetUserIds: targetIds });
      if (isTargeted && scouts.length === 0) {
        console.error(
          `[cli] No matching scouts after filters. Targeted IDs: ${targetIds!.join(",")}`,
        );
        console.error(
          "      (records may carry syncSkip:true or lack a personGuid)",
        );
        process.exit(1);
      }

      console.log(`\n[2/4] Scouts (${scouts.length} to sync)...`);
      const jitterMin = 3000;
      const jitterMax = 6000;
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < scouts.length; i++) {
        const s = scouts[i];
        const idx = `${String(i + 1).padStart(2, " ")}/${scouts.length}`;
        const label = `${s.userId} ${s.firstName || ""} ${s.lastName || ""}`
          .trim()
          .padEnd(36);

        if (i > 0) {
          const delay =
            jitterMin + Math.random() * (jitterMax - jitterMin);
          await new Promise((r) => setTimeout(r, delay));
        }

        try {
          const r = await syncScout(client, s.userId);
          ok++;
          console.log(
            `  [${idx}] ✓ ${label}  ranks=${r.ranks} MBs=${r.meritBadges} reqs=${r.requirements} (${formatDuration(r.durationMs)})`,
          );
        } catch (err) {
          fail++;
          const msg = (err instanceof Error ? err.message : String(err))
            .split("\n")[0]
            .slice(0, 90);
          console.log(`  [${idx}] ✗ ${label}  ${msg}`);
          if (msg.includes("503")) {
            // BSA throttled — long cooldown before next scout.
            console.log(
              "         BSA 503 — cooling off 30–60s before next scout",
            );
            await new Promise((r) => setTimeout(r, 30000 + Math.random() * 30000));
          }
        }
      }
      console.log(`  → ${ok} succeeded, ${fail} failed`);

      if (!isTargeted) {
        console.log("\n[3/4] Events (next 90 days)...");
        try {
          const ev = await syncEvents(client);
          console.log(`  ✓ ${ev.events} events (${formatDuration(ev.durationMs)})`);
        } catch (err) {
          console.log(
            `  ✗ ${err instanceof Error ? err.message : err}`,
          );
        }
        console.log("\n[4/4] Dashboards...");
        try {
          const d = await syncDashboards(client);
          console.log(
            `  ✓ advancement=${d.advancement} activities=${d.activities} (${formatDuration(d.durationMs)})`,
          );
        } catch (err) {
          console.log(
            `  ✗ ${err instanceof Error ? err.message : err}`,
          );
        }
      } else {
        console.log("\n[3/4] Events...    (skipped for targeted sync)");
        console.log("[4/4] Dashboards... (skipped for targeted sync)");
      }

      console.log(`\n✓ Sync complete in ${formatDuration(Date.now() - t0)}`);
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
