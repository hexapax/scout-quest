// rank-guide resource — full rank requirements with optional scout completion status

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRankRequirements } from "../knowledge/reference.js";

const VALID_RANKS = ["scout", "tenderfoot", "second-class", "first-class", "star", "life", "eagle"];

export function registerRankGuideResource(server: McpServer): void {
  // Register one resource per rank for easy access
  for (const rank of VALID_RANKS) {
    server.registerResource(
      `rank_guide_${rank.replace("-", "_")}`,
      `rank-guide://${rank}`,
      {
        title: `${rank.charAt(0).toUpperCase() + rank.slice(1)} Requirements`,
        description: `Full requirement text for ${rank} rank`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        const text = await getRankRequirements(rank);
        return { contents: [{ uri: uri.href, text, mimeType: "text/markdown" }] };
      },
    );
  }
}
