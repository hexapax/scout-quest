import { getScoutQuestDb } from "./db.js";
import { getScoutStatus } from "./tools/get-scout-status.js";
import { searchBsaReference } from "./tools/search-bsa-reference.js";
import { advanceRequirementTool } from "./tools/advance-requirement.js";
import { rsvpEventTool } from "./tools/rsvp-event.js";
import { logActivityTool, type LogActivityInput } from "./tools/log-activity.js";
import { createPendingActionTool } from "./tools/create-pending-action.js";
import type { ActionType } from "./pending-action.js";
import { logRequirementWork, type EvidenceType } from "./tools/log-requirement-work.js";

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

/** Resolve a LibreChat user email → scoutbook userId for graph lookups. */
async function resolveUserId(email: string): Promise<string | null> {
  try {
    const db = getScoutQuestDb();
    const scout = await db.collection("scoutbook_scouts").findOne(
      { email },
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
