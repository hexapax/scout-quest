import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";
import { reminders } from "../../db.js";

export function registerFlagConversation(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "flag_conversation",
    {
      title: "Flag Conversation",
      description: "Mark a conversation for follow-up. Creates a reminder visible to both guide and scout.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        reason: z.string().describe("Why this conversation needs follow-up"),
        conversation_date: z.string().optional().describe("Date of the conversation (YYYY-MM-DD)"),
      },
    },
    async ({ scout_email, reason, conversation_date }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const col = await reminders();
      const now = new Date();
      await col.insertOne({
        scout_email,
        type: "check_in",
        message: `Flagged by guide: ${reason}${conversation_date ? ` (conversation ${conversation_date})` : ""}`,
        schedule: "once",
        last_triggered: null,
        next_trigger: now,
        active: true,
        created_at: now,
      });

      return {
        content: [{
          type: "text",
          text: `Conversation flagged for ${scout_email}: ${reason}`,
        }],
      };
    },
  );
}
