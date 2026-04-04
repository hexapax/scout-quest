import { getScoutQuestDb } from "./db.js";
import { getScoutStatus } from "./tools/get-scout-status.js";
import { searchBsaReference } from "./tools/search-bsa-reference.js";
import { advanceRequirementTool } from "./tools/advance-requirement.js";
import { rsvpEventTool } from "./tools/rsvp-event.js";
import { logActivityTool, type LogActivityInput } from "./tools/log-activity.js";
import { createPendingActionTool } from "./tools/create-pending-action.js";
import type { ActionType } from "./pending-action.js";
import { logRequirementWork, type EvidenceType } from "./tools/log-requirement-work.js";
import { crossReference, type CrossRefScope } from "./tools/cross-reference.js";
import { troopInsights, type TroopInsightScope } from "./tools/troop-insights.js";
import { scoutBuddies, type ScoutBuddyScope } from "./tools/scout-buddies.js";
import { sessionPlanner } from "./tools/session-planner.js";
import { graphQuery, isFalkorConnected } from "./falkordb.js";
import { emailMatchRegex } from "./email-normalize.js";

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

/** Get troop roster from FalkorDB graph. */
async function executeRoster(nameFilter?: string): Promise<string> {
  if (!isFalkorConnected()) return "Graph database not available.";
  const cypher = nameFilter
    ? `MATCH (s:Scout) WHERE toLower(s.name) CONTAINS toLower($name)
       OPTIONAL MATCH (s)-[ha:HAS_ADVANCEMENT]->(a:Advancement)
       WHERE ha.dateCompleted IS NOT NULL AND a.type = 'rank'
       RETURN s.name AS name, s.email AS email, s.userId AS userId,
              collect(DISTINCT a.name) AS earnedRanks
       ORDER BY s.name`
    : `MATCH (s:Scout)
       OPTIONAL MATCH (s)-[ha:HAS_ADVANCEMENT]->(a:Advancement)
       WHERE ha.dateCompleted IS NOT NULL AND a.type = 'rank'
       RETURN s.name AS name, s.email AS email, s.userId AS userId,
              collect(DISTINCT a.name) AS earnedRanks
       ORDER BY s.name`;

  const params = nameFilter ? { name: nameFilter } : undefined;
  const rows = await graphQuery<{ name: string; email: string; userId: string; earnedRanks: string[] }>(cypher, params);

  if (rows.length === 0) return nameFilter ? `No scouts found matching "${nameFilter}".` : "No scouts in roster.";

  const lines = rows.map(r => {
    const ranks = r.earnedRanks?.length ? r.earnedRanks.join(", ") : "no ranks earned yet";
    return `- ${r.name || "(unnamed)"} | ${r.email || "(no email)"} | Ranks: ${ranks}`;
  });

  return `Troop roster (${rows.length} scouts):\n${lines.join("\n")}`;
}

/** Resolve a LibreChat user email → scoutbook userId for graph lookups. Gmail-normalized. */
async function resolveUserId(email: string): Promise<string | null> {
  try {
    const db = getScoutQuestDb();
    const scout = await db.collection("scoutbook_scouts").findOne(
      { email: emailMatchRegex(email) },
      { projection: { userId: 1 } }
    );
    return scout ? String(scout.userId) : null;
  } catch {
    return null;
  }
}

