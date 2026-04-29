/**
 * rolling-summary-debounce: maybeRegenerateRollingSummary fires only when the
 * threshold is met.
 *
 * No actual Anthropic call exercised here — we set rolling_summary_input_event_count
 * directly to simulate the post-regen state and assert on the {regenerated, reason}
 * return value's debounce reasoning. The regenerate path itself (which DOES call
 * Haiku) lives behind getScoutState/regenerateRollingSummary and is exercised
 * separately in any LLM-on test.
 *
 * The debounce logic this scenario locks in:
 *   - 0 events            → no regen ("no events")
 *   - regen never run yet → ALWAYS regen ("first regen") — but we simulate this
 *     state and expect the call to *attempt* regen (and fail without an API key,
 *     which the module logs and absorbs)
 *   - +1 event since last  → no regen (under threshold)
 *   - +3 events since last → regen
 *   - >24h since last      → regen
 */

import type { Scenario } from "../lib/scenario.js";

const SCOUT = "liam@test.example";

export const scenario: Scenario = {
  name: "rolling-summary-debounce",
  description: "maybeRegenerateRollingSummary fires only when event-count or time threshold is met",

  async seed() {
    /* nothing — scenario writes via the public module + manual state poking */
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const { getScoutQuestDb } = await import("../../../src/db.js");
    const {
      appendScoutStateEvents,
      maybeRegenerateRollingSummary,
    } = await import("../../../src/scout-state.js");

    // Case 1: empty state → "no state"
    let r = await maybeRegenerateRollingSummary(SCOUT);
    check("empty: no regen", !r.regenerated, r);
    check("empty: reason = 'no state'", r.reason === "no state", r);

    // Append one event so a state doc exists.
    await appendScoutStateEvents(SCOUT, [
      {
        ts: new Date(),
        conversationId: new ObjectId(),
        type: "interest_expressed",
        note: "starting",
        confidence: 0.7,
      },
    ]);

    // Case 2: first regen ever (rolling_summary_updated_at === null) → would
    // attempt regen (which fails silently without API key in test env). The
    // function returns regenerated:true even though the LLM call was a no-op.
    r = await maybeRegenerateRollingSummary(SCOUT);
    check("first time: returns regenerated=true", r.regenerated, r);
    check("first time: reason = 'first regen'", r.reason === "first regen", r);

    // Manually set state as if regen had succeeded so the next branches are testable.
    const db = getScoutQuestDb();
    await db.collection("scout_state").updateOne(
      { scoutEmail: SCOUT },
      {
        $set: {
          rolling_summary: "synthetic prior summary",
          rolling_summary_updated_at: new Date(),
          rolling_summary_model: "test",
          rolling_summary_input_event_count: 1, // matches current events.length
        },
      },
    );

    // Case 3: no new events since last regen → debounced
    r = await maybeRegenerateRollingSummary(SCOUT);
    check("no new events: no regen", !r.regenerated, r);

    // Case 4: append 1 more event (grewBy=1, under threshold of 3) → debounced
    await appendScoutStateEvents(SCOUT, [
      {
        ts: new Date(),
        conversationId: new ObjectId(),
        type: "topic_unresolved",
        note: "loose end",
        confidence: 0.7,
      },
    ]);
    r = await maybeRegenerateRollingSummary(SCOUT);
    check("+1 event under threshold: no regen", !r.regenerated, r);

    // Case 5: append 2 more events (grewBy=3 total since last regen) → regen fires
    await appendScoutStateEvents(SCOUT, [
      {
        ts: new Date(),
        conversationId: new ObjectId(),
        type: "topic_unresolved",
        note: "another",
        confidence: 0.7,
      },
      {
        ts: new Date(),
        conversationId: new ObjectId(),
        type: "achievement_celebrated",
        note: "Earned First Aid MB",
        confidence: 0.7,
      },
    ]);
    r = await maybeRegenerateRollingSummary(SCOUT);
    check("+3 events ≥ threshold: regen fires", r.regenerated, r);
    check("+3 events: reason mentions event count", r.reason?.includes("events"), r.reason);

    // Case 6: time-based regen — pretend last regen was 25h ago, no new events
    await db.collection("scout_state").updateOne(
      { scoutEmail: SCOUT },
      {
        $set: {
          rolling_summary_updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
          rolling_summary_input_event_count: 4, // matches current events.length
        },
      },
    );
    r = await maybeRegenerateRollingSummary(SCOUT);
    check("25h since last regen, no new events: regen fires", r.regenerated, r);
    check("time-based: reason mentions hours", r.reason?.includes("h since last regen"), r.reason);
  },
};
