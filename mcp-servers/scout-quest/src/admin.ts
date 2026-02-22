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
