import { getScoutQuestDb } from "./db.js";
import { getScoutStatus } from "./tools/get-scout-status.js";
import { searchBsaReference } from "./tools/search-bsa-reference.js";

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
