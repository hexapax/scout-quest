// Advancement planning tools — registered on guide + admin servers only

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTroopAdvancementSummary, suggestMeetingActivities } from "../../knowledge/meeting-planner.js";
import { addTroopPolicy, getAllTroopPolicies } from "../../knowledge/troop-policy.js";

/**
 * Register advancement planning tools for guide + admin servers.
 */
export function registerAdvancementPlanningTools(server: McpServer): void {
  // --- get_troop_advancement_summary ---
  server.registerTool(
    "get_troop_advancement_summary",
    {
      title: "Troop Advancement Summary",
      description:
        "Get a summary of all scouts' advancement status: current rank, Eagle MB progress, " +
        "total merit badges earned. Useful for troop-wide planning and identifying who needs help.",
      inputSchema: {
        rank: z.string().optional().describe("Filter by current rank (e.g. 'tenderfoot', 'life')"),
        eagleCandidatesOnly: z.boolean().optional().describe("Show only Life/Eagle scouts"),
      },
    },
    async ({ rank, eagleCandidatesOnly }) => {
      try {
        const text = await getTroopAdvancementSummary({ rank, eagleCandidatesOnly });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // --- suggest_meeting_activities ---
  server.registerTool(
    "suggest_meeting_activities",
    {
      title: "Suggest Meeting Activities",
      description:
        "Suggest advancement activities for a troop meeting based on which requirements " +
        "the most scouts need. Shows the most-needed requirements across the troop and " +
        "categorizes them by what can be done at a meeting vs needs field/home activities.",
      inputSchema: {
        durationMinutes: z.number().describe("Meeting duration in minutes"),
        focus: z.string().optional().describe("Optional focus area: 'tenderfoot', 'eagle-mb', 'skills', etc."),
      },
    },
    async ({ durationMinutes, focus }) => {
      try {
        const text = await suggestMeetingActivities(durationMinutes, focus);
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

/**
 * Register troop policy management tool — admin server only.
 */
export function registerTroopPolicyTool(server: McpServer): void {
  server.registerTool(
    "manage_troop_policy",
    {
      title: "Manage Troop Policy",
      description:
        "Add or update a troop-specific policy, procedure, or tradition. Policies are stored " +
        "alongside BSA reference material and surfaced when relevant questions are asked. " +
        "Use 'supplement' for additions that don't conflict with BSA, 'override' for troop " +
        "practices that differ from BSA policy, 'aspirational' for JTE improvement targets.",
      inputSchema: {
        content: z.string().describe("The policy text in natural language"),
        category: z.string().describe("Category: policy, procedure, tradition, schedule"),
        scope: z.string().optional().describe("Scope: rank:tenderfoot, merit_badge:camping, bor, campout, etc."),
        relationship: z.enum(["supplement", "override", "aspirational"]).describe("How this relates to BSA policy"),
        bsaReference: z.string().optional().describe("The BSA policy this relates to (for gap analysis)"),
      },
    },
    async ({ content, category, scope, relationship, bsaReference }) => {
      try {
        const result = await addTroopPolicy({ content, category, scope, relationship, bsaReference });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
