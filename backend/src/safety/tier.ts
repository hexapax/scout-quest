/**
 * Stream H step 2: tier assignment + suppression rules.
 *
 * Pure function. No DB, no LLM. Takes a classifier `RiskVector` plus
 * `TierContext` (a small bundle of pre-fetched signals about prior events
 * and conversation framing) and returns a tier or null (= no event).
 *
 * Rule order matters — earlier rules win:
 *   1. Reject low-confidence / "none" outright.
 *   2. Apply suppression (academic framing, coach-primed quote) before tiering.
 *   3. Hard-tier rules from the design doc — abuse / inappropriate-adult /
 *      severe self-harm / mental-health-crisis severity 3 → Tier 3.
 *   4. Scout-initiated, severe → Tier 2.
 *   5. Pattern-detection promotion: ≥3 Tier 1 same-category in 30d → Tier 2.
 *   6. Tier 2 dedupe: existing Tier 2 same-category in 7d → downgrade to
 *      "Tier 1 update" and surface `suppressedReason`.
 *   7. Otherwise → Tier 1.
 *
 * Returns `{ tier, suppressedReason? }` or `null` if the rules drop the event.
 */

import type { RiskVector, SafetyTier, TierContext } from "./types.js";

export interface TierDecision {
  tier: SafetyTier;
  /** Set when a suppression rule downgraded what would otherwise have been
   *  a higher tier. Stored on `safety_events.suppressedReason`. */
  suppressedReason?: string;
}

const MIN_CONFIDENCE = 0.5;

export function assignTier(
  rv: RiskVector,
  ctx: TierContext,
): TierDecision | null {
  // 1. Reject low-confidence / "none"
  if (rv.category === "none" || rv.confidence < MIN_CONFIDENCE) return null;

  // 2. Suppression — these short-circuit to Tier 1 (or null) regardless of
  //    severity, because the *signal* is downgraded, not the topic.
  if (rv.initiator === "coach") {
    return { tier: 1, suppressedReason: "initiator=coach" };
  }
  if (rv.initiator === "external_quote") {
    return { tier: 1, suppressedReason: "initiator=external_quote" };
  }
  if (ctx.quoteIsFromCoachPrompt) {
    return { tier: 1, suppressedReason: "quote_matched_coach_prompt" };
  }
  if (ctx.isAcademicFraming) {
    return { tier: 1, suppressedReason: "academic_framing" };
  }

  // 3. Hard-tier rules — Tier 3 always wins regardless of dedupe.
  if (rv.category === "abuse_disclosure" && rv.initiator === "scout") {
    return { tier: 3 };
  }
  if (rv.category === "inappropriate_adult_contact" && rv.initiator === "scout") {
    return { tier: 3 };
  }
  if (rv.category === "self_harm" && rv.severity === 3) {
    return { tier: 3 };
  }
  if (rv.category === "mental_health_crisis" && rv.severity === 3) {
    return { tier: 3 };
  }

  // 4. Scout-initiated, severe but not crisis → candidate for Tier 2.
  let candidate: SafetyTier | null = null;
  if (rv.initiator === "scout" && rv.severity >= 2) candidate = 2;
  if (rv.initiator === "scout" && rv.severity === 1 && rv.confidence > 0.85) candidate = 2;

  // 5. Pattern-detection promotion — slow-burn Tier 1s become Tier 2.
  //    Cron-driven path also writes Tier 2 promotions; this branch covers the
  //    inline case where the threshold tips on the *current* event.
  if (!candidate && ctx.recentTier1SameCategory30d >= 2) {
    // recentTier1 is "events BEFORE this one"; current event would be the 3rd.
    return {
      tier: 2,
      suppressedReason: "pattern_promotion_3x_tier1_30d",
    };
  }

  // 6. Tier 2 dedupe — same category fired Tier 2 within 7d, don't re-fire.
  if (candidate === 2 && ctx.recentTier2SameCategory > 0) {
    return {
      tier: 1,
      suppressedReason: "dedup_recent_tier2_same_category_7d",
    };
  }

  if (candidate === 2) return { tier: 2 };

  // 7. Default — anything that survives is Tier 1.
  return { tier: 1 };
}
