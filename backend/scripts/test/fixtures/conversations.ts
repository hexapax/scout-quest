/**
 * Fixture ConversationSummary objects for event-extractor scenario coverage.
 *
 * Each fixture mirrors the shape `generateConversationSummary` produces from
 * the Haiku call — but is synthesized so tests can run without an API key.
 * Covers the four shapes the Stream G plan calls out:
 *
 *   chitchat        — pure social talk; the extractor should produce zero events
 *   advancement     — many achievements/next_steps; rich payload extraction
 *   blocker         — adult-help-needed items dominate
 *   safety          — safety_tier set; recap content remains information-forward
 *
 * Kept as a builder so scenarios can override scoutEmail / troopId / ts cheaply.
 */

import { ObjectId } from "mongodb";
import type { ConversationSummary } from "../../../src/conversation-summary.js";

export interface FixtureOverrides {
  scoutEmail?: string;
  userEmail?: string;
  troopId?: string | null;
  conversationId?: ObjectId;
  generatedAt?: Date;
}

interface FixtureBlueprint {
  one_liner: string;
  parent_recap: string;
  scout_recap: string;
  topics: string[];
  achievements: string[];
  next_steps: string[];
  blockers: string[];
  channel?: ConversationSummary["channel"];
  durationMs?: number;
  turnCount?: number;
  safety_tier?: 1 | 2 | 3;
}

const BLUEPRINTS: Record<string, FixtureBlueprint> = {
  chitchat: {
    one_liner: "Casual chat about a favorite campout memory",
    parent_recap:
      "Liam reminisced about the spring campout and a funny story from the canoe trip. No advancement work this session.",
    scout_recap:
      "Glad we could just catch up today. Whenever you're ready to dive back into rank work, I'm here.",
    topics: ["campout memories"],
    achievements: [],
    next_steps: [],
    blockers: [],
    channel: "chat",
    durationMs: 4 * 60 * 1000,
    turnCount: 3,
  },

  advancement: {
    one_liner: "Camping MB progress and First Class plan",
    parent_recap:
      "Liam reported finishing Camping MB requirement 4 and earned the Tenderfoot rank patch at the Court of Honor. He committed to emailing his counselor this week.",
    scout_recap:
      "Strong session — you knocked out Camping req 4 and locked in your next steps. Email Mr. Brunt by Sunday and we'll line up the SM conference.",
    topics: ["Camping MB", "First Class req 5b", "Tenderfoot"],
    achievements: [
      "Reported finishing Camping MB req 4",
      "Earned the Tenderfoot rank patch from the Court of Honor",
      "Reported finishing First Class requirement 5b",
    ],
    next_steps: [
      "I'll email Mr. Brunt about being my counselor",
      "Schedule SM conference for First Class",
      "I will start Personal Management Merit Badge over the weekend",
    ],
    blockers: [],
    channel: "chat",
    durationMs: 22 * 60 * 1000,
    turnCount: 14,
  },

  blocker: {
    one_liner: "Stuck on multiple sign-offs",
    parent_recap:
      "Liam is waiting on adult sign-offs for Camping MB and First Class. He needs the troop to set up an SM conference and confirm a counselor.",
    scout_recap:
      "You're not stuck — you're queued. I'll flag the open items so a leader can clear them and you can keep moving.",
    topics: ["Camping MB", "First Class"],
    achievements: [],
    next_steps: [],
    blockers: [
      "Needs counselor sign-off for Camping MB req 5",
      "Needs SM conference scheduled for First Class",
      "Needs confirmation of merit badge counselor assignment",
    ],
    channel: "chat",
    durationMs: 7 * 60 * 1000,
    turnCount: 6,
  },

  safety: {
    one_liner: "School-stress check-in",
    parent_recap:
      "Liam mentioned feeling overwhelmed about school this week. He stayed engaged and we pivoted to a small win — finishing one Personal Fitness req together.",
    scout_recap:
      "Thanks for being open with me today. Small steps count — finishing that Personal Fitness piece was real progress.",
    topics: ["Personal Fitness MB", "school stress"],
    achievements: ["Reported finishing Personal Fitness req 1a"],
    next_steps: ["I'll talk to my parents about scheduling tutoring"],
    blockers: [],
    safety_tier: 2,
    channel: "voice",
    durationMs: 11 * 60 * 1000,
    turnCount: 9,
  },
};

export type FixtureKey = keyof typeof BLUEPRINTS & string;

export function buildSummaryFixture(
  key: FixtureKey,
  overrides: FixtureOverrides = {},
): ConversationSummary {
  const bp = BLUEPRINTS[key];
  if (!bp) throw new Error(`Unknown fixture: ${key}`);

  const conversationId = overrides.conversationId ?? new ObjectId();
  const generatedAt = overrides.generatedAt ?? new Date("2026-04-26T15:00:00Z");
  const scoutEmail = overrides.scoutEmail ?? "liam@test.example";
  const userEmail = overrides.userEmail ?? scoutEmail;

  return {
    _id: conversationId,
    scoutEmail,
    userEmail,
    troopId: overrides.troopId ?? "9999",
    channel: bp.channel ?? "chat",
    durationMs: bp.durationMs ?? 0,
    turnCount: bp.turnCount ?? 0,
    one_liner: bp.one_liner,
    parent_recap: bp.parent_recap,
    scout_recap: bp.scout_recap,
    topics: [...bp.topics],
    achievements: [...bp.achievements],
    next_steps: [...bp.next_steps],
    blockers: [...bp.blockers],
    ...(bp.safety_tier ? { safety_tier: bp.safety_tier } : {}),
    generated_at: generatedAt,
    generated_by_model: "fixture",
  };
}

export const FIXTURE_KEYS: FixtureKey[] = ["chitchat", "advancement", "blocker", "safety"];
