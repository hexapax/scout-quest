import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAdminResources } from "./resources/index.js";
import { registerAdminTools } from "./tools/admin/index.js";

const ADMIN_INSTRUCTIONS = `SCOUT QUEST ADMIN — CONFIGURATION TOOLS

You have access to admin tools for creating and configuring Scout Quest accounts.

WORKFLOW — Setting up a new scout:
1. create_scout — name, email, age, troop, parent/guardian
2. set_unit_leaders — scoutmaster, ASM
3. set_counselors — PM counselor, FL counselor
4. configure_quest — goal, budget, savings capacity, start date
5. set_character — base character, overlay, tone dials, SM/parent notes
6. set_chore_list — the scout's 5+ chores with frequencies and pay rates
7. set_projected_budget — 13-week income/expense/savings projections
8. initialize_requirements — seed all PM and FL requirements with status
9. approve_blue_card — once Scoutbook approval is done

RESOURCES:
- admin://scouts — list all scouts with status summary
- admin://scouts/{email} — full detail for one scout
- admin://scouts/{email}/plan — quest plan and coaching strategy
- admin://scouts/{email}/plan-changelog — plan change history
- admin://cron-log — recent cron job actions and audit trail

TOOLS:
- create_scout, configure_quest, set_character, set_counselors,
  set_unit_leaders, initialize_requirements, override_requirement,
  sign_off_requirement, set_chore_list, set_projected_budget,
  approve_blue_card

SCOUTBOOK SYNC TOOLS:
- scoutbook_sync_all — Full sync: roster + all scout advancement + events.
  Use when you need fresh data from Scoutbook (e.g., first setup, weekly refresh,
  or when advancement data seems stale). Takes several minutes for a full troop.
- scoutbook_sync_roster — Sync just the troop roster (youth, adults, parents).
- scoutbook_sync_scout — Sync advancement for a single scout by BSA userId.
- scoutbook_sync_events — Sync upcoming calendar events (default: next 90 days).
- scoutbook_sync_status — Check when data was last synced and whether it succeeded.
  Use this first to see if data is current before running a full sync.
- scoutbook_get_scout_advancement — Query locally synced data for a scout's ranks,
  merit badges, awards, and individual requirements. Use this to answer questions
  like "What does Scout X still need for First Class?" or "How far along is Scout X
  on Camping merit badge?" Does NOT call the Scoutbook API — reads from MongoDB,
  so it's fast. If data is missing, run scoutbook_sync_scout first.

SCOUTBOOK WORKFLOW:
1. Check scoutbook_sync_status to see if data is current
2. If stale or missing, run scoutbook_sync_all (or scoutbook_sync_scout for one scout)
3. Use scoutbook_get_scout_advancement to answer advancement questions

RULES:
- Only superuser and admin roles can use write tools.
- adult_readonly users see resources but cannot modify.
- sign_off_requirement is for recording counselor sign-offs only.
- override_requirement requires a reason (logged for audit).`;

const server = new McpServer(
  { name: "scout-admin", version: "1.0.0" },
  {
    capabilities: { logging: {} },
    instructions: ADMIN_INSTRUCTIONS,
  },
);

const adminEmail = process.env.ADMIN_EMAIL || "";

if (!adminEmail) {
  console.error("ADMIN_EMAIL not set — cannot identify admin user");
  process.exit(1);
}

registerAdminResources(server);

// Always register admin tools — auth is enforced per-call, not at startup.
// Without this, bootstrapping fails: no roles exist until the first scout is created,
// but you can't create a scout without tools being registered.
registerAdminTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
