/**
 * Stream H: shared types for the safety-flagging pipeline.
 *
 * Mirrors `docs/plans/2026-04-26-safety-flagging.md`. The classifier produces
 * a `RiskVector` per turn; tier rules turn that into a `SafetyTier` and write
 * a `SafetyEvent` to MongoDB. Phase 1 is detection-only — no external
 * notifications fire (see `project_stream_h_staging.md`).
 */

import type { ObjectId } from "mongodb";

export type RiskCategory =
  | "self_harm"
  | "abuse_disclosure"
  | "bullying"
  | "substance_use"
  | "inappropriate_adult_contact"
  | "mental_health_crisis"
  | "family_conflict"
  | "other_concern"
  | "none";

export type RiskInitiator = "scout" | "coach" | "external_quote";
export type RiskSeverity = 1 | 2 | 3;
export type SafetyTier = 1 | 2 | 3;

export interface RiskVector {
  category: RiskCategory;
  severity: RiskSeverity;
  /** 0–1. Tier rules reject anything below 0.5 as "none". */
  confidence: number;
  initiator: RiskInitiator;
  /** Exact triggering text — short excerpt, never the full transcript. */
  quote: string;
}

/**
 * Phase 1 SafetyEvent — same shape as the design doc but the
 * `notifications` array stays single-entry (channel="dashboard",
 * recipientRole="admin") because external send paths are deferred to
 * Phase 2.
 */
export interface SafetyEventNotification {
  channel: "email" | "sms" | "phone" | "ntfy" | "dashboard";
  recipient: string;
  recipientRole: "parent" | "scoutmaster" | "admin";
  sentAt: Date;
  deliveredAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

export type ReviewDecision =
  | "no_action"
  | "parent_followup"
  | "scoutmaster_followup"
  | "mandated_report_filed"
  | "emergency_services_called";

export interface SafetyEvent {
  _id: ObjectId;
  scoutEmail: string;
  conversationId: ObjectId;
  ts: Date;
  tier: SafetyTier;
  riskVector: RiskVector;
  classifierVersion: string;
  /** When the suppression layer kicked in, why we *didn't* escalate further. */
  suppressedReason?: string;

  notifications: SafetyEventNotification[];

  reviewedAt?: Date;
  reviewedBy?: string;
  reviewDecision?: ReviewDecision;
  reviewNotes?: string;
  caseClosed: boolean;
}

/** Context passed alongside the classifier result to the tier rules. */
export interface TierContext {
  /** Prior Tier 2 events for this scout in the past 7 days, same category.
   *  Empty array on the happy path. Used by the dedupe rule. */
  recentTier2SameCategory: number;
  /** Prior Tier 1 events for this scout in the past 30 days, same category.
   *  Used by the pattern-detection promotion rule. */
  recentTier1SameCategory30d: number;
  /** Whether the matching quote came from a coach prompt that primed the
   *  topic — downgrade signal. */
  quoteIsFromCoachPrompt: boolean;
  /** Whether the conversation has academic/definitional framing
   *  (school project, health class, etc.) — suppression signal. */
  isAcademicFraming: boolean;
}
