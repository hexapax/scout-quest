/**
 * Stream H step 4: `safety_events` collection writer + lookups.
 *
 * Phase 1 footprint:
 *   - writeSafetyEvent: upsert keyed on (conversationId + ts) so re-runs
 *     don't duplicate
 *   - countRecentTier2InCategory / countRecentTier1InCategory30d: cheap
 *     reads for the tier-rule context
 *   - listRecentForAdmin: dashboard read
 *
 * No external notifications fire from this module — only the dashboard
 * "notification" entry is written (channel="dashboard",
 * recipientRole="admin"). Phase 2 will add an outbound notify path; Phase
 * 3 fans out to parents/scoutmasters.
 */

import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import type {
  RiskCategory,
  SafetyEvent,
  SafetyEventNotification,
} from "./types.js";

const COLLECTION = "safety_events";

interface WriteInput {
  scoutEmail: string;
  conversationId: ObjectId;
  ts: Date;
  tier: 1 | 2 | 3;
  riskVector: SafetyEvent["riskVector"];
  classifierVersion: string;
  suppressedReason?: string;
}

/**
 * Upsert a safety event keyed on (conversationId, ts). The classifier runs
 * once per turn so the (conv, ts) pair is unique enough — re-runs of the
 * same turn (e.g., a deploy that re-summarizes) overwrite rather than
 * duplicate.
 *
 * Also writes a single dashboard "notification" entry so the admin queue
 * reads cleanly. Phase 2 appends external-channel entries here.
 */
export async function writeSafetyEvent(input: WriteInput): Promise<ObjectId> {
  const db = getScoutQuestDb();
  const dashboardEntry: SafetyEventNotification = {
    channel: "dashboard",
    recipient: "admin",
    recipientRole: "admin",
    sentAt: new Date(),
  };

  // Body is the doc minus _id. Omitting _id lets MongoDB preserve the
  // existing _id on update (replaceOne errors out if you set a different
  // _id on a matched doc — "immutable field '_id'") and generate one on
  // insert.
  const body: Omit<SafetyEvent, "_id"> = {
    scoutEmail: input.scoutEmail,
    conversationId: input.conversationId,
    ts: input.ts,
    tier: input.tier,
    riskVector: input.riskVector,
    classifierVersion: input.classifierVersion,
    ...(input.suppressedReason ? { suppressedReason: input.suppressedReason } : {}),
    notifications: [dashboardEntry],
    caseClosed: false,
  };

  // Idempotency key: (conversationId, ts) — replaceOne with upsert.
  await db.collection<SafetyEvent>(COLLECTION).replaceOne(
    { conversationId: input.conversationId, ts: input.ts },
    body as SafetyEvent,
    { upsert: true },
  );

  const resolved = await db.collection<SafetyEvent>(COLLECTION).findOne(
    { conversationId: input.conversationId, ts: input.ts },
    { projection: { _id: 1 } },
  );
  if (!resolved?._id) throw new Error("safety event write succeeded but lookup returned no _id");
  return resolved._id;
}

/**
 * Count Tier 2 events for the same scout + category within the last 7 days.
 * Used by the dedupe rule in `assignTier`.
 */
export async function countRecentTier2InCategory(
  scoutEmail: string,
  category: RiskCategory,
  windowMs = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  if (category === "none") return 0;
  const db = getScoutQuestDb();
  const since = new Date(Date.now() - windowMs);
  return db.collection<SafetyEvent>(COLLECTION).countDocuments({
    scoutEmail,
    tier: 2,
    "riskVector.category": category,
    ts: { $gte: since },
  });
}

/**
 * Count Tier 1 events for the same scout + category within the last 30 days.
 * Used by the pattern-detection promotion rule.
 */
export async function countRecentTier1InCategory30d(
  scoutEmail: string,
  category: RiskCategory,
): Promise<number> {
  if (category === "none") return 0;
  const db = getScoutQuestDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return db.collection<SafetyEvent>(COLLECTION).countDocuments({
    scoutEmail,
    tier: 1,
    "riskVector.category": category,
    ts: { $gte: since },
  });
}

/** Dashboard read — most recent `limit` events, optionally filtered by tier. */
export async function listRecentForAdmin(opts: {
  limit?: number;
  tier?: 1 | 2 | 3;
  caseClosed?: boolean;
} = {}): Promise<SafetyEvent[]> {
  const db = getScoutQuestDb();
  const filter: Record<string, unknown> = {};
  if (opts.tier) filter.tier = opts.tier;
  if (typeof opts.caseClosed === "boolean") filter.caseClosed = opts.caseClosed;
  return db
    .collection<SafetyEvent>(COLLECTION)
    .find(filter)
    .sort({ ts: -1 })
    .limit(opts.limit ?? 50)
    .toArray();
}

/** Single event lookup — for admin review UI. */
export async function getSafetyEvent(id: ObjectId): Promise<SafetyEvent | null> {
  const db = getScoutQuestDb();
  return db.collection<SafetyEvent>(COLLECTION).findOne({ _id: id });
}
