/**
 * event-extractor: synthetic ConversationSummary → ScoutStateEvent[]
 *
 * Pure function test — no DB writes. Validates:
 *   - achievements/next_steps/blockers map to the right event types
 *   - simple commitment-language detection ("I'll", "going to")
 *   - payload extraction (rankName, badgeName, requirementCode)
 *   - episode.unresolved fallback dedupes against summary.next_steps
 */

import type { Scenario } from "../lib/scenario.js";

export const scenario: Scenario = {
  name: "event-extractor",
  description: "extractEventsFromSummary maps summary fields to scout-state events",

  async seed() {
    /* nothing — pure unit test */
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const { extractEventsFromSummary } = await import("../../../src/event-extractor.js");

    const convId = new ObjectId();
    const ts = new Date("2026-04-26T12:00:00Z");

    const summary = {
      _id: convId,
      scoutEmail: "liam@test.example",
      userEmail: "liam@test.example",
      troopId: "9999",
      channel: "chat" as const,
      durationMs: 12000,
      turnCount: 8,
      one_liner: "Camping MB and First Class plan",
      parent_recap: "Liam mapped out his Camping MB plan.",
      scout_recap: "Nice work today, Liam!",
      topics: ["Camping MB", "First Class req 5b"],
      achievements: [
        "Reported finishing Camping MB req 4",
        "Earned the Tenderfoot rank patch from the Court of Honor",
      ],
      next_steps: [
        "I'll email Mr. Brunt about being my counselor", // commitment language
        "Schedule SM conference for First Class",        // unresolved
      ],
      blockers: [
        "Needs counselor sign-off for Camping MB req 5",
      ],
      generated_at: ts,
      generated_by_model: "test",
    };

    const episode = {
      scoutEmail: "liam@test.example",
      mode: "chat" as const,
      timestamp: ts,
      topics: ["Camping MB", "First Class req 5b"],
      toolsUsed: [],
      questions: [],
      corrections: [],
      unresolved: [
        "Schedule SM conference for First Class", // dup of summary.next_steps[1]
        "Bring tent stakes to Woodruff",          // unique to episode
      ],
      engagement: "high" as const,
      summary: "Mapped Camping MB plan",
      turnCount: 8,
    };

    const events = extractEventsFromSummary(summary, episode, {
      conversationId: convId,
      ts,
    });

    // Expected: 2 achievements + 2 next_steps + 1 blocker + 1 unique episode.unresolved = 6
    check("event count = 6", events.length === 6, { count: events.length, types: events.map(e => e.type) });

    // Achievement type detection
    const a0 = events.find((e) => e.note.includes("Camping MB req 4"));
    check(
      "Camping MB req 4 mapped to requirement_reported_complete",
      a0?.type === "requirement_reported_complete",
      a0,
    );
    const a1 = events.find((e) => e.note.includes("Tenderfoot rank patch"));
    check(
      "Tenderfoot patch mapped to achievement_celebrated",
      a1?.type === "achievement_celebrated",
      a1,
    );

    // Commitment language detection
    const ns0 = events.find((e) => e.note.includes("email Mr. Brunt"));
    check(
      "I'll-language mapped to commitment_made",
      ns0?.type === "commitment_made",
      ns0,
    );
    const ns1 = events.find((e) => e.note.includes("Schedule SM conference"));
    check(
      "non-commitment next-step mapped to topic_unresolved",
      ns1?.type === "topic_unresolved",
      ns1,
    );

    // Blocker
    const blk = events.find((e) => e.type === "blocker");
    check("blocker present", blk !== undefined, events.map((e) => e.type));

    // Episode unresolved dedupe
    const unique = events.filter((e) => e.note.includes("tent stakes"));
    check("unique episode.unresolved item kept", unique.length === 1, unique);
    const dupCount = events.filter((e) => e.note.includes("Schedule SM conference")).length;
    check("duplicate episode.unresolved deduped (still only 1)", dupCount === 1, dupCount);

    // Payload extraction — rank, badge, requirement
    check("Tenderfoot rank extracted", a1?.payload?.rankName === "Tenderfoot", a1?.payload);
    check("Camping badge extracted", a0?.payload?.badgeName === "Camping", a0?.payload);
    const fcEvent = events.find((e) => e.note.includes("First Class"));
    check(
      "First Class rank extracted",
      fcEvent?.payload?.rankName === "First Class",
      fcEvent?.payload,
    );
  },
};
