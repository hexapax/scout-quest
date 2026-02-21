import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scouts, requirements } from "../../db.js";
import { REQUIREMENT_DEFINITIONS } from "../../constants.js";
import type { RequirementStatus, InteractionMode } from "../../types.js";

export function registerInitializeRequirements(server: McpServer): void {
  server.registerTool(
    "initialize_requirements",
    {
      title: "Initialize Requirements",
      description: "Bulk-create requirement documents for a scout. Sets up all PM and FL requirements with initial status and quest-driven flags.",
      inputSchema: {
        scout_email: z.string().email(),
        quest_driven_req_ids: z.array(z.string()).optional().describe("Requirement IDs that are quest-driven (defaults to all)"),
        overrides: z.array(z.object({
          req_id: z.string(),
          status: z.string().optional().describe("Initial status (e.g. completed_prior, excluded)"),
          interaction_mode: z.string().optional(),
        })).optional().describe("Per-requirement status/mode overrides"),
      },
    },
    async ({ scout_email, quest_driven_req_ids, overrides }) => {
      const scoutsCol = await scouts();
      const scout = await scoutsCol.findOne({ email: scout_email });
      if (!scout) {
        return { content: [{ type: "text", text: `Error: Scout ${scout_email} not found.` }] };
      }

      const reqCol = await requirements();

      // Check if already initialized
      const existingCount = await reqCol.countDocuments({ scout_email });
      if (existingCount > 0) {
        return { content: [{ type: "text", text: `Error: Requirements already initialized for ${scout_email} (${existingCount} docs). Use override_requirement for individual changes.` }] };
      }

      const overrideMap = new Map(
        (overrides ?? []).map(o => [o.req_id, o]),
      );

      const now = new Date();
      const docs = REQUIREMENT_DEFINITIONS.map(def => {
        const override = overrideMap.get(def.req_id);
        const isQuestDriven = quest_driven_req_ids
          ? quest_driven_req_ids.includes(def.req_id)
          : true;

        return {
          scout_email,
          req_id: def.req_id,
          badge: def.badge,
          status: (override?.status ?? "not_started") as RequirementStatus,
          quest_driven: isQuestDriven,
          interaction_mode: (override?.interaction_mode ?? def.default_interaction_mode) as InteractionMode,
          ...(def.tracking_duration && { tracking_duration: def.tracking_duration }),
          tracking_progress: 0,
          notes: "",
          updated_at: now,
        };
      });

      await reqCol.insertMany(docs);

      const completedPrior = docs.filter(d => d.status === "completed_prior").length;
      const excluded = docs.filter(d => d.status === "excluded").length;

      return {
        content: [{
          type: "text",
          text: `Initialized ${docs.length} requirements for ${scout_email}. ${completedPrior} completed prior, ${excluded} excluded, ${docs.length - completedPrior - excluded} active.`,
        }],
      };
    },
  );
}
