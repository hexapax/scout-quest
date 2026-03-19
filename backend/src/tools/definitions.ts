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

/** Tools that require write access to BSA Scoutbook (BSA token required). */
export const BSA_WRITE_TOOLS: ToolDefinition[] = [
  {
    name: "advance_requirement",
    description:
      "Mark a rank requirement as complete in BSA Scoutbook. " +
      "Use when a scout reports completing a requirement and a leader has already approved it. " +
      "Do NOT call unless the scout confirms the work is done and a leader has reviewed it. " +
      "Requires a valid BSA leader token.",
    input_schema: {
      type: "object",
      properties: {
        scoutUserId: {
          type: "string",
          description: "BSA userId of the scout (from their Scoutbook profile).",
        },
        rankName: {
          type: "string",
          description: 'Full rank name, e.g., "Second Class", "First Class", "Eagle".',
        },
        requirementNumber: {
          type: "string",
          description: 'Requirement identifier, e.g., "1a", "3b", "7".',
        },
        dateCompleted: {
          type: "string",
          description: "Date the scout completed the requirement (YYYY-MM-DD).",
        },
        notes: {
          type: "string",
          description: "Optional leader notes to attach as a Scoutbook comment.",
        },
      },
      required: ["scoutUserId", "rankName", "requirementNumber", "dateCompleted"],
    },
  },
  {
    name: "rsvp_event",
    description:
      "RSVP a scout to a BSA calendar event. " +
      "Use when the scout says they plan to attend, might attend, or cannot attend an event. " +
      "Requires the BSA eventId — only call if you know it (e.g., from a prior tool result).",
    input_schema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "BSA event ID (numeric string).",
        },
        scoutUserId: {
          type: "string",
          description: "BSA userId of the scout to RSVP.",
        },
        rsvpCode: {
          type: "string",
          enum: ["Y", "M", "N"],
          description: "Y = yes (attending), M = maybe, N = no (not attending).",
        },
      },
      required: ["eventId", "scoutUserId", "rsvpCode"],
    },
  },
  {
    name: "log_activity",
    description:
      "Record a service project or other activity in BSA Scoutbook for service-hour credit. " +
      "Use when logging a completed service project with a list of youth participants and hours. " +
      "Do NOT use for rank requirements — use advance_requirement for those. " +
      "Requires a valid BSA leader token.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Activity name, e.g., \"Eagle Project — Dunwoody Nature Center\".",
        },
        startDateTime: {
          type: "string",
          description: "Start datetime in ISO format (UTC), e.g., \"2026-03-14T15:30:00.000Z\".",
        },
        endDateTime: {
          type: "string",
          description: "End datetime in ISO format (UTC).",
        },
        location: {
          type: "string",
          description: "Location name or address.",
        },
        city: {
          type: "string",
          description: "City where the activity took place.",
        },
        description: {
          type: "string",
          description: "Brief description of the activity.",
        },
        activityTypeId: {
          type: "number",
          description: "BSA activity type: 1 = Service Project.",
        },
        categoryId: {
          type: "number",
          description: "BSA category ID: 47 = confirmed for service projects.",
        },
        participants: {
          type: "array",
          description: "Youth participants and their service hours.",
          items: {
            type: "object",
            properties: {
              userId: { type: "string", description: "BSA userId." },
              serviceHours: { type: "number", description: "Hours of service." },
            },
            required: ["userId", "serviceHours"],
          },
        },
      },
      required: ["name", "startDateTime", "endDateTime", "location", "city", "description", "activityTypeId", "categoryId", "participants"],
    },
  },
];

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
  ...BSA_WRITE_TOOLS,
  {
    name: "create_pending_action",
    description:
      "Create a pending action for the scout to review before execution. " +
      "Use for emails (the scout reviews the draft before sending) or any write " +
      "operation that should have human confirmation. Returns a link the scout " +
      "can click to review and approve. Do NOT execute BSA write actions directly " +
      "when sending email — always route through this tool so the scout can review.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["send_email", "advance_requirement", "rsvp_event"],
          description: "Action type.",
        },
        payload: {
          type: "object",
          description:
            "Action-specific payload. For send_email: { subject, body (HTML), toMemberIds, bccMemberIds, parentCcMemberIds }. " +
            "For advance_requirement: { rankId, scoutUserId, requirementId, dateCompleted }. " +
            "For rsvp_event: { eventId, scoutUserId, rsvpCode }.",
        },
      },
      required: ["type", "payload"],
    },
  },
  {
    name: "log_requirement_work",
    description:
      "Log evidence of work toward a scouting requirement. Replaces badge-specific tools. " +
      "Use when a scout reports completing a chore, making a budget entry, writing a diary entry, " +
      "practicing a skill, or logging service hours. Do NOT call for signing off a requirement " +
      "— use advance_requirement for that.",
    input_schema: {
      type: "object",
      properties: {
        evidenceType: {
          type: "string",
          enum: ["chore_log", "budget_entry", "diary_entry", "time_management", "service_hours", "skill_practice", "general"],
          description: "Type of evidence being logged.",
        },
        description: {
          type: "string",
          description: "What the scout did. Be specific.",
        },
        requirementRef: {
          type: "string",
          description: 'Optional requirement reference, e.g., "PM 2c", "FL 3a", "Camping 9a".',
        },
        data: {
          type: "object",
          description:
            "Type-specific data. chore_log: { choreName, amount }. " +
            "budget_entry: { type (income|expense), amount, category }. " +
            "diary_entry: no extra data needed. " +
            "time_management: { type (todo|schedule), items }.",
        },
      },
      required: ["evidenceType", "description"],
    },
  },
  {
    name: "cross_reference",
    description:
      "Find connections between merit badges, ranks, and requirements using the knowledge graph. " +
      "Use for questions like 'what badges are related to Camping?', 'what Eagle badges do I still need?', " +
      "'what changed in this badge recently?', 'what rank requirements overlap with this merit badge?'. " +
      "Do NOT use for simple requirement lookups — use get_scout_status or search_bsa_reference for those.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["related_badges", "eagle_requirements", "rank_overlap", "version_changes", "badge_for_skill", "category_badges"],
          description:
            "related_badges: badges in same category. " +
            "eagle_requirements: Eagle-required badges (with scout completion status). " +
            "rank_overlap: requirements that overlap between a badge and rank. " +
            "version_changes: what changed between requirement versions. " +
            "badge_for_skill: badges related to a skill/topic. " +
            "category_badges: all badges in a category.",
        },
        badgeName: {
          type: "string",
          description: "Merit badge name (for related_badges, rank_overlap, version_changes, category_badges).",
        },
        rankName: {
          type: "string",
          description: "Rank name (for rank_overlap, version_changes).",
        },
        skillOrTopic: {
          type: "string",
          description: "Skill or topic to search for (for badge_for_skill).",
        },
      },
      required: ["scope"],
    },
  },
];
