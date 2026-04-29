/**
 * Stream G step 3: episode/summary → ScoutStateEvent[]
 *
 * Mechanical mapping (no LLM call). Pulls from the structured fields the
 * summary generator already produces:
 *   - achievements   → achievement_celebrated  / requirement_reported_complete
 *   - next_steps     → topic_unresolved        / commitment_made
 *   - blockers       → blocker
 *
 * Optionally enriches with episode data when one is provided:
 *   - episode.unresolved → topic_unresolved   (deduped against summary's next_steps)
 *
 * The Stream G plan calls for a second light-Haiku pass to fill structured
 * payload fields (rankName, requirementCode, badgeName). Skipped here in
 * v1 — the regex below handles the common BSA syntax. The LLM enrich pass
 * is a follow-up when the regex misses too much.
 */

import { ObjectId } from "mongodb";
import type { ConversationSummary } from "./conversation-summary.js";
import type { Episode } from "./episodes.js";
import type { ScoutStateEvent, ScoutStateEventType } from "./scout-state.js";

const RANK_NAMES = [
  "Scout",
  "Tenderfoot",
  "Second Class",
  "First Class",
  "Star",
  "Life",
  "Eagle",
];

const REQ_CODE_RE = /\b(?:req|requirement)?\s*([0-9]{1,2}[a-z]?(?:\.[0-9]+)?)\b/i;
const BADGE_RE = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*)\s+(?:Merit Badge|MB)\b/;

interface ExtractContext {
  conversationId: ObjectId;
  episodeId?: ObjectId;
  ts: Date;
  defaultConfidence?: number;
}

export function extractEventsFromSummary(
  summary: ConversationSummary,
  episode: Episode | null,
  ctx: ExtractContext,
): ScoutStateEvent[] {
  const events: ScoutStateEvent[] = [];
  const confidence = ctx.defaultConfidence ?? 0.7;

  for (const item of summary.achievements) {
    const type: ScoutStateEventType = looksLikeRequirementCompletion(item)
      ? "requirement_reported_complete"
      : "achievement_celebrated";
    events.push({
      ts: ctx.ts,
      conversationId: ctx.conversationId,
      ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
      type,
      note: item,
      payload: extractPayload(item),
      confidence,
      source_quote: item,
    });
  }

  for (const item of summary.next_steps) {
    const type: ScoutStateEventType = looksLikeCommitment(item)
      ? "commitment_made"
      : "topic_unresolved";
    events.push({
      ts: ctx.ts,
      conversationId: ctx.conversationId,
      ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
      type,
      note: item,
      payload: extractPayload(item),
      confidence,
      source_quote: item,
    });
  }

  for (const item of summary.blockers) {
    events.push({
      ts: ctx.ts,
      conversationId: ctx.conversationId,
      ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
      type: "blocker",
      note: item,
      payload: extractPayload(item),
      confidence,
      source_quote: item,
    });
  }

  // Optional: layer in episode.unresolved that isn't already represented as
  // a next_step. Lower confidence since episodes are coarser than summaries.
  if (episode?.unresolved?.length) {
    const seenNotes = new Set(events.map((e) => normaliseForDedupe(e.note)));
    for (const u of episode.unresolved) {
      const key = normaliseForDedupe(u);
      if (seenNotes.has(key)) continue;
      events.push({
        ts: ctx.ts,
        conversationId: ctx.conversationId,
        ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
        type: "topic_unresolved",
        note: u,
        payload: extractPayload(u),
        confidence: Math.max(0, confidence - 0.2),
        source_quote: u,
      });
      seenNotes.add(key);
    }
  }

  return events;
}

function looksLikeRequirementCompletion(text: string): boolean {
  // Distinguishes a *specific requirement* completion ("finished Camping MB req 4")
  // from a milestone ("earned my Tenderfoot rank patch"). Earlier draft was
  // permissive — anything that mentioned rank/badge + earned/finished classified
  // as requirement_reported_complete, which over-fired on rank achievements.
  // The plan keeps these distinct ("requirement_reported_complete" vs
  // "achievement_celebrated") so the rolling summary can render them differently.
  const hasReqKeyword = /\b(?:requirement|req\s*[0-9])/i.test(text);
  const hasReqCodeWithLetter = /\b[0-9]{1,2}[a-z]\b/i.test(text); // "5a", "10b"
  return hasReqKeyword || hasReqCodeWithLetter;
}

function looksLikeCommitment(text: string): boolean {
  return /\b(I'?ll|I will|going to|plan(?:ning)? to|will (?:do|finish|start|email|ask|call))\b/i.test(text);
}

function extractPayload(text: string): ScoutStateEvent["payload"] | undefined {
  const out: NonNullable<ScoutStateEvent["payload"]> = {};

  for (const rank of RANK_NAMES) {
    const re = new RegExp(`\\b${escape(rank)}\\b`);
    if (re.test(text)) {
      out.rankName = rank;
      break;
    }
  }

  const badgeMatch = text.match(BADGE_RE);
  if (badgeMatch) {
    out.badgeName = badgeMatch[1];
  }

  const reqMatch = text.match(REQ_CODE_RE);
  if (reqMatch && /\b(?:req|requirement|First Class|Tenderfoot|Second Class|Star|Life|Eagle)\b/i.test(text)) {
    out.requirementCode = reqMatch[1];
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normaliseForDedupe(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
