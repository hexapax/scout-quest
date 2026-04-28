/**
 * Conversation-summary sweeper — Stream G step 4 + 5 wire-up.
 *
 * Periodically finds conversations that have gone quiet but don't yet have
 * an up-to-date summary, then fires `captureConversationSummary` on each.
 * Runs in the backend process (no separate cron container needed).
 *
 * Idle window: a conversation is eligible when its `updatedAt` is older than
 * IDLE_MIN minutes — long enough that the user has clearly stepped away,
 * short enough that summaries land while the session is still relevant to
 * parents/leaders.
 *
 * "Up-to-date" means a `conversation_summaries` doc exists with `_id` matching
 * the conversation's `_id` AND `generated_at >= updatedAt`. Re-running on a
 * conversation that has gained new messages since its last summary will
 * regenerate (the writer upserts, so the prior summary is replaced).
 *
 * Cost guard: per-run cap (default 25) so a backlog never produces a single
 * Haiku spike. Backlog drains over multiple sweep cycles.
 */

import { ObjectId, type Document } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import { captureConversationSummary } from "../conversation-summary.js";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const IDLE_MIN = 30; // conversations idle ≥ 30 minutes are eligible
const PER_RUN_CAP = 25; // max conversations summarized per sweep

let sweeperHandle: NodeJS.Timeout | null = null;

interface ConversationDoc {
  _id: ObjectId;
  userEmail: string;
  scoutEmail?: string | null;
  troopId?: string | null;
  channel?: "chat" | "voice" | "mixed";
  messages: Array<{ role: string; content: string }>;
  createdAt: Date;
  updatedAt: Date;
}

interface SummaryStub {
  _id: ObjectId;
  generated_at: Date;
}

export async function runSummarySweep(): Promise<{
  scanned: number;
  captured: number;
  skipped: number;
}> {
  const db = getScoutQuestDb();
  const conversations = db.collection<ConversationDoc>("conversations");
  const summaries = db.collection<SummaryStub>("conversation_summaries");

  const idleBefore = new Date(Date.now() - IDLE_MIN * 60 * 1000);

  // Candidates: conversations that have been idle long enough and have
  // enough turns to produce a useful summary. We over-fetch here and
  // filter against the summaries collection in JS — a $lookup-based query
  // would be cleaner but our deployment's Mongo plugin doesn't always have
  // an index on conversation_summaries that supports a left join cheaply.
  const candidates = await conversations
    .find({ updatedAt: { $lt: idleBefore } })
    .sort({ updatedAt: -1 })
    .limit(PER_RUN_CAP * 4)
    .toArray();

  let scanned = 0;
  let captured = 0;
  let skipped = 0;

  for (const conv of candidates) {
    if (captured >= PER_RUN_CAP) break;
    scanned++;

    const userMsgs = (conv.messages || []).filter((m) => m.role === "user");
    if (userMsgs.length < 2) {
      skipped++;
      continue;
    }

    const existing = await summaries.findOne(
      { _id: conv._id },
      { projection: { generated_at: 1 } as Document },
    );
    if (existing && existing.generated_at >= conv.updatedAt) {
      skipped++;
      continue;
    }

    captureConversationSummary({
      conversationId: conv._id,
      scoutEmail: conv.scoutEmail ?? null,
      userEmail: conv.userEmail,
      troopId: conv.troopId ?? null,
      channel: conv.channel ?? "chat",
      messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
      startedAt: conv.createdAt,
      endedAt: conv.updatedAt,
    });
    captured++;
  }

  if (captured > 0 || scanned > 0) {
    console.log(
      `[summary-sweep] scanned=${scanned} captured=${captured} skipped=${skipped}` +
        ` (idle≥${IDLE_MIN}m, cap=${PER_RUN_CAP})`,
    );
  }

  return { scanned, captured, skipped };
}

/** Start the periodic sweeper. Idempotent — calling twice is a no-op. */
export function startSummarySweeper(): void {
  if (sweeperHandle) return;
  // First sweep on a short delay so backend startup isn't blocked, then
  // every SWEEP_INTERVAL_MS thereafter.
  setTimeout(() => {
    runSummarySweep().catch((err) =>
      console.error("[summary-sweep] error:", err instanceof Error ? err.message : err),
    );
  }, 60 * 1000);
  sweeperHandle = setInterval(() => {
    runSummarySweep().catch((err) =>
      console.error("[summary-sweep] error:", err instanceof Error ? err.message : err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(`[summary-sweep] started (every ${SWEEP_INTERVAL_MS / 60000}m, idle≥${IDLE_MIN}m, cap=${PER_RUN_CAP})`);
}

/** Stop the sweeper. Used by tests. */
export function stopSummarySweeper(): void {
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
  }
}
