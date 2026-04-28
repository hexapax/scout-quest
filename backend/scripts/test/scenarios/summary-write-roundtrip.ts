/**
 * summary-write-roundtrip: writeConversationSummary upserts correctly and
 * reads come back through getConversationSummary / getRecentSummariesForScout.
 *
 * Tests the storage layer in isolation — no Anthropic call, just direct
 * writes through the same module callers use after generation.
 */

import type { Scenario } from "../lib/scenario.js";

const SCOUT_EMAIL = "liam@test.example";

export const scenario: Scenario = {
  name: "summary-write-roundtrip",
  description: "writeConversationSummary is idempotent; readers return what was written",

  async seed(_ctx) {
    // Nothing — scenario writes via the public module.
  },

  async run({ check }) {
    const { ObjectId } = await import("mongodb");
    const {
      writeConversationSummary,
      getConversationSummary,
      getRecentSummariesForScout,
    } = await import("../../../src/conversation-summary.js");

    const id = new ObjectId();

    const v1 = {
      _id: id,
      scoutEmail: SCOUT_EMAIL,
      userEmail: SCOUT_EMAIL,
      troopId: "9999",
      channel: "chat" as const,
      durationMs: 12_000,
      turnCount: 8,
      one_liner: "First version",
      parent_recap: "Liam talked about X.",
      scout_recap: "Nice work today on X!",
      topics: ["topic-a"],
      achievements: ["a1"],
      next_steps: ["n1"],
      blockers: [],
      generated_at: new Date("2026-04-26T12:00Z"),
      generated_by_model: "test-haiku",
    };

    await writeConversationSummary(v1);
    const got1 = await getConversationSummary(id);
    check("read after first write", got1?.one_liner === "First version", got1);

    // Second write with same _id but different content → upsert.
    const v2 = { ...v1, one_liner: "Second version", topics: ["topic-b"], generated_at: new Date() };
    await writeConversationSummary(v2);
    const got2 = await getConversationSummary(id);
    check("upsert overwrote one_liner", got2?.one_liner === "Second version", got2);
    check("upsert overwrote topics", got2?.topics[0] === "topic-b", got2?.topics);

    // Recent-by-scout lookup.
    const list = await getRecentSummariesForScout(SCOUT_EMAIL);
    check("getRecentSummariesForScout finds the doc", list.length === 1, list);
    check("list returns the latest version", list[0]?.one_liner === "Second version", list[0]);

    // Other scout — should not see liam's summary.
    const other = await getRecentSummariesForScout("ben@test.example");
    check("other scout sees nothing", other.length === 0, other);
  },
};
