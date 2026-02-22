import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sessionNotes } from "../../db.js";

export function registerLogSessionNotes(server: McpServer, scoutEmail: string): void {
  server.registerTool(
    "log_session_notes",
    {
      title: "Log Session Notes",
      description:
        "Capture what happened this session — topics, progress, pending items, next focus. Call this when wrapping up.",
      inputSchema: {
        topics_discussed: z.array(z.string()).min(1).describe("What was covered this session"),
        progress_made: z.string().describe("What got accomplished"),
        pending_items: z
          .array(z.string())
          .optional()
          .describe("What the scout committed to doing"),
        next_session_focus: z
          .string()
          .optional()
          .describe("Suggested focus for next session"),
      },
    },
    async ({ topics_discussed, progress_made, pending_items, next_session_focus }) => {
      const col = await sessionNotes();
      const now = new Date();

      await col.insertOne({
        scout_email: scoutEmail,
        session_date: now,
        source: "agent",
        topics_discussed,
        progress_made,
        pending_items: pending_items ?? [],
        next_session_focus,
        created_at: now,
      });

      const parts = [
        `Session notes saved. Topics: ${topics_discussed.join(", ")}.`,
        `Progress: ${progress_made}.`,
      ];
      if (pending_items?.length) parts.push(`Pending: ${pending_items.join(", ")}.`);
      if (next_session_focus) parts.push(`Next session: ${next_session_focus}.`);

      return { content: [{ type: "text", text: parts.join(" ") }] };
    },
  );
}
