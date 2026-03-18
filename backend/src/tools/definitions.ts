/** Anthropic tool definitions for Scout Quest backend tools.
 * These are executed server-side — LibreChat never sees them. */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const SCOUT_TOOLS: ToolDefinition[] = [
  {
    name: "get_scout_status",
    description:
      "Get this scout's current advancement progress from the knowledge graph. " +
      "Call when the scout asks about their progress, what requirements they still need, " +
      "their current rank, or merit badge status. Do NOT call for general BSA policy questions " +
      "— your embodied knowledge covers those.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["rank_progress", "rank_requirements", "merit_badges", "summary"],
          description:
            "rank_progress: all ranks and completion %. " +
            "rank_requirements: remaining requirements for a specific rank. " +
            "merit_badges: earned and in-progress merit badges. " +
            "summary: high-level overview of all advancement.",
        },
        rank_name: {
          type: "string",
          description:
            'Required when scope=rank_requirements. Full rank name, e.g., "First Class", "Life", "Eagle".',
        },
      },
      required: ["scope"],
    },
  },
  {
    name: "search_bsa_reference",
    description:
      "Search BSA reference material for specific requirement text or policy detail. " +
      "Use ONLY when your embodied knowledge doesn't cover the needed specifics, " +
      "such as exact requirement wording for an edge case or obscure merit badge detail. " +
      "Do NOT use for common policy questions or rank requirements you already know.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'What to search for. Be specific, e.g., "First Aid 1a exact wording" or "Eagle project approval timeline".',
        },
        category: {
          type: "string",
          enum: ["requirements", "policy", "merit_badges", "any"],
          description: "Optional: narrow the search to a specific category.",
        },
      },
      required: ["query"],
    },
  },
];
