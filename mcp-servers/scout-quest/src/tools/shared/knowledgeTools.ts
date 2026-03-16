// Shared knowledge base MCP tool registrations
// Registered on all three servers (scout, guide, admin)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchKnowledge } from "../../knowledge/search.js";
import { getRankRequirements, getMeritBadgeInfo } from "../../knowledge/reference.js";

/**
 * Register knowledge tools available to ALL servers (scout, guide, admin).
 */
export function registerKnowledgeTools(server: McpServer): void {
  // --- search_scouting_knowledge ---
  server.registerTool(
    "search_scouting_knowledge",
    {
      title: "Search Scouting Knowledge Base",
      description:
        "Semantic search over BSA/Scouting America policies, rank requirements, merit badge info, " +
        "procedures, and troop-specific customs. Use this INSTEAD of relying on training data for " +
        "BSA-specific questions. Returns BSA reference material plus any troop overrides/supplements.",
      inputSchema: {
        query: z.string().describe("Natural language question about BSA policy, rank requirements, merit badges, or troop practices"),
        category: z.string().optional().describe("Filter: rank_requirement, merit_badge, policy, procedure, strategy, troop"),
        limit: z.number().optional().default(5).describe("Number of results (default 5)"),
      },
    },
    async ({ query, category, limit }) => {
      try {
        const results = await searchKnowledge(query, { category, limit });
        const sections: string[] = [];

        if (results.bsaResults.length > 0) {
          sections.push("## BSA/Scouting America Reference\n");
          for (const r of results.bsaResults) {
            const sim = typeof r.similarity === "number" ? `${(r.similarity * 100).toFixed(0)}% match` : "";
            sections.push(
              `### ${r.category} | ${r.source || "unknown"} ${sim ? `(${sim})` : ""}\n` +
              r.content + "\n",
            );
          }
        }

        if (results.troopOverrides.length > 0) {
          sections.push("\n## Troop 2024 Customizations\n");
          for (const t of results.troopOverrides) {
            const tag =
              t.relationship === "override" ? "⚠️ TROOP OVERRIDE"
                : t.relationship === "aspirational" ? "🎯 JTE TARGET"
                  : "ℹ️ SUPPLEMENT";
            sections.push(`### ${tag} — ${t.category}\n${t.content}\n`);
          }
        }

        const text = sections.length > 0
          ? sections.join("\n")
          : `No results found for "${query}". Try broader search terms.`;

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Knowledge search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- get_rank_requirements ---
  server.registerTool(
    "get_rank_requirements",
    {
      title: "Get Rank Requirements",
      description:
        "Get full requirement text for a BSA rank with optional per-scout completion status. " +
        "Shows each requirement's text and whether the scout has completed, started, or not started it.",
      inputSchema: {
        rank: z.string().describe("Rank name: scout, tenderfoot, second-class, first-class, star, life, eagle"),
        scoutId: z.string().optional().describe("BSA userId of a scout to show their completion status"),
      },
    },
    async ({ rank, scoutId }) => {
      try {
        const text = await getRankRequirements(rank, scoutId);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- get_merit_badge_info ---
  server.registerTool(
    "get_merit_badge_info",
    {
      title: "Get Merit Badge Info",
      description:
        "Get merit badge details including Eagle-required status. " +
        "Optionally shows a specific scout's progress on this badge.",
      inputSchema: {
        meritBadge: z.string().describe("Merit badge name, e.g. 'Camping', 'First Aid', 'Personal Management'"),
        scoutId: z.string().optional().describe("BSA userId of a scout to show their progress"),
      },
    },
    async ({ meritBadge, scoutId }) => {
      try {
        const text = await getMeritBadgeInfo(meritBadge, scoutId);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
