// troop-policies resource — all troop customizations loaded at session start

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllTroopPolicies, getJTEGaps } from "../knowledge/troop-policy.js";

export function registerTroopPoliciesResource(server: McpServer): void {
  server.registerResource(
    "troop_policies",
    "troop://policies",
    {
      title: "Troop Policies",
      description: "All Troop 2024 policies, customs, and JTE targets",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const text = await getAllTroopPolicies();
      return { contents: [{ uri: uri.href, text, mimeType: "text/markdown" }] };
    },
  );
}

export function registerJTEGapsResource(server: McpServer): void {
  server.registerResource(
    "jte_gaps",
    "admin://jte-gaps",
    {
      title: "JTE Gap Analysis",
      description: "Where troop practice differs from BSA policy",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const text = await getJTEGaps();
      return { contents: [{ uri: uri.href, text, mimeType: "text/markdown" }] };
    },
  );
}
