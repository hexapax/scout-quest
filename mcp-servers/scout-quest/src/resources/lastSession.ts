import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessionNotes } from "../db.js";

export function registerLastSession(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "last_session",
    "scout://last-session",
    {
      title: "Last Session Notes",
      description: "What happened in the most recent session — topics, progress, pending items.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await sessionNotes();
      const latest = await col.findOne(
        { scout_email: scoutEmail },
        { sort: { session_date: -1 } },
      );

      if (!latest) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ status: "no_sessions", message: "No previous sessions recorded." }),
          }],
        };
      }

      const { _id, ...noteData } = latest;
      return { contents: [{ uri: uri.href, text: JSON.stringify(noteData) }] };
    },
  );
}
