const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  console.warn("WARNING: ADMIN_EMAILS is empty — no one can log in");
}

/**
 * AdminJS authenticate function.
 * AdminJS v7 with @adminjs/express shows a login form by default.
 * We'll use a custom approach: redirect to Google OAuth,
 * then validate the returned email against the allowlist.
 */
export function isAllowedAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * For AdminJS buildAuthenticatedRouter — called with form email/password.
 * Since we want OAuth, we'll handle auth differently in the main app.
 * This is a placeholder that always rejects form logins.
 */
export async function authenticate(email: string, password: string): Promise<Record<string, unknown> | null> {
  // Form-based login is not used — we use Google OAuth
  // Return null to reject form login attempts
  return null;
}
