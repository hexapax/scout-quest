/** BSA JWT token storage.
 * The BSA auth endpoint (my.scouting.org) returns 503 since March 2026.
 * Workaround: leader logs in via Chrome, bookmarklet/manual extraction
 * copies the JWT and stores it here via POST /bsa-token.
 *
 * Tokens expire ~60 minutes after login. We store with a 55-minute TTL.
 */

import { getScoutQuestDb } from "./db.js";

const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes
const COLLECTION = "bsa_tokens";

export interface BsaTokenDoc {
  token: string;
  leaderUserId: string;   // BSA userId of the leader who logged in (for approval attribution)
  storedAt: Date;
  expiresAt: Date;
  storedBy: string;       // "admin" or email of who stored it
}

/** Store a BSA JWT token. Overwrites any existing token. */
export async function storeBsaToken(
  token: string,
  leaderUserId: string,
  storedBy: string
): Promise<void> {
  const db = getScoutQuestDb();
  const now = new Date();
  const doc: BsaTokenDoc = {
    token,
    leaderUserId,
    storedAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    storedBy,
  };

  // Replace singleton token document
  await db.collection<BsaTokenDoc>(COLLECTION).replaceOne(
    {},
    doc,
    { upsert: true }
  );
}

/** Retrieve the current valid BSA token. Returns null if expired or not set. */
export async function getBsaToken(): Promise<BsaTokenDoc | null> {
  const db = getScoutQuestDb();
  const doc = await db.collection<BsaTokenDoc>(COLLECTION).findOne(
    { expiresAt: { $gt: new Date() } }
  );
  return doc ?? null;
}

/** How many minutes until token expiry. Returns 0 if expired/not set. */
export async function tokenMinutesRemaining(): Promise<number> {
  const token = await getBsaToken();
  if (!token) return 0;
  return Math.max(0, Math.round((token.expiresAt.getTime() - Date.now()) / 60000));
}
