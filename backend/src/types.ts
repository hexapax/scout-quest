// OpenAI API types (subset used by LibreChat → backend requests)

/**
 * User role model — mirrors the AdminJS `users` collection role enum.
 *
 * Source of truth: `admin/src/models/scout-quest/user.ts`.
 * The backend reads the same `users` collection via `backend/src/auth/role-lookup.ts`.
 *
 * Added roles beyond the AdminJS enum:
 * - "leader" — adults with write access (guide + write tools). Not yet in AdminJS enum.
 *   Adding it here first; AdminJS schema will be updated in Stream F onboarding work.
 * - "unknown" — email has no user doc and is not in the admin allowlist. Hard-fail
 *   for tool use; caller decides whether to reject entirely.
 *
 * Priority ordering (highest first) — used to pick a singular `role` when a
 * user has multiple roles (e.g., parent AND leader):
 *   superuser > admin > leader > parent > scout > adult_readonly > test_scout > unknown
 */
export type Role =
  | "superuser"
  | "admin"
  | "leader"
  | "parent"
  | "scout"
  | "adult_readonly"
  | "test_scout"
  | "unknown";

export const ROLE_PRIORITY: Record<Role, number> = {
  superuser: 100,
  admin: 90,
  leader: 80,
  parent: 70,
  scout: 60,
  adult_readonly: 50,
  test_scout: 40,
  unknown: 0,
};

/**
 * Shape returned by `lookupUserRole` and stored on the enriched `AppUser`.
 *
 * This interface is the canonical contract other streams (B: history viewers,
 * C: cost logging, E: role-aware UI) code against. Do not change the shape
 * after it ships — extend with new optional fields only.
 */
export interface UserRoleInfo {
  /** Lowercased email. */
  email: string;
  /** Highest-priority role (singular). */
  role: Role;
  /** Full set of roles from the user doc (may be one or many). */
  roles: Role[];
  /** Troop identifier from the first role entry that has one. */
  troop?: string;
  /** For parents: their scouts' emails. For scouts/leaders: empty. */
  scoutEmails: string[];
  /** Derived: true when role is "admin" or "superuser". */
  isAdmin: boolean;
  /** Where the record came from — lets callers know whether the user is seeded. */
  source: "db" | "allowlist" | "none";
}

/**
 * Authenticated user on a request — JWT payload plus enriched role info.
 *
 * The JWT only stores `email`, `name`, `picture` (see `routes/auth.ts`);
 * role fields are re-resolved from MongoDB (via memoized `lookupUserRole`)
 * on each `/auth/me` call so role changes take effect without re-login.
 */
export interface AppUser {
  email: string;
  name: string;
  picture?: string;
  /** Highest-priority role. "unknown" if the user is not seeded and not on the allowlist. */
  role: Role;
  /** Full role list from the user doc. */
  roles: Role[];
  /** Troop identifier. */
  troop?: string;
  /** For parents: scouts whose chat history they can see. */
  scoutEmails: string[];
  /** Derived helper: `role === "admin" || role === "superuser"`. */
  isAdmin: boolean;
}

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  // ElevenLabs Conversational AI fields
  user_id?: string;
  elevenlabs_extra_body?: Record<string, unknown>;
}

// Anthropic API types (subset)
// Note: AnthropicSystemBlock doubles as the canonical SystemBlock type.
// Non-Anthropic providers ignore cache_control.

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** Canonical system block type — alias for AnthropicSystemBlock. */
export type SystemBlock = AnthropicSystemBlock;

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicTextBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  stream?: boolean;
  temperature?: number;
}
