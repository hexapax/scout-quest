/**
 * Role resolution for authenticated users.
 *
 * Given an email, returns the user's role info by consulting the `users`
 * MongoDB collection (seeded by the admin panel / seed scripts) with a
 * hardcoded allowlist fallback for bootstrap access.
 *
 * This is the single source of truth for "what role is this user?" in the
 * backend. Every request handler that needs to gate behavior by role MUST
 * go through `lookupUserRole` — do NOT re-implement email-based admin
 * checks anywhere else.
 *
 * Memoized with a 60-second TTL so steady-state chat traffic doesn't hit
 * MongoDB on every message. Call `clearRoleCache()` from tests or after
 * seeding a new user.
 */

import type { Role, UserRoleInfo } from "../types.js";
import { ROLE_PRIORITY } from "../types.js";
import { findUserByEmail, type UserDoc, type UserRoleEntry } from "../models/user.js";

/**
 * Bootstrap admin emails. Used when a user has no `users` doc.
 *
 * Kept intentionally small — only Jeremy's personal + hexapax emails, so the
 * project admin can access the system before the `users` collection is seeded.
 * All other admin/superuser access MUST come from a proper `users` doc.
 *
 * If a doc exists for an allowlist email, the doc's roles win (source: "db").
 */
export const ADMIN_ALLOWLIST: readonly string[] = [
  "jeremy@hexapax.com",
  "jebramwell@gmail.com",
];

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  info: UserRoleInfo;
  expiresAt: number;
}

const cache: Map<string, CacheEntry> = new Map();

/** Clear the role-lookup cache. Call after seeding/mutating user docs. */
export function clearRoleCache(email?: string): void {
  if (email) cache.delete(email.toLowerCase());
  else cache.clear();
}

/**
 * Resolve the role info for an email.
 *
 * Logic:
 *  1. Check in-memory cache (TTL {@link CACHE_TTL_MS}).
 *  2. Query `users` collection. If found → map to {@link UserRoleInfo} with source="db".
 *  3. If not found AND email is on the admin allowlist → synthesize a superuser
 *     record with source="allowlist".
 *  4. Otherwise → return an "unknown" record with source="none".
 *
 * Never throws — on DB errors, logs and returns the allowlist fallback (or "unknown").
 * That's deliberate: role lookup is on the hot path for every chat message and we
 * want to degrade gracefully rather than 500 the request.
 */
export async function lookupUserRole(emailInput: string): Promise<UserRoleInfo> {
  const email = (emailInput || "").toLowerCase().trim();
  if (!email) {
    return unknownInfo("");
  }

  const cached = cache.get(email);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  let info: UserRoleInfo;
  try {
    const doc = await findUserByEmail(email);
    if (doc) {
      info = fromUserDoc(email, doc);
    } else if (isAllowlisted(email)) {
      info = allowlistInfo(email);
    } else {
      info = unknownInfo(email);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "role_lookup_error",
        email,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // On DB error, still honor the allowlist so Jeremy isn't locked out during
    // a MongoDB blip. Everyone else gets "unknown" and is rejected downstream.
    info = isAllowlisted(email) ? allowlistInfo(email) : unknownInfo(email);
  }

  cache.set(email, { info, expiresAt: Date.now() + CACHE_TTL_MS });
  logLookup(info);
  return info;
}

/** True if the email is in the bootstrap admin allowlist. */
export function isAllowlisted(email: string): boolean {
  const lower = email.toLowerCase();
  return ADMIN_ALLOWLIST.some((a) => a.toLowerCase() === lower);
}

/** Map a Mongo `UserDoc` to the canonical {@link UserRoleInfo}. */
function fromUserDoc(email: string, doc: UserDoc): UserRoleInfo {
  const entries = Array.isArray(doc.roles) ? doc.roles : [];

  const roles = dedupe(
    entries
      .map((e) => normalizeStoredRole(e))
      .filter((r): r is Role => r !== null)
  );
  const role = pickPrimaryRole(roles);

  const troop = firstTruthy(entries.map((e) => e.troop));
  const scoutEmails = dedupe(
    entries.flatMap((e) => e.scout_emails || []).map((s) => s.toLowerCase())
  );

  return {
    email,
    role,
    roles,
    troop,
    scoutEmails,
    isAdmin: role === "admin" || role === "superuser",
    source: "db",
  };
}

function allowlistInfo(email: string): UserRoleInfo {
  return {
    email,
    role: "superuser",
    roles: ["superuser"],
    troop: "2024",
    scoutEmails: [],
    isAdmin: true,
    source: "allowlist",
  };
}

function unknownInfo(email: string): UserRoleInfo {
  return {
    email,
    role: "unknown",
    roles: [],
    troop: undefined,
    scoutEmails: [],
    isAdmin: false,
    source: "none",
  };
}

/**
 * Normalize a role entry from the DB to our canonical `Role` union.
 * Returns null for unrecognized values (defensive — AdminJS schema has an enum
 * but raw Mongo writes can bypass it).
 */
function normalizeStoredRole(entry: UserRoleEntry): Role | null {
  const valid: Role[] = [
    "superuser",
    "admin",
    "leader",
    "parent",
    "scout",
    "adult_readonly",
    "test_scout",
  ];
  if (!entry || typeof entry.type !== "string") return null;
  const t = entry.type as Role;
  return valid.includes(t) ? t : null;
}

/** Pick the highest-priority role from a list. Falls back to "unknown" if empty. */
export function pickPrimaryRole(roles: Role[]): Role {
  if (!roles.length) return "unknown";
  let best: Role = roles[0];
  for (const r of roles) {
    if (ROLE_PRIORITY[r] > ROLE_PRIORITY[best]) best = r;
  }
  return best;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function firstTruthy(arr: (string | undefined)[]): string | undefined {
  return arr.find((x) => typeof x === "string" && x.length > 0);
}

/** Structured log for alpha observability. */
function logLookup(info: UserRoleInfo): void {
  console.log(
    JSON.stringify({
      event: "role_lookup",
      email: info.email,
      role: info.role,
      roles: info.roles,
      source: info.source,
      troop: info.troop,
      scoutEmailsCount: info.scoutEmails.length,
    })
  );
}
