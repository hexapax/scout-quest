import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MongoClient } from "mongodb";
import { getUserRoles } from "../../auth.js";

export function registerGetConversationDetail(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "get_conversation_detail",
    {
      title: "Get Conversation Detail",
      description: "Pull full transcript for a specific scout conversation (opt-in). Requires guide authorization.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        conversation_id: z.string().describe("LibreChat conversation ID"),
      },
    },
    async ({ scout_email, conversation_id }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const lcUri = process.env.LIBRECHAT_MONGO_URI || process.env.MONGO_URI?.replace("/scoutquest", "/librechat") || "";
      if (!lcUri) {
        return { content: [{ type: "text", text: "Error: LibreChat MongoDB URI not configured." }] };
      }

      const client = new MongoClient(lcUri);
      try {
        await client.connect();
        const lcDb = client.db();

        const messages = await lcDb.collection("messages")
          .find({ conversationId: conversation_id })
          .sort({ createdAt: 1 })
          .toArray();

        if (messages.length === 0) {
          return { content: [{ type: "text", text: "No messages found for this conversation." }] };
        }

        const transcript = messages.map(m => ({
          role: m.sender,
          text: typeof m.text === "string" ? m.text.slice(0, 500) : "",
          timestamp: m.createdAt,
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ conversation_id, message_count: messages.length, transcript }),
          }],
        };
      } finally {
        await client.close();
      }
    },
  );
}
