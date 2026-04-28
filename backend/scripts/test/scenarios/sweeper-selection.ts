/**
 * sweeper-selection: the summary sweeper picks exactly the right candidates.
 *
 * Tests the candidate selection logic without needing Anthropic — relies on
 * the {scanned, captured, skipped} counters returned by runSummarySweep.
 * The actual Haiku call inside captureConversationSummary is fire-and-forget
 * and will fail silently if no API key is available; that's fine for this test.
 *
 * Cases covered:
 *   A. idle conv with ≥ 2 user msgs, no summary       → captured
 *   B. idle conv with ≥ 2 user msgs, summary stale    → captured
 *   C. idle conv with ≥ 2 user msgs, summary fresh    → skipped
 *   D. idle conv with < 2 user msgs                   → skipped
 *   E. fresh conv (idle < 30 min)                     → not even scanned
 */

import type { Scenario } from "../lib/scenario.js";

function ago(min: number): Date {
  return new Date(Date.now() - min * 60 * 1000);
}

export const scenario: Scenario = {
  name: "sweeper-selection",
  description: "runSummarySweep picks exactly the right candidates by idle/turn-count/freshness",

  async seed(_ctx) {
    const { getScoutQuestDb } = await import("../../../src/db.js");
    const { ObjectId } = await import("mongodb");
    const db = getScoutQuestDb();

    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const d = new ObjectId();
    const e = new ObjectId();

    // Two user messages, idle 60 min, no summary → CAPTURE
    await db.collection("conversations").insertOne({
      _id: a,
      userEmail: "alice@test.example",
      scoutEmail: "alice@test.example",
      troopId: "9999",
      channel: "chat",
      messages: [
        { role: "user", content: "first turn", ts: ago(70) },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second turn", ts: ago(60) },
      ],
      createdAt: ago(70),
      updatedAt: ago(60),
    });

    // Two user messages, idle 60 min, stale summary → CAPTURE
    await db.collection("conversations").insertOne({
      _id: b,
      userEmail: "bob@test.example",
      scoutEmail: "bob@test.example",
      troopId: "9999",
      channel: "chat",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
      createdAt: ago(120),
      updatedAt: ago(60),
    });
    await db.collection("conversation_summaries").insertOne({
      _id: b,
      scoutEmail: "bob@test.example",
      userEmail: "bob@test.example",
      channel: "chat",
      durationMs: 0,
      turnCount: 2,
      one_liner: "stale summary",
      parent_recap: "",
      scout_recap: "",
      topics: [],
      achievements: [],
      next_steps: [],
      blockers: [],
      generated_at: ago(120), // older than conversations.updatedAt
      generated_by_model: "test",
    });

    // Two user messages, idle 60 min, fresh summary → SKIP
    await db.collection("conversations").insertOne({
      _id: c,
      userEmail: "carol@test.example",
      scoutEmail: "carol@test.example",
      troopId: "9999",
      channel: "chat",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
      createdAt: ago(120),
      updatedAt: ago(60),
    });
    await db.collection("conversation_summaries").insertOne({
      _id: c,
      scoutEmail: "carol@test.example",
      userEmail: "carol@test.example",
      channel: "chat",
      durationMs: 0,
      turnCount: 2,
      one_liner: "fresh summary",
      parent_recap: "",
      scout_recap: "",
      topics: [],
      achievements: [],
      next_steps: [],
      blockers: [],
      generated_at: ago(30), // newer than updatedAt
      generated_by_model: "test",
    });

    // One user message, idle 60 min → SKIP (too short)
    await db.collection("conversations").insertOne({
      _id: d,
      userEmail: "dan@test.example",
      scoutEmail: "dan@test.example",
      troopId: "9999",
      channel: "chat",
      messages: [
        { role: "user", content: "only one user msg" },
        { role: "assistant", content: "ok" },
      ],
      createdAt: ago(120),
      updatedAt: ago(60),
    });

    // Two user messages, fresh (idle < 30m) → NOT SCANNED
    await db.collection("conversations").insertOne({
      _id: e,
      userEmail: "eve@test.example",
      scoutEmail: "eve@test.example",
      troopId: "9999",
      channel: "chat",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
      createdAt: ago(20),
      updatedAt: ago(5),
    });
  },

  async run({ check }) {
    const { runSummarySweep } = await import("../../../src/cron/summary-sweeper.js");
    const sweep = await runSummarySweep();

    check(
      "captured exactly 2 (no-summary + stale-summary)",
      sweep.captured === 2,
      sweep,
    );
    // scanned counts every idle candidate the sweeper inspected — that's A, B, C, D.
    check(
      "scanned exactly 4 idle candidates (excludes the fresh conv)",
      sweep.scanned === 4,
      sweep,
    );
    check(
      "skipped exactly 2 (fresh-summary + short conv)",
      sweep.skipped === 2,
      sweep,
    );
  },
};
