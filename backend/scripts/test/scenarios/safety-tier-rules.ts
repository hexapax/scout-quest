/**
 * safety-tier-rules: Stream H step 2 unit coverage.
 *
 * Pure-function tests on `assignTier` covering:
 *   - low-confidence + "none" rejection
 *   - hard-rule Tier 3 cases (abuse, inappropriate adult, severe self-harm,
 *     severe mental-health crisis)
 *   - scout-initiated severity 2/3 → Tier 2
 *   - scout-initiated severity 1, high confidence → Tier 2
 *   - suppression: coach-initiated, external_quote, coach-prompt match,
 *     academic framing — all downgrade with suppressedReason
 *   - dedupe: existing recent Tier 2 same category → downgrade with reason
 *   - pattern promotion: 2 prior Tier 1s in 30d → current is promoted to 2
 *   - Tier 3 always wins over dedupe (urgent never gets suppressed)
 */

import type { Scenario } from "../lib/scenario.js";

export const scenario: Scenario = {
  name: "safety-tier-rules",
  description: "assignTier maps RiskVector + TierContext to the right tier",

  async seed() {
    /* pure unit test */
  },

  async run({ check }) {
    const { assignTier } = await import("../../../src/safety/tier.js");

    const baseCtx = {
      recentTier2SameCategory: 0,
      recentTier1SameCategory30d: 0,
      quoteIsFromCoachPrompt: false,
      isAcademicFraming: false,
    };

    // 1. Reject "none" / low-confidence
    {
      const result = assignTier(
        { category: "none", severity: 1, confidence: 1.0, initiator: "scout", quote: "" },
        baseCtx,
      );
      check("category=none returns null", result === null, result);
    }
    {
      const result = assignTier(
        { category: "bullying", severity: 2, confidence: 0.4, initiator: "scout", quote: "" },
        baseCtx,
      );
      check("confidence < 0.5 returns null", result === null, result);
    }

    // 2. Hard Tier 3 — abuse disclosure (scout-initiated)
    {
      const result = assignTier(
        { category: "abuse_disclosure", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("abuse_disclosure scout-initiated → Tier 3", result?.tier === 3, result);
    }
    // Hard Tier 3 — inappropriate adult contact
    {
      const result = assignTier(
        { category: "inappropriate_adult_contact", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("inappropriate_adult_contact → Tier 3", result?.tier === 3, result);
    }
    // Hard Tier 3 — severe self-harm
    {
      const result = assignTier(
        { category: "self_harm", severity: 3, confidence: 0.8, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("self_harm severity=3 → Tier 3", result?.tier === 3, result);
    }
    // Hard Tier 3 — severe mental-health crisis
    {
      const result = assignTier(
        { category: "mental_health_crisis", severity: 3, confidence: 0.7, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("mental_health_crisis severity=3 → Tier 3", result?.tier === 3, result);
    }

    // 3. Scout-initiated severity 2 (non-hard) → Tier 2
    {
      const result = assignTier(
        { category: "bullying", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("scout severity 2 bullying → Tier 2", result?.tier === 2 && !result.suppressedReason, result);
    }
    // Scout severity 1 with confidence > 0.85 → Tier 2
    {
      const result = assignTier(
        { category: "family_conflict", severity: 1, confidence: 0.9, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("scout severity 1 confidence>0.85 → Tier 2", result?.tier === 2, result);
    }
    // Scout severity 1 confidence 0.7 → Tier 1
    {
      const result = assignTier(
        { category: "family_conflict", severity: 1, confidence: 0.7, initiator: "scout", quote: "x" },
        baseCtx,
      );
      check("scout severity 1 confidence=0.7 → Tier 1", result?.tier === 1 && !result.suppressedReason, result);
    }

    // 4. Suppression — coach-initiated downgrades to Tier 1 with reason
    {
      const result = assignTier(
        { category: "self_harm", severity: 3, confidence: 0.9, initiator: "coach", quote: "x" },
        baseCtx,
      );
      check(
        "coach-initiated severity 3 self-harm → Tier 1 + reason (suppression beats hard rule)",
        result?.tier === 1 && result?.suppressedReason === "initiator=coach",
        result,
      );
    }
    {
      const result = assignTier(
        { category: "bullying", severity: 2, confidence: 0.7, initiator: "external_quote", quote: "x" },
        baseCtx,
      );
      check(
        "external_quote → Tier 1 + reason",
        result?.tier === 1 && result?.suppressedReason === "initiator=external_quote",
        result,
      );
    }
    {
      const result = assignTier(
        { category: "bullying", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, quoteIsFromCoachPrompt: true },
      );
      check(
        "quoteIsFromCoachPrompt → Tier 1 + reason",
        result?.tier === 1 && result?.suppressedReason === "quote_matched_coach_prompt",
        result,
      );
    }
    {
      const result = assignTier(
        { category: "substance_use", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, isAcademicFraming: true },
      );
      check(
        "academic framing → Tier 1 + reason",
        result?.tier === 1 && result?.suppressedReason === "academic_framing",
        result,
      );
    }

    // 5. Dedupe — recent Tier 2 same-category in last 7d
    {
      const result = assignTier(
        { category: "bullying", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, recentTier2SameCategory: 1 },
      );
      check(
        "recent Tier 2 same category → downgrade to Tier 1 + dedup reason",
        result?.tier === 1 && result?.suppressedReason === "dedup_recent_tier2_same_category_7d",
        result,
      );
    }
    // Dedupe does NOT apply to Tier 3 — abuse stays Tier 3
    {
      const result = assignTier(
        { category: "abuse_disclosure", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, recentTier2SameCategory: 1 },
      );
      check(
        "recent Tier 2 abuse + new abuse_disclosure → still Tier 3 (hard rules win)",
        result?.tier === 3,
        result,
      );
    }

    // 6. Pattern promotion — 2 prior Tier 1s same category in 30d, current
    //    event would normally be Tier 1, gets promoted to 2.
    {
      const result = assignTier(
        { category: "family_conflict", severity: 1, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, recentTier1SameCategory30d: 2 },
      );
      check(
        "≥2 prior Tier 1 same category in 30d → promote to Tier 2 with reason",
        result?.tier === 2 && result?.suppressedReason === "pattern_promotion_3x_tier1_30d",
        result,
      );
    }
    // Promotion does NOT fire when it would already be Tier 2 (no double-promote)
    {
      const result = assignTier(
        { category: "family_conflict", severity: 2, confidence: 0.7, initiator: "scout", quote: "x" },
        { ...baseCtx, recentTier1SameCategory30d: 2 },
      );
      check(
        "scout-initiated sev 2 with prior Tier 1s → still Tier 2 (no spurious reason)",
        result?.tier === 2 && !result.suppressedReason,
        result,
      );
    }
  },
};
