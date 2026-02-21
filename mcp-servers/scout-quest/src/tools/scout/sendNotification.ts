import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSendNotification(server: McpServer): void {
  server.registerTool(
    "send_notification",
    {
      title: "Send Notification",
      description: "Send a push notification via ntfy.sh. Requires NTFY_TOPIC environment variable.",
      inputSchema: {
        message: z.string().describe("Notification message"),
        title: z.string().optional().describe("Notification title"),
        priority: z.number().int().min(1).max(5).optional().describe("Priority 1-5 (3 = default)"),
        tags: z.array(z.string()).optional().describe("Emoji tags (e.g. ['trophy', 'tada'])"),
      },
    },
    async ({ message, title, priority, tags }) => {
      const topic = process.env.NTFY_TOPIC;
      if (!topic) {
        return { content: [{ type: "text", text: "Error: NTFY_TOPIC not configured. Notifications are disabled." }] };
      }

      try {
        const response = await fetch(`https://ntfy.sh/${topic}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            message,
            ...(title && { title }),
            ...(priority && { priority }),
            ...(tags && { tags }),
          }),
        });

        if (!response.ok) {
          return { content: [{ type: "text", text: `Error: ntfy responded with ${response.status}: ${await response.text()}` }] };
        }

        return { content: [{ type: "text", text: `Notification sent: "${title || message}"` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error sending notification: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );
}
