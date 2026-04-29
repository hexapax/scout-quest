/**
 * Stream H step 3 (orchestrator side): fire-and-forget safety capture.
 *
 * Called from chat.ts after the assistant turn ends. Mirrors the
 * `captureEpisode` / `captureConversationSummary` pattern from Stream G —
 * pure side-effect, errors logged not thrown, never blocks the response.
 *
 * Pipeline:
 *   1. Skip if no scoutEmail (anonymous or non-scout sessions don't need
 *      youth-safety classification).
 *   2. Run the Haiku classifier on the recent transcript.
 *   3. Look up the small `TierContext` (recent Tier 1/2 same-category
 *      counts) so the rule layer is purely synchronous.
 *   4. Apply tier rules; bail if the rules drop the event (null / "none").
 *   5. Write to `safety_events`.
 *
 * Phase 1 stops here — no notifications fire externally. The dashboard
 * "notification" entry is written in `writeSafetyEvent` so the admin queue
 * has a row to display.
 */

import { ObjectId } from "mongodb";
import { classifyTurn, CLASSIFIER_VERSION } from "./classifier.js";
import { assignTier } from "./tier.js";
import {
  countRecentTier1InCategory30d,
  countRecentTier2InCategory,
  writeSafetyEvent,
} from "./store.js";
import type { TierContext } from "./types.js";

export interface CaptureInput {
  scoutEmail: string | null;
  /** Accept string | ObjectId | null at the call site; we coerce to
   *  ObjectId internally. Coercion failure (malformed string) drops the
   *  event silently — this isn't worth surfacing to the user. */
  conversationId: ObjectId | string | null;
  messages: Array<{ role: string; content: string }>;
  /** Optional pre-computed signals; default false on each. */
  hints?: {
    quoteIsFromCoachPrompt?: boolean;
    isAcademicFraming?: boolean;
  };
}

export function captureSafetyEvent(input: CaptureInput): void {
  // Phase 1 scope: only classify when there's a known scout subject and a
  // conversation to attribute the event to.
  if (!input.scoutEmail || !input.conversationId) return;
  if (!input.messages || input.messages.length === 0) return;

  let convOid: ObjectId;
  try {
    convOid = typeof input.conversationId === "string"
      ? new ObjectId(input.conversationId)
      : input.conversationId;
  } catch {
    return; // bad ObjectId string — silently drop
  }

  void runCapture({ ...input, conversationId: convOid }).catch((err) => {
    console.error("[safety] capture failed:", err instanceof Error ? err.message : err);
  });
}

async function runCapture(input: CaptureInput & { conversationId: ObjectId }): Promise<void> {
  const scoutEmail = input.scoutEmail!;
  const conversationId = input.conversationId;

  const rv = await classifyTurn({ messages: input.messages });
  if (!rv) return;

  // Cheap lookup: tier rules need to know about prior events for this scout.
  // Done in parallel; tier.ts is pure and synchronous below.
  const [recentTier2SameCategory, recentTier1SameCategory30d] = await Promise.all([
    countRecentTier2InCategory(scoutEmail, rv.category),
    countRecentTier1InCategory30d(scoutEmail, rv.category),
  ]);

  const ctx: TierContext = {
    recentTier2SameCategory,
    recentTier1SameCategory30d,
    quoteIsFromCoachPrompt: !!input.hints?.quoteIsFromCoachPrompt,
    isAcademicFraming: !!input.hints?.isAcademicFraming,
  };

  const decision = assignTier(rv, ctx);
  if (!decision) return;

  await writeSafetyEvent({
    scoutEmail,
    conversationId,
    ts: new Date(),
    tier: decision.tier,
    riskVector: rv,
    classifierVersion: CLASSIFIER_VERSION,
    suppressedReason: decision.suppressedReason,
  });
}
