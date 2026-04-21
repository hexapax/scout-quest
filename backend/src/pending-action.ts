/** Pending action system.
 * The AI agent creates a pending action (e.g., draft email, requirement sign-off)
 * and returns a link to the user. The user reviews and approves via a micro-app.
 */

import { ObjectId, type WithId } from "mongodb";
import { getScoutQuestDb } from "./db.js";

const COLLECTION = "pending_actions";
const DEFAULT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export type ActionType = "send_email" | "advance_requirement" | "rsvp_event";
export type ActionStatus = "pending" | "executed" | "cancelled" | "expired";

export interface PendingActionDoc {
  type: ActionType;
  payload: Record<string, unknown>;
  status: ActionStatus;
  createdBy: string;       // email of user who triggered
  scoutUserId?: string;    // BSA userId if applicable
  createdAt: Date;
  expiresAt: Date;
  executedAt?: Date;
  cancelledAt?: Date;
  result?: unknown;
}

/** Create a pending action. Returns the action ID (URL-safe). */
export async function createPendingAction(
  type: ActionType,
  payload: Record<string, unknown>,
  createdBy: string,
  scoutUserId?: string,
  expiryMs?: number,
): Promise<string> {
  const db = getScoutQuestDb();
  const now = new Date();
  const doc: PendingActionDoc = {
    type,
    payload,
    status: "pending",
    createdBy,
    scoutUserId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + (expiryMs ?? DEFAULT_EXPIRY_MS)),
  };
  const result = await db.collection<PendingActionDoc>(COLLECTION).insertOne(doc);
  return result.insertedId.toHexString();
}

/** Get a pending action by ID. Returns null if not found or expired. */
export async function getPendingAction(
  id: string
): Promise<WithId<PendingActionDoc> | null> {
  const db = getScoutQuestDb();
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }
  const doc = await db.collection<PendingActionDoc>(COLLECTION).findOne({ _id: objectId });
  if (!doc) return null;

  // Auto-expire
  if (doc.status === "pending" && doc.expiresAt < new Date()) {
    await db.collection<PendingActionDoc>(COLLECTION).updateOne(
      { _id: objectId },
      { $set: { status: "expired" } }
    );
    return { ...doc, status: "expired" };
  }
  return doc;
}

/** Execute a pending action. Returns the updated doc. */
export async function executePendingAction(
  id: string,
  updatedPayload?: Record<string, unknown>,
): Promise<WithId<PendingActionDoc> | null> {
  const db = getScoutQuestDb();
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }

  const now = new Date();
  const update: Record<string, unknown> = {
    status: "executed",
    executedAt: now,
  };
  if (updatedPayload) {
    update.payload = updatedPayload;
  }

  const result = await db.collection<PendingActionDoc>(COLLECTION).findOneAndUpdate(
    { _id: objectId, status: "pending", expiresAt: { $gt: now } },
    { $set: update },
    { returnDocument: "after" }
  );
  return result ?? null;
}

/** List pending actions matching a filter. Results sorted newest-first,
 *  capped at `limit`. Auto-marks expired docs as "expired" as a side effect
 *  so the inbox doesn't show stale rows. */
export async function listPendingActions(
  filter: Record<string, unknown>,
  limit = 50,
): Promise<WithId<PendingActionDoc>[]> {
  const db = getScoutQuestDb();
  const now = new Date();
  // Sweep expired: any pending action past expiresAt is transitioned before
  // we read, so the returned list reflects current truth.
  await db.collection<PendingActionDoc>(COLLECTION).updateMany(
    { status: "pending", expiresAt: { $lt: now } },
    { $set: { status: "expired" } },
  );
  return db
    .collection<PendingActionDoc>(COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Cancel a pending action. */
export async function cancelPendingAction(
  id: string
): Promise<WithId<PendingActionDoc> | null> {
  const db = getScoutQuestDb();
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }

  const result = await db.collection<PendingActionDoc>(COLLECTION).findOneAndUpdate(
    { _id: objectId, status: "pending" },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
    { returnDocument: "after" }
  );
  return result ?? null;
}
