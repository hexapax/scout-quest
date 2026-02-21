import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scouts } from "../db.js";

export function registerCharacter(server: McpServer, scoutEmail: string): void {
  server.registerResource(
    "character",
    "scout://character",
    {
      title: "Character Config",
      description: "AI character personality settings — base type, quest overlay, tone dials, SM/parent notes, avoid list.",
      mimeType: "application/json",
    },
    async (uri) => {
      const col = await scouts();
      const scout = await col.findOne({ email: scoutEmail });
      if (!scout) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Scout not found" }) }] };
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(scout.character),
        }],
      };
    },
  );
}
