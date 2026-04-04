/** Gmail-style email normalization.
 *
 * For @gmail.com addresses:
 *   - Lowercase
 *   - Strip dots from local part
 *   - Strip +suffix from local part
 *
 * For all other domains:
 *   - Lowercase only (dots and +suffix are significant)
 */

export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const atIdx = lower.indexOf("@");
  if (atIdx === -1) return lower;

  let local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    // Strip +suffix
    const plusIdx = local.indexOf("+");
    if (plusIdx !== -1) local = local.slice(0, plusIdx);
    // Strip dots
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

/** Build a MongoDB regex that matches all Gmail variants of an email.
 *  For gmail.com: dots optional anywhere in local part, case-insensitive.
 *  For other domains: just case-insensitive exact match.
 */
export function emailMatchRegex(email: string): RegExp {
  const normalized = normalizeEmail(email);
  const atIdx = normalized.indexOf("@");
  if (atIdx === -1) return new RegExp(`^${escRegex(normalized)}$`, "i");

  const local = normalized.slice(0, atIdx);
  const domain = normalized.slice(atIdx + 1);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    // Allow optional dots between each character of the local part
    const dotOptional = local.split("").join("\\.?");
    // Also match with +suffix
    return new RegExp(`^${dotOptional}(\\+[^@]*)?@(gmail\\.com|googlemail\\.com)$`, "i");
  }

  return new RegExp(`^${escRegex(normalized)}$`, "i");
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
