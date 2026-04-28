/**
 * episode-roundtrip: episodes seeded for a scout flow back through
 * getRecentEpisodes in the right order with the right shape.
 *
 * This is what powers the "PRIOR SESSIONS" block injected into chat.ts —
 * if it breaks, scouts get cold-started even when their history exists.
 */

import type { Scenario } from "../lib/scenario.js";

const SCOUT_EMAIL = "liam@test.example";

export const scenario: Scenario = {
  name: "episode-roundtrip",
  description: "Seeded episodes appear in getRecentEpisodes ordered newest-first",

  async seed(_ctx) {
    const { getScoutQuestDb } = await import("../../../src/db.js");
    const db = getScoutQuestDb();
    await db.collection("scout_episodes").insertMany([
      {
        scoutEmail: SCOUT_EMAIL,
        mode: "chat",
        timestamp: new Date("2026-04-22T18:30Z"),
        topics: ["Camping MB", "First Class req 5b"],
        toolsUsed: ["get_scout_status"],
        questions: ["Who can be my MB counselor?"],
        corrections: [],
        unresolved: ["Schedule SM conference"],
        engagement: "high",
        summary: "Mapped Camping MB plan; wants Mr. Brunt as counselor.",
        turnCount: 12,
      },
      {
        scoutEmail: SCOUT_EMAIL,
        mode: "voice",
        timestamp: new Date("2026-04-25T14:10Z"),
        topics: ["Camping MB req 4"],
        toolsUsed: [],
        questions: [],
        corrections: [],
        unresolved: [],
        engagement: "medium",
        summary: "Reviewed camping gear list; req 4 essentially done.",
        turnCount: 6,
      },
      {
        scoutEmail: SCOUT_EMAIL,
        mode: "chat",
        timestamp: new Date("2026-04-26T20:00Z"),
        topics: ["Woodruff prep"],
        toolsUsed: [],
        questions: [],
        corrections: [],
        unresolved: ["Bring tent stakes"],
        engagement: "high",
        summary: "Talked through Woodruff packing; needs to confirm stakes.",
        turnCount: 8,
      },
      // Different scout — must NOT show up in liam's results.
      {
        scoutEmail: "ben@test.example",
        mode: "chat",
        timestamp: new Date("2026-04-26T21:00Z"),
        topics: ["different scout topic"],
        toolsUsed: [],
        questions: [],
        corrections: [],
        unresolved: [],
        engagement: "high",
        summary: "Different scout — should not leak.",
        turnCount: 4,
      },
    ]);
  },

  async run({ check }) {
    const { getRecentEpisodes } = await import("../../../src/episodes.js");

    const eps = await getRecentEpisodes(SCOUT_EMAIL);
    check("returns 3 episodes for liam", eps.length === 3, { count: eps.length });

    if (eps.length === 3) {
      check(
        "newest first (Woodruff prep on top)",
        eps[0].topics[0] === "Woodruff prep",
        eps.map((e) => e.topics),
      );
      check("middle is the voice session", eps[1].mode === "voice", eps[1]);
      check(
        "no leakage from other scout",
        eps.every((e) => e.scoutEmail === SCOUT_EMAIL),
        eps.map((e) => e.scoutEmail),
      );
      check(
        "unresolved tracked through round-trip",
        eps[0].unresolved.includes("Bring tent stakes"),
        eps[0].unresolved,
      );
    }

    const limited = await getRecentEpisodes(SCOUT_EMAIL, 2);
    check("limit respected", limited.length === 2, { got: limited.length });
  },
};
