// Read-only knowledge and advancement server.
//
// A fifth entry point alongside scout / guide / admin / cron, for troop
// operations work (Troop 2024 planning, newsletters, advancement pushes) rather
// than for the Scout Quest coaching product.
//
// WHY THIS EXISTS INSTEAD OF JUST USING guide.js
//
// guide.js registers 25 tools. Most are Scout Quest product writes: setup_scout,
// setup_quest, adjust_character, adjust_quest_goal, set_budget_plan,
// set_chore_list_guide, send_notification_guide. Registering all of that into a
// planning session to answer "what does Life requirement 5 say" is a large and
// unnecessary blast radius, and send_notification_guide in particular can reach
// real scouts and parents.
//
// This server registers only reads. There is no write tool on it at all, which
// is a property of the file rather than a policy someone has to remember.
//
// DELIBERATELY EXCLUDED
//
//   registerTroopPolicyTool     manage_troop_policy, writes troop_customizations
//   registerGuideTools          the 20-odd Scout Quest coaching tools, many writes
//
// manage_troop_policy is a real thing to want eventually. Add it when there is a
// considered answer to who curates troop policy and how it is reviewed, not as a
// side effect of wanting corpus lookups. troop_customizations currently has 0
// rows, so the first write would set the precedent for the table.
//
// Also note there is no GUIDE_EMAIL requirement here. guide.js exits without one
// because its tools authorize per-user via getUserRoles(). Nothing registered
// here is user-scoped, so there is no identity to check and none is asked for.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerKnowledgeTools } from "./tools/shared/knowledgeTools.js";
import { registerAdvancementPlanningTools } from "./tools/shared/advancementTools.js";
import { registerRankGuideResource } from "./resources/rankGuide.js";
import { registerTroopPoliciesResource } from "./resources/troopPolicies.js";

const INSTRUCTIONS = `SCOUT KNOWLEDGE — READ ONLY

BSA/Scouting America reference material and Troop 2024 advancement data. Every
tool here reads. Nothing on this server writes anything.

TOOL USE RULES:
- Actually call the tools. Never simulate a call or invent a result.
- If a tool fails or returns nothing, say so plainly. Do not fill the gap from
  training data and present it as sourced.

WHAT THIS CORPUS DOES AND DOES NOT COVER

It covers rank requirements, merit badges, advancement policy and procedure, and
troop-specific customs. It is roughly 130 chunks, so it is a useful reference and
not a complete library.

It does NOT cover adult registration and position compatibility, meaning which
roles one person may hold at once, charter renewal mechanics, or council
administration. Those live in Scouting America's Registration Guidebook, which is
not in here. If asked such a question, say the corpus does not cover it and go to
scouting.org rather than guessing. Getting exactly this wrong once already sent a
troop leadership plan down a false path for three months.`;

const server = new McpServer(
  { name: "scout-knowledge", version: "1.0.0" },
  {
    capabilities: { logging: {} },
    instructions: INSTRUCTIONS,
  },
);

registerKnowledgeTools(server);          // search_scouting_knowledge, get_rank_requirements, get_merit_badge_info
registerAdvancementPlanningTools(server); // get_troop_advancement_summary, suggest_meeting_activities
registerRankGuideResource(server);
registerTroopPoliciesResource(server);

const transport = new StdioServerTransport();
await server.connect(transport);
