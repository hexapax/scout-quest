/**
 * safety-event-roundtrip: write + read + dedupe-context counts on the
 * `safety_events` collection.
 *
 * Validates:
 *   - writeSafetyEvent persists with the expected shape (tier, riskVector,
 *     classifierVersion, dashboard notification entry, caseClosed=false)
 *   - re-running with the same (conversationId, ts) is idempotent (upsert)
 *   - countRecentTier2InCategory and countRecentTier1InCategory30d return
 *     the right counts for tier-rule context
 *   - listRecentForAdmin returns the most-recent event first
 */

import type { Scenario } from "../lib/scenario.js";

export const scenario: Scenario = {
  name: "safety-event-roundtrip",
  description: "safety_events writer + readers behave as the tier rules expect",

  async seed() {
    /* nothing — every test seeds inline */
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const {
      writeSafetyEvent,
      countRecentTier1InCategory30d,
      countRecentTier2InCategory,
      listRecentForAdmin,
      getSafetyEvent,
    } = await import("../../../src/safety/store.js");

    const scoutEmail = "liam@test.example";
    const conversationId = new ObjectId();
    const ts = new Date("2026-04-29T15:00:00Z");

    const id = await writeSafetyEvent({
      scoutEmail,
      conversationId,
      ts,
      tier: 2,
      riskVector: {
        category: "bullying",
        severity: 2,
        confidence: 0.8,
        initiator: "scout",
        quote: "they keep teasing me",
      },
      classifierVersion: "test/v1",
    });
    check("writeSafetyEvent returns an ObjectId", !!id);

    const fetched = await getSafetyEvent(id);
    check("event readable by id", !!fetched, fetched ? Object.keys(fetched) : null);
    check("tier = 2", fetched?.tier === 2, fetched?.tier);
    check("riskVector preserved", fetched?.riskVector?.category === "bullying", fetched?.riskVector);
    check("classifierVersion preserved", fetched?.classifierVersion === "test/v1");
    check("caseClosed defaults false", fetched?.caseClosed === false);
    check(
      "dashboard notification entry written",
      Array.isArray(fetched?.notifications) &&
        fetched!.notifications.length === 1 &&
        fetched!.notifications[0].channel === "dashboard" &&
        fetched!.notifications[0].recipientRole === "admin",
      fetched?.notifications,
    );

    // Idempotency: re-write same (conversationId, ts) — should NOT duplicate.
    await writeSafetyEvent({
      scoutEmail,
      conversationId,
      ts,
      tier: 2,
      riskVector: {
        category: "bullying",
        severity: 2,
        confidence: 0.85,
        initiator: "scout",
        quote: "different quote",
      },
      classifierVersion: "test/v1",
    });
    const after = await listRecentForAdmin({ tier: 2 });
    check(
      "idempotency: re-write does not duplicate (still 1 Tier 2 event)",
      after.length === 1,
      { count: after.length, ids: after.map((e) => String(e._id)) },
    );

    // Counts for the tier-rule context — Tier 2 same category should be 1.
    const t2Count = await countRecentTier2InCategory(scoutEmail, "bullying");
    check("countRecentTier2InCategory(bullying) = 1", t2Count === 1, t2Count);

    // Different category → 0.
    const t2Other = await countRecentTier2InCategory(scoutEmail, "self_harm");
    check("countRecentTier2InCategory(self_harm) = 0", t2Other === 0, t2Other);

    // Add three Tier 1s in family_conflict to test the 30d count.
    for (let i = 0; i < 3; i++) {
      await writeSafetyEvent({
        scoutEmail,
        conversationId: new ObjectId(),
        ts: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000), // 1, 2, 3 days ago
        tier: 1,
        riskVector: {
          category: "family_conflict",
          severity: 1,
          confidence: 0.7,
          initiator: "scout",
          quote: `event ${i}`,
        },
        classifierVersion: "test/v1",
      });
    }
    const t1Count = await countRecentTier1InCategory30d(scoutEmail, "family_conflict");
    check("countRecentTier1InCategory30d(family_conflict) = 3", t1Count === 3, t1Count);

    // Old event (40d ago) doesn't count.
    await writeSafetyEvent({
      scoutEmail,
      conversationId: new ObjectId(),
      ts: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      tier: 1,
      riskVector: {
        category: "family_conflict",
        severity: 1,
        confidence: 0.7,
        initiator: "scout",
        quote: "old",
      },
      classifierVersion: "test/v1",
    });
    const t1CountAfterOld = await countRecentTier1InCategory30d(scoutEmail, "family_conflict");
    check(
      "events older than 30d don't count toward Tier 1 30d window",
      t1CountAfterOld === 3,
      t1CountAfterOld,
    );

    // listRecentForAdmin sorts by ts desc.
    const recent = await listRecentForAdmin({ limit: 10 });
    const sortedDesc = recent.every(
      (e, i) => i === 0 || recent[i - 1].ts.getTime() >= e.ts.getTime(),
    );
    check("listRecentForAdmin is sorted ts desc", sortedDesc, recent.map((e) => e.ts.toISOString()));

    // Tier filter works.
    const onlyT1 = await listRecentForAdmin({ tier: 1 });
    check(
      "listRecentForAdmin tier=1 returns only Tier 1 events",
      onlyT1.every((e) => e.tier === 1),
      onlyT1.map((e) => e.tier),
    );
  },
};
