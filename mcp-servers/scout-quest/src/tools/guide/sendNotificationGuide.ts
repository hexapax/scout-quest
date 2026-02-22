import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserRoles } from "../../auth.js";

export function registerSendNotificationGuide(server: McpServer, guideEmail: string): void {
  server.registerTool(
    "send_notification_guide",
    {
      title: "Send Notification to Scout",
      description: "Push a notification to a linked scout's device via ntfy.",
      inputSchema: {
        scout_email: z.string().email().describe("Scout's email"),
        title: z.string().describe("Notification title"),
        message: z.string().describe("Notification body"),
        priority: z.enum(["low", "default", "high"]).optional().describe("Notification priority"),
      },
    },
    async ({ scout_email, title, message, priority }) => {
      const roles = await getUserRoles(guideEmail);
      const guideRole = roles.find(r => r.type === "guide");
      if (!guideRole || guideRole.type !== "guide" || !guideRole.scout_emails.includes(scout_email)) {
        return { content: [{ type: "text", text: "Error: Not authorized for this scout." }] };
      }

      const topic = process.env.NTFY_TOPIC;
      if (!topic) {
        return { content: [{ type: "text", text: "Error: NTFY_TOPIC not configured." }] };
      }

      const response = await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          "Title": title,
          ...(priority ? { "Priority": priority } : {}),
        },
        body: message,
      });

      if (!response.ok) {
        return { content: [{ type: "text", text: `Error: ntfy returned ${response.status}` }] };
      }

      return { content: [{ type: "text", text: `Notification sent to ${scout_email}: "${title}"` }] };
    },
  );
}