/** Execute a single tool call and return the result string. */
async function executeOneTool(
  toolName: string,
  input: Record<string, unknown>,
  userEmail: string | undefined
): Promise<string> {
  try {
    switch (toolName) {
      case "get_scout_status": {
        if (!userEmail) return "Cannot look up advancement: no user email provided.";
        const userId = await resolveUserId(userEmail);
        if (!userId) {
          return `No Scoutbook record found for ${userEmail}. Scout must be on the troop roster.`;
        }
        return await getScoutStatus(
          userId,
          String(input.scope || "summary"),
          input.rank_name ? String(input.rank_name) : undefined
        );
      }

      case "search_bsa_reference": {
        return await searchBsaReference(
          String(input.query || ""),
          input.category ? String(input.category) : undefined
        );
      }

      case "advance_requirement": {
        if (!userEmail) return "Cannot advance requirement: no user email context.";
        return await advanceRequirementTool({
          scoutUserId: String(input.scoutUserId || ""),
          rankName: String(input.rankName || ""),
          requirementNumber: String(input.requirementNumber || ""),
          dateCompleted: String(input.dateCompleted || new Date().toISOString().slice(0, 10)),
          notes: input.notes ? String(input.notes) : undefined,
        });
      }

      case "rsvp_event": {
        return await rsvpEventTool({
          eventId: String(input.eventId || ""),
          scoutUserId: String(input.scoutUserId || ""),
          rsvpCode: String(input.rsvpCode || "Y"),
        });
      }

      case "log_activity": {
        return await logActivityTool(input as unknown as LogActivityInput);
      }

      case "create_pending_action": {
        return await createPendingActionTool({
          type: String(input.type || "send_email") as ActionType,
          payload: (input.payload as Record<string, unknown>) ?? {},
          createdBy: userEmail ?? "unknown",
          scoutUserId: input.scoutUserId ? String(input.scoutUserId) : undefined,
        });
      }

      case "log_requirement_work": {
        if (!userEmail) return "Cannot log work: no user email context.";
        return await logRequirementWork({
          scoutEmail: userEmail,
          evidenceType: String(input.evidenceType || "general") as EvidenceType,
          description: String(input.description || ""),
          requirementRef: input.requirementRef ? String(input.requirementRef) : undefined,
          data: (input.data as Record<string, unknown>) ?? undefined,
        });
      }

      case "cross_reference": {
        return await crossReference({
          scope: String(input.scope || "related_badges") as CrossRefScope,
          badgeName: input.badgeName ? String(input.badgeName) : undefined,
          rankName: input.rankName ? String(input.rankName) : undefined,
          skillOrTopic: input.skillOrTopic ? String(input.skillOrTopic) : undefined,
          scoutUserId: input.scoutUserId ? String(input.scoutUserId) : undefined,
        });
      }

      case "troop_insights": {
        return await troopInsights({
          scope: String(input.scope || "troop_progress") as TroopInsightScope,
          skillArea: input.skillArea ? String(input.skillArea) : undefined,
          rankName: input.rankName ? String(input.rankName) : undefined,
          requirementRef: input.requirementRef ? String(input.requirementRef) : undefined,
          attendees: input.attendees ? String(input.attendees) : undefined,
        });
      }

      case "scout_buddies": {
        // Resolve scoutUserId from email if not directly provided
        let scoutUserId = input.scoutUserId ? String(input.scoutUserId) : "";
        if (!scoutUserId && userEmail) {
          scoutUserId = (await resolveUserId(userEmail)) ?? "";
        }
        if (!scoutUserId) return "Cannot find scout buddies: no scout identity available.";
        return await scoutBuddies({
          scope: String(input.scope || "working_on_same") as ScoutBuddyScope,
          scoutUserId,
          friendName: input.friendName ? String(input.friendName) : undefined,
          rankName: input.rankName ? String(input.rankName) : undefined,
          badgeName: input.badgeName ? String(input.badgeName) : undefined,
        });
      }

      case "session_planner": {
        return await sessionPlanner({
          attendees: input.attendees ? String(input.attendees) : undefined,
          durationMinutes: input.durationMinutes ? Number(input.durationMinutes) : undefined,
          focusAreas: input.focusAreas ? String(input.focusAreas) : undefined,
          leaders: input.leaders ? String(input.leaders) : undefined,
        });
      }

      case "get_roster": {
        return await executeRoster(input.nameFilter ? String(input.nameFilter) : undefined);
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    console.error(`Tool ${toolName} error:`, err);
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Execute all tool_use blocks from an Anthropic response and return tool_result content for the next turn. */
export async function executeToolCalls(
  toolUseBlocks: ToolUseBlock[],
  userEmail: string | undefined
): Promise<ToolResult[]> {
  return Promise.all(
    toolUseBlocks.map(async (block) => ({
      type: "tool_result" as const,
      tool_use_id: block.id,
      content: await executeOneTool(block.name, block.input, userEmail),
    }))
  );
}
