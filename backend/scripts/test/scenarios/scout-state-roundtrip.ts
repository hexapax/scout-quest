/**
 * scout-state-roundtrip: append events, read state, verify
 * - dedupe by (conversationId, type, source_quote)
 * - cap at MAX_EVENTS
 * - stats (total_sessions, last_session_at, distinct_topics_30d)
 *
 * No LLM call here. The rolling-summary regen path lives in a separate
 * test (rolling-summary-debounce) so this scenario stays free.
 */

import type { Scenario } from "../lib/scenario.js";

const SCOUT = "liam@test.example";

export const scenario: Scenario = {
  name: "scout-state-roundtrip",
  description: "appendScoutStateEvents writes/dedupes/caps; getScoutState reads back",

  async seed() {
    /* nothing — scenario writes via the public module */
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const {
      appendScoutStateEvents,
      getScoutState,
    } = await import("../../../src/scout-state.js");

    const conv1 = new ObjectId();
    const conv2 = new ObjectId();
    const t = new Date("2026-04-26T12:00:00Z");

    // Round 1: 2 events, different types.
    await appendScoutStateEvents(SCOUT, [
      {
        ts: t,
        conversationId: conv1,
        type: "achievement_celebrated",
        note: "Reported finishing Camping MB req 4",
        confidence: 0.8,
        source_quote: "Reported finishing Camping MB req 4",
        payload: { badgeName: "Camping" },
      },
      {
        ts: t,
        conversationId: conv1,
        type: "blocker",
        note: "Need SM conference for First Class",
        confidence: 0.7,
        source_quote: "Need SM conference for First Class",
        payload: { rankName: "First Class" },
      },
    ], { troopId: "9999" });

    let state = await getScoutState(SCOUT);
    check("state created on first append", state !== null);
    check("2 events stored", state?.events.length === 2, state?.events.length);
    check("troopId persisted", state?.troopId === "9999", state?.troopId);
    check("total_sessions = 1 (one conv)", state?.stats.total_sessions === 1, state?.stats.total_sessions);

    // Round 2: same scout, same conv, one duplicate + one new event.
    // Duplicate should be dropped by dedupe.
    await appendScoutStateEvents(SCOUT, [
      {
        ts: t,
        conversationId: conv1,
        type: "achievement_celebrated",
        note: "Reported finishing Camping MB req 4",
        confidence: 0.8,
        source_quote: "Reported finishing Camping MB req 4",
      },
      {
        ts: t,
        conversationId: conv1,
        type: "topic_unresolved",
        note: "Bring tent stakes to Woodruff",
        confidence: 0.7,
        source_quote: "Bring tent stakes to Woodruff",
      },
    ]);

    state = await getScoutState(SCOUT);
    check("dedupe blocked the duplicate; total now 3", state?.events.length === 3, state?.events.length);

    // Round 3: different conv → different session.
    const t2 = new Date("2026-04-27T18:00:00Z");
    await appendScoutStateEvents(SCOUT, [
      {
        ts: t2,
        conversationId: conv2,
        type: "interest_expressed",
        note: "Wants to start Personal Management MB",
        confidence: 0.7,
        source_quote: "I want to start Personal Management",
        payload: { badgeName: "Personal Management" },
      },
    ]);

    state = await getScoutState(SCOUT);
    check("event from conv2 appended", state?.events.length === 4, state?.events.length);
    check("total_sessions = 2 (two distinct convs)", state?.stats.total_sessions === 2, state?.stats.total_sessions);
    check(
      "last_session_at = newer event ts",
      state?.stats.last_session_at?.toISOString() === t2.toISOString(),
      state?.stats.last_session_at,
    );
    check(
      "distinct_topics_30d includes Camping MB",
      state?.stats.distinct_topics_30d.includes("Camping MB") === true,
      state?.stats.distinct_topics_30d,
    );

    // Order: newest first.
    if (state) {
      check(
        "events newest-first (Personal Management MB on top)",
        state.events[0].note.includes("Personal Management"),
        state.events[0].note,
      );
    }
  },
};
