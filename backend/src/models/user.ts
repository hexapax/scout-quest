/**
 * Read-only access to the AdminJS-owned `users` collection.
 *
 * The canonical schema lives in `admin/src/models/scout-quest/user.ts` (Mongoose).
 * This module exposes the same collection as a plain MongoDB driver handle so the
 * backend can consult it without pulling Mongoose in as a dependency.
 *
 * Contract: backend NEVER writes to `users`. Seeding is done via
 * `scripts/seed-admin-user.ts` and (future) `scripts/seed-alpha-users.ts`.
 * If that contract ever changes, update this comment and document the write paths.
 */

import type { Collection, Db } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import type { Role } from "../types.js";

/** Subset of user roles actually stored in the AdminJS schema's `roles[].type` enum. */
export type StoredRole = Exclude<Role, "leader" | "unknown">;

/**
 * One entry in the `users.roles[]` array. Matches the AdminJS Mongoose subschema.
 *
 * A single user doc can carry multiple role entries — e.g., a parent who is also
 * a troop leader has `[{ type: "parent", scout_emails: [...] }, { type: "admin", troop: "2024" }]`.
 * We don't promote `admin` to `leader` here; the role-lookup layer handles any
 * interpretation.
 */
export interface UserRoleEntry {
  type: StoredRole | "leader"; // allow "leader" for forward compat; see types.ts
  troop?: string;
  scout_emails?: string[];
  test_account?: boolean;
}

/**
 * Full user doc shape mirroring `admin/src/models/scout-quest/user.ts`.
 * Fields added by Mongoose timestamps are optional here — backend rarely needs them.
 */
export interface UserDoc {
  _id?: unknown;
  email: string;
  roles: UserRoleEntry[];
  created_at?: Date;
  updated_at?: Date;
}

const COLLECTION_NAME = "users";

/** Get the `users` collection handle. Throws if DB is not connected. */
export function getUsersCollection(db?: Db): Collection<UserDoc> {
  const database = db ?? getScoutQuestDb();
  return database.collection<UserDoc>(COLLECTION_NAME);
}

/**
 * Find a single user by email (case-insensitive).
 *
 * Returns `null` if no doc exists — callers must handle the allowlist / unknown
 * case themselves (see `auth/role-lookup.ts`).
 */
export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  if (!email) return null;
  const lower = email.toLowerCase();
  const coll = getUsersCollection();
  // AdminJS stores emails as entered — match case-insensitively to be safe.
  // Prefer an exact match (hits the schema-level `index: true`) then fall back.
  const exact = await coll.findOne({ email: lower });
  if (exact) return exact;
  return coll.findOne({ email: { $regex: `^${escapeRegex(lower)}$`, $options: "i" } });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
