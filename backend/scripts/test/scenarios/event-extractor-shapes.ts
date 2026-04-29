/**
 * event-extractor-shapes: extractor coverage across the four conversation
 * shapes called out in the Stream G plan (chitchat / advancement / blocker /
 * safety) plus an idempotency check.
 *
 * Pure unit test — no DB writes, no Anthropic calls. Complements
 * `event-extractor.ts` which validates the rich-payload mapping; this file
 * focuses on per-shape contract and idempotency.
 */

import type { Scenario } from "../lib/scenario.js";

export const scenario: Scenario = {
  name: "event-extractor-shapes",
  description:
    "extractor produces shape-appropriate events across chitchat/advancement/blocker/safety + is idempotent",

  async seed() {
    /* pure unit test */
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const { extractEventsFromSummary } = await import(
      "../../../src/event-extractor.js"
    );
    const { buildSummaryFixture, FIXTURE_KEYS } = await import(
      "../fixtures/conversations.js"
    );

    const ts = new Date("2026-04-26T15:00:00Z");

    // ---- chitchat: zero structured fields → zero events ----
    {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture("chitchat", { conversationId });
      const events = extractEventsFromSummary(summary, null, {
        conversationId,
        ts,
      });
      check(
        "chitchat: no events emitted",
        events.length === 0,
        { count: events.length, types: events.map((e) => e.type) },
      );
    }

    // ---- advancement: 3 achievements + 3 next_steps + 0 blockers = 6 events ----
    {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture("advancement", { conversationId });
      const events = extractEventsFromSummary(summary, null, {
        conversationId,
        ts,
      });
      check(
        "advancement: 6 events (3 achievements + 3 next_steps)",
        events.length === 6,
        { count: events.length, types: events.map((e) => e.type) },
      );

      // Three achievements: two requirement_reported_complete + one achievement_celebrated.
      const reqCompletes = events.filter(
        (e) => e.type === "requirement_reported_complete",
      );
      const celebrations = events.filter(
        (e) => e.type === "achievement_celebrated",
      );
      check(
        "advancement: 2 requirement_reported_complete events",
        reqCompletes.length === 2,
        reqCompletes.map((e) => e.note),
      );
      check(
        "advancement: 1 achievement_celebrated event (Tenderfoot rank patch)",
        celebrations.length === 1 &&
          celebrations[0].note.includes("Tenderfoot"),
        celebrations,
      );

      // All three next_steps use commitment language ("I'll", "Schedule",
      // "I will start") — but only "I'll" / "I will" should classify as
      // commitment_made. "Schedule SM conference" is not first-person and
      // should fall through to topic_unresolved.
      const commitments = events.filter((e) => e.type === "commitment_made");
      const unresolved = events.filter((e) => e.type === "topic_unresolved");
      check(
        "advancement: 2 commitment_made (I'll / I will)",
        commitments.length === 2,
        commitments.map((e) => e.note),
      );
      check(
        "advancement: 1 topic_unresolved (non-first-person Schedule)",
        unresolved.length === 1,
        unresolved.map((e) => e.note),
      );

      // No blockers in this fixture.
      const blockers = events.filter((e) => e.type === "blocker");
      check(
        "advancement: 0 blocker events",
        blockers.length === 0,
        blockers,
      );

      // Every event carries the conversationId we passed in.
      const convMatches = events.every((e) =>
        e.conversationId.equals(conversationId),
      );
      check(
        "advancement: every event carries the conversationId",
        convMatches,
        events.map((e) => e.conversationId.toHexString()),
      );
    }

    // ---- blocker: 3 blockers, no achievements/next_steps ----
    {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture("blocker", { conversationId });
      const events = extractEventsFromSummary(summary, null, {
        conversationId,
        ts,
      });
      check(
        "blocker: 3 events, all blocker type",
        events.length === 3 && events.every((e) => e.type === "blocker"),
        { count: events.length, types: events.map((e) => e.type) },
      );
    }

    // ---- safety: extractor doesn't propagate safety_tier, but should still
    //      produce events from achievements/next_steps. The safety flag itself
    //      lives on the summary doc and is rendered by the UI; the event log
    //      is not where Tier 2/3 alerts fire (Stream H handles that). ----
    {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture("safety", { conversationId });
      const events = extractEventsFromSummary(summary, null, {
        conversationId,
        ts,
      });
      // 1 achievement + 1 next_step + 0 blockers
      check(
        "safety: 2 events (1 achievement + 1 next_step)",
        events.length === 2,
        { count: events.length, types: events.map((e) => e.type) },
      );
      // No event type leaks safety state — extractor is content-agnostic.
      const types = new Set(events.map((e) => e.type));
      check(
        "safety: no event type carries safety semantics (extractor is content-agnostic)",
        !types.has("concern_voiced") && !types.has("blocker"),
        Array.from(types),
      );
    }

    // ---- idempotency: running the extractor twice on the same summary
    //      produces deep-equal output (same length, same notes, same types,
    //      same conversationId). Re-running must not duplicate events even
    //      when an episode.unresolved overlaps with summary.next_steps. ----
    {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture("advancement", { conversationId });
      const episode = {
        scoutEmail: summary.scoutEmail!,
        mode: "chat" as const,
        timestamp: ts,
        topics: ["Camping MB"],
        toolsUsed: [],
        questions: [],
        corrections: [],
        unresolved: [
          // Duplicate of summary.next_steps[1] — should dedupe, not double.
          "Schedule SM conference for First Class",
          "Bring tent stakes to Woodruff",
        ],
        engagement: "high" as const,
        summary: "Mapped Camping MB plan",
        turnCount: 14,
      };

      const first = extractEventsFromSummary(summary, episode, {
        conversationId,
        ts,
      });
      const second = extractEventsFromSummary(summary, episode, {
        conversationId,
        ts,
      });

      check(
        "idempotency: same length on second run",
        first.length === second.length,
        { first: first.length, second: second.length },
      );

      // Compare projections: ignore Date object identity (already same `ts`)
      // and the Mongo ObjectId instance (we passed the same `conversationId`).
      const project = (e: typeof first[number]) => ({
        type: e.type,
        note: e.note,
        confidence: e.confidence,
        payload: e.payload ?? null,
      });
      const firstP = first.map(project);
      const secondP = second.map(project);
      check(
        "idempotency: same projection on second run (type, note, confidence, payload)",
        JSON.stringify(firstP) === JSON.stringify(secondP),
        { first: firstP, second: secondP },
      );

      // The dedupe logic should keep `Schedule SM conference` to a single
      // event even with the duplicate showing up in episode.unresolved.
      const scheduleHits = first.filter((e) =>
        e.note.includes("Schedule SM conference"),
      );
      check(
        "idempotency: episode.unresolved duplicate stays deduped to 1",
        scheduleHits.length === 1,
        scheduleHits.map((e) => e.note),
      );
    }

    // ---- exhaustive: every fixture key extracts without throwing ----
    for (const key of FIXTURE_KEYS) {
      const conversationId = new ObjectId();
      const summary = buildSummaryFixture(key, { conversationId });
      let threw = false;
      try {
        extractEventsFromSummary(summary, null, { conversationId, ts });
      } catch {
        threw = true;
      }
      check(`fixture[${key}] does not throw`, !threw);
    }
  },
};
