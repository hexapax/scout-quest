import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScoutbookApiClient } from "../../scoutbook/api-client.js";
import { syncRoster, syncScout, syncAll, syncEvents, syncDashboards, syncCalendars } from "../../scoutbook/sync.js";
import {
  initQuestFromScoutbook,
  formatInitQuestResult,
} from "../../scoutbook/questBridge.js";
import {
  scoutbookSyncLog,
  scoutbookAdvancement,
  scoutbookRequirements,
  scoutbookScouts,
  scoutbookAdults,
} from "../../scoutbook/collections.js";

// ---------------------------------------------------------------------------
// Helper: create a shared API client (reads env vars each call)
// ---------------------------------------------------------------------------

function createClient(): ScoutbookApiClient {
  return new ScoutbookApiClient();
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

export function registerScoutbookSyncTools(server: McpServer): void {
  // ---- scoutbook_sync_roster ----
  server.registerTool(
    "scoutbook_sync_roster",
    {
      title: "Scoutbook: Sync Roster",
      description:
        "Pull the full troop roster (youth, adults, parents) from Scoutbook and upsert into MongoDB. Returns counts of synced records.",
      inputSchema: {},
    },
    async () => {
      try {
        const client = createClient();
        const result = await syncRoster(client);
        return {
          content: [
            {
              type: "text",
              text: `Roster sync complete in ${(result.durationMs / 1000).toFixed(1)}s.\n` +
                `- Scouts: ${result.scouts}\n` +
                `- Adults: ${result.adults}\n` +
                `- Parents: ${result.parents}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Roster sync failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_scout ----
  server.registerTool(
    "scoutbook_sync_scout",
    {
      title: "Scoutbook: Sync Scout Advancement",
      description:
        "Sync ranks, merit badges, awards, and requirements for a specific scout from Scoutbook. Requires the BSA userId.",
      inputSchema: {
        userId: z.string().describe("BSA userId of the scout to sync"),
      },
    },
    async ({ userId }) => {
      try {
        const client = createClient();
        const result = await syncScout(client, userId);
        return {
          content: [
            {
              type: "text",
              text: `Scout sync complete for userId ${result.userId} in ${(result.durationMs / 1000).toFixed(1)}s.\n` +
                `- Ranks: ${result.ranks}\n` +
                `- Merit Badges: ${result.meritBadges}\n` +
                `- Awards: ${result.awards}\n` +
                `- Requirements: ${result.requirements}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Scout sync failed for userId ${userId}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_all ----
  server.registerTool(
    "scoutbook_sync_all",
    {
      title: "Scoutbook: Full Sync",
      description:
        "Run a full sync: roster + advancement for every scout + events. This may take several minutes for a full troop.",
      inputSchema: {},
    },
    async () => {
      try {
        const client = createClient();
        const result = await syncAll(client);
        const succeeded = result.scoutResults.filter((r) => r.success).length;
        const failed = result.scoutResults.filter((r) => !r.success).length;
        let text =
          `Full sync complete in ${(result.totalDurationMs / 1000).toFixed(1)}s.\n\n` +
          `Roster:\n` +
          `- Scouts: ${result.roster.scouts}\n` +
          `- Adults: ${result.roster.adults}\n` +
          `- Parents: ${result.roster.parents}\n\n` +
          `Advancement:\n` +
          `- Scouts synced: ${succeeded}\n` +
          `- Scouts failed: ${failed}`;

        if (result.events) {
          text += `\n\nEvents:\n- Events synced: ${result.events.events}`;
        }

        if (result.dashboards) {
          text += `\n\nDashboards:\n- Advancement: ${result.dashboards.advancement ? "synced" : "skipped"}\n- Activities: ${result.dashboards.activities ? "synced" : "skipped"}`;
        }

        if (result.calendars) {
          text += `\n\nCalendars:\n- Subscriptions synced: ${result.calendars.calendars}`;
        }

        if (failed > 0) {
          const failures = result.scoutResults
            .filter((r) => !r.success)
            .map((r) => `  - ${r.userId}: ${r.error}`)
            .join("\n");
          text += `\n\nFailures:\n${failures}`;
        }

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Full sync failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_events ----
  server.registerTool(
    "scoutbook_sync_events",
    {
      title: "Scoutbook: Sync Events",
      description:
        "Sync upcoming calendar events from Scoutbook (default: next 90 days).",
      inputSchema: {
        daysAhead: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Number of days ahead to fetch events (default: 90)"),
      },
    },
    async ({ daysAhead }) => {
      try {
        const client = createClient();
        const result = await syncEvents(client, daysAhead);
        return {
          content: [
            {
              type: "text",
              text: `Events sync complete in ${(result.durationMs / 1000).toFixed(1)}s.\n` +
                `- Events synced: ${result.events}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Events sync failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_status ----
  server.registerTool(
    "scoutbook_sync_status",
    {
      title: "Scoutbook: Sync Status",
      description:
        "Show recent Scoutbook sync history — last 5 sync operations with timestamps, results, and counts.",
      inputSchema: {},
    },
    async () => {
      try {
        const log = await scoutbookSyncLog();
        const entries = await log
          .find({})
          .sort({ timestamp: -1 })
          .limit(5)
          .toArray();

        if (entries.length === 0) {
          return {
            content: [{ type: "text", text: "No sync history found." }],
          };
        }

        const lines = entries.map((e) => {
          const ts = e.timestamp instanceof Date
            ? e.timestamp.toISOString()
            : String(e.timestamp);
          const counts = e.counts
            ? Object.entries(e.counts)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")
            : "n/a";
          const duration = `${(e.durationMs / 1000).toFixed(1)}s`;
          const error = e.error ? ` | error: ${e.error}` : "";
          return `[${ts}] ${e.operation} — ${e.result} (${counts}) ${duration}${error}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `Last ${entries.length} sync operations:\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read sync log: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_get_scout_advancement ----
  server.registerTool(
    "scoutbook_get_scout_advancement",
    {
      title: "Scoutbook: Get Scout Advancement",
      description:
        "Query synced Scoutbook data for a scout's advancement (ranks, merit badges, awards) and their detailed requirements. " +
        "Useful for answering questions like 'What does Scout X need to work on?'",
      inputSchema: {
        userId: z.string().describe("BSA userId of the scout"),
      },
    },
    async ({ userId }) => {
      try {
        // Look up the scout's name
        const scoutsCol = await scoutbookScouts();
        const scout = await scoutsCol.findOne({ userId });
        const scoutName = scout
          ? `${scout.firstName} ${scout.lastName}`
          : `userId ${userId}`;

        // Get all advancement records
        const advCol = await scoutbookAdvancement();
        const advancements = await advCol
          .find({ userId })
          .sort({ type: 1, name: 1 })
          .toArray();

        if (advancements.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No advancement data found for ${scoutName}. Run scoutbook_sync_scout first.`,
              },
            ],
          };
        }

        // Get all requirements
        const reqCol = await scoutbookRequirements();
        const requirements = await reqCol.find({ userId }).toArray();

        // Group requirements by advancement
        const reqByAdv = new Map<string, typeof requirements>();
        for (const req of requirements) {
          const key = `${req.advancementType}:${req.advancementId}`;
          const existing = reqByAdv.get(key);
          if (existing) {
            existing.push(req);
          } else {
            reqByAdv.set(key, [req]);
          }
        }

        // Format output by type
        const sections: string[] = [];

        for (const type of ["rank", "meritBadge", "award"] as const) {
          const items = advancements.filter((a) => a.type === type);
          if (items.length === 0) continue;

          const label =
            type === "rank"
              ? "Ranks"
              : type === "meritBadge"
                ? "Merit Badges"
                : "Awards";
          const lines: string[] = [`## ${label}`];

          for (const adv of items) {
            const pct = adv.percentCompleted ?? 0;
            const statusIcon =
              adv.status === "Awarded"
                ? "[Awarded]"
                : pct > 0
                  ? `[${pct}%]`
                  : "[Not Started]";
            lines.push(`\n### ${adv.name} ${statusIcon}`);
            lines.push(`Status: ${adv.status} | ${pct}% complete`);
            if (adv.dateAwarded) lines.push(`Awarded: ${adv.dateAwarded}`);
            if (adv.dateStarted) lines.push(`Started: ${adv.dateStarted}`);

            // Show requirements if available
            const key = `${adv.type}:${adv.advancementId}`;
            const reqs = reqByAdv.get(key);
            if (reqs && reqs.length > 0) {
              const sorted = reqs.sort((a, b) =>
                a.reqNumber.localeCompare(b.reqNumber, undefined, { numeric: true }),
              );
              lines.push(`Requirements (${reqs.length}):`);
              for (const req of sorted) {
                const check = req.completed ? "[x]" : req.started ? "[-]" : "[ ]";
                const date = req.dateCompleted
                  ? ` (completed ${req.dateCompleted})`
                  : "";
                lines.push(`  ${check} ${req.reqNumber}. ${req.reqName}${date}`);
              }
            }
          }

          sections.push(lines.join("\n"));
        }

        const header = `# Advancement for ${scoutName}`;
        const rankInfo = scout?.currentRank
          ? `Current Rank: ${scout.currentRank.name}`
          : "";
        const activityInfo = scout?.activitySummary
          ? `Activity: ${scout.activitySummary.campingNights} camping nights, ` +
            `${scout.activitySummary.hikingMiles} hiking miles, ` +
            `${scout.activitySummary.serviceHours} service hours`
          : "";
        const syncInfo = scout?.syncedAt
          ? `Last synced: ${scout.syncedAt instanceof Date ? scout.syncedAt.toISOString() : String(scout.syncedAt)}`
          : "";

        const fullText = [header, rankInfo, activityInfo, syncInfo, "", ...sections]
          .filter(Boolean)
          .join("\n");

        return { content: [{ type: "text", text: fullText }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get advancement for userId ${userId}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_init_quest ----
  server.registerTool(
    "scoutbook_init_quest",
    {
      title: "Scoutbook: Initialize Quest Profiles",
      description:
        "Create quest-ready scout profiles from synced Scoutbook data. " +
        "Reads scoutbook_scouts, scoutbook_parents, and scoutbook_advancement to create " +
        "user accounts, scout profiles, and requirement documents in the quest system. " +
        "Maps Scoutbook merit badge status to quest requirement statuses " +
        '(Awarded → completed_prior, otherwise → not_started). ' +
        "Can target a specific scout by name or scoutId, or process all scouts. " +
        "Use dry_run to preview without making changes.",
      inputSchema: {
        scout_name: z
          .string()
          .optional()
          .describe(
            'Partial name match to target a specific scout (e.g. "Will" matches "Will Bramwell"). Case-insensitive.',
          ),
        scout_id: z
          .string()
          .optional()
          .describe("BSA userId to target a specific scout"),
        scout_email: z
          .string()
          .email()
          .optional()
          .describe(
            "Gmail address for the scout's quest login. Required when targeting a single scout. " +
            "When processing all scouts, scouts without a Scoutbook email will be skipped.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview what would be created without making changes"),
      },
    },
    async ({ scout_name, scout_id, scout_email, dry_run }) => {
      try {
        const initResult = await initQuestFromScoutbook({
          scoutName: scout_name,
          scoutId: scout_id,
          scoutEmail: scout_email,
          dryRun: dry_run,
        });
        const text = formatInitQuestResult(initResult);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Quest initialization failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_dashboards ----
  server.registerTool(
    "scoutbook_sync_dashboards",
    {
      title: "Scoutbook: Sync Dashboards",
      description:
        "Sync unit-level advancement and activities dashboards from Scoutbook. " +
        "Fetches advancement stats (ranks, merit badges, awards completion) and " +
        "activity stats (campouts, service projects, hikes) for the unit.",
      inputSchema: {},
    },
    async () => {
      try {
        const client = createClient();
        const result = await syncDashboards(client);
        return {
          content: [
            {
              type: "text",
              text: `Dashboards sync complete in ${(result.durationMs / 1000).toFixed(1)}s.\n` +
                `- Advancement dashboard: ${result.advancement ? "synced" : "skipped"}\n` +
                `- Activities dashboard: ${result.activities ? "synced" : "skipped"}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Dashboards sync failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- scoutbook_sync_calendars ----
  server.registerTool(
    "scoutbook_sync_calendars",
    {
      title: "Scoutbook: Sync Calendars",
      description:
        "Sync calendar subscriptions for a user from Scoutbook. " +
        "Fetches unit and patrol calendar subscription codes. " +
        "If no user_id is provided, syncs calendars for all adults in the roster.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("BSA userId to sync calendars for. If omitted, syncs all adults."),
      },
    },
    async ({ user_id }) => {
      try {
        const client = createClient();

        if (user_id) {
          const result = await syncCalendars(client, user_id);
          return {
            content: [
              {
                type: "text",
                text: `Calendar sync complete for userId ${user_id} in ${(result.durationMs / 1000).toFixed(1)}s.\n` +
                  `- Subscriptions synced: ${result.calendars}`,
              },
            ],
          };
        }

        // No user_id — sync all adults
        const adultsCol = await scoutbookAdults();
        const allAdults = await adultsCol.find({}, { projection: { userId: 1 } }).toArray();
        let totalCalendars = 0;
        const start = Date.now();
        for (const adult of allAdults) {
          try {
            const r = await syncCalendars(client, adult.userId);
            totalCalendars += r.calendars;
          } catch {
            // Individual failures are non-fatal
          }
        }
        const durationMs = Date.now() - start;
        return {
          content: [
            {
              type: "text",
              text: `Calendar sync complete for ${allAdults.length} adults in ${(durationMs / 1000).toFixed(1)}s.\n` +
                `- Total subscriptions synced: ${totalCalendars}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Calendar sync failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
