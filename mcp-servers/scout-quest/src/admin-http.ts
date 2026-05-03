// HTTP entry point for the Scout Quest admin MCP server.
//
// Mirrors src/admin.ts (same tools, same instructions) but uses the modern
// Streamable HTTP transport so remote MCP clients (e.g. Claude Desktop on a
// laptop, via mcp-remote bridge or claude.ai connector) can call admin tools.
//
// Auth: shared-secret bearer token in the Authorization header. The token is
// the MCP_BEARER_TOKEN env var. This is single-tenant (every authenticated
// caller acts as the admin identified by ADMIN_EMAIL) — same trust model as
// the stdio admin.ts spawned by LibreChat, just over HTTP.
//
// Streamable HTTP IS the SSE option. The same /admin endpoint handles POST
// (client→server JSON-RPC) and GET (server→client SSE stream upgrade). The
// older standalone SSE transport is deprecated; Streamable HTTP supersedes it.
import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { registerAdminResources } from "./resources/index.js";
import { registerAdminTools } from "./tools/admin/index.js";
import { registerKnowledgeTools } from "./tools/shared/knowledgeTools.js";
import { registerAdvancementPlanningTools, registerTroopPolicyTool } from "./tools/shared/advancementTools.js";
import { registerRankGuideResource } from "./resources/rankGuide.js";
import { registerTroopPoliciesResource, registerJTEGapsResource } from "./resources/troopPolicies.js";

const ADMIN_INSTRUCTIONS = `SCOUT QUEST ADMIN — CONFIGURATION TOOLS

You have access to admin tools for creating and configuring Scout Quest accounts,
querying Scoutbook data, and searching the BSA knowledge base.

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

SCOUTBOOK SYNC TOOLS:
- scoutbook_sync_all / scoutbook_sync_roster / scoutbook_sync_scout / scoutbook_sync_events
- scoutbook_sync_status — check freshness before syncing
- scoutbook_list_scouts — discover BSA userIds
- scoutbook_get_scout_advancement — query locally synced advancement (fast, reads MongoDB)

KNOWLEDGE BASE:
For ANY question about BSA/Scouting America policies, rank requirements, merit
badge requirements, or troop procedures, use search_scouting_knowledge instead
of relying on training data.
- search_scouting_knowledge / get_rank_requirements / get_merit_badge_info
- get_troop_advancement_summary / suggest_meeting_activities / manage_troop_policy
Read troop://policies for troop customs. Read admin://jte-gaps for quality improvement.

RULES:
- Only superuser and admin roles can use write tools.
- adult_readonly users see resources but cannot modify.
- override_requirement requires a reason (logged for audit).`;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "scout-admin", version: "1.0.0" },
    { capabilities: { logging: {} }, instructions: ADMIN_INSTRUCTIONS },
  );
  registerAdminResources(server);
  registerAdminTools(server);
  registerKnowledgeTools(server);
  registerAdvancementPlanningTools(server);
  registerTroopPolicyTool(server);
  registerRankGuideResource(server);
  registerTroopPoliciesResource(server);
  registerJTEGapsResource(server);
  return server;
}

// ---- bootstrap ----
const adminEmail = process.env.ADMIN_EMAIL || "";
if (!adminEmail) {
  console.error("ADMIN_EMAIL not set — cannot identify admin user");
  process.exit(1);
}

const bearerToken = process.env.MCP_BEARER_TOKEN || "";
if (!bearerToken || bearerToken.length < 32) {
  console.error("MCP_BEARER_TOKEN not set or too short (need >=32 chars)");
  process.exit(1);
}

const port = parseInt(process.env.MCP_HTTP_PORT || "3083", 10);
const path = process.env.MCP_HTTP_PATH || "/admin";

// One persistent transport per MCP session id. The session id is generated
// on initialize and echoed by the client on every subsequent request via the
// `mcp-session-id` header.
const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(express.json({ limit: "4mb" }));

function checkBearer(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${bearerToken}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

async function handleMcp(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport | undefined;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId);
  } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        if (transport) transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport?.sessionId;
      if (sid) transports.delete(sid);
    };
    const server = buildServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      error: "missing or unknown mcp-session-id; only initialize requests may omit it",
    });
    return;
  }

  await transport!.handleRequest(req, res, req.body);
}

app.post(path, checkBearer, handleMcp);
app.get(path, checkBearer, handleMcp);
app.delete(path, checkBearer, handleMcp);

// Liveness probe (no auth) so Caddy / docker can health-check without the token.
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, sessions: transports.size });
});

app.listen(port, "0.0.0.0", () => {
  console.error(`scout-admin HTTP MCP listening on :${port}${path} (admin=${adminEmail})`);
});
