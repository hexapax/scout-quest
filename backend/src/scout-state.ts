/**
 * Stream G step 1: per-scout rolling state.
 *
 * One doc per scout in `scout_state` (unique on scoutEmail). Holds:
 *   - events[]    — append-only observation log (capped at MAX_EVENTS, newest first)
 *   - rolling_summary — Haiku-generated narrative (300-600 tokens) regenerated
 *                       on a threshold so we don't pay for it every event
 *   - stats       — cheap aggregates (session count, last-session ts,
 *                   distinct_topics_30d)
 *
 * Regen rule (matches plan): rolling_summary regenerates when EITHER
 *   - events list grew by ≥ REGEN_EVENT_THRESHOLD since last regen, OR
 *   - more than REGEN_TIME_THRESHOLD_MS has passed since last regen
 *
 * The model only sees rolling_summary (via chat.ts) — never the raw events.
 * That keeps the system prompt tight and lets us evolve event schema without
 * breaking the model's context shape.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "./db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const COLLECTION = "scout_state";

const MAX_EVENTS = 200;
const REGEN_EVENT_THRESHOLD = 3;
const REGEN_TIME_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const ROLLING_INPUT_EVENT_LIMIT = 50;

export type ScoutStateEventType =
  | "requirement_reported_complete"
  | "requirement_started"
  | "interest_expressed"
  | "blocker"
  | "goal_set"
  | "commitment_made"
  | "concern_voiced"
  | "achievement_celebrated"
  | "topic_unresolved"
  | "external_event_mentioned";

export interface ScoutStateEvent {
  ts: Date;
  conversationId: ObjectId;
  episodeId?: ObjectId;
  type: ScoutStateEventType;
  note: string;
  payload?: {
    rankName?: string;
    requirementCode?: string;
    badgeName?: string;
    counselor?: string;
    targetDate?: string;
    [k: string]: unknown;
  };
  confidence: number;
  source_quote?: string;
}

export interface ScoutState {
  _id: ObjectId;
  scoutEmail: string;
  troopId?: string | null;
  events: ScoutStateEvent[];
  rolling_summary: string;
  rolling_summary_updated_at: Date | null;
  rolling_summary_model: string | null;
  rolling_summary_input_event_count: number;
  stats: {
    total_sessions: number;
    last_session_at: Date | null;
    distinct_topics_30d: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export async function getScoutState(scoutEmail: string): Promise<ScoutState | null> {
  const db = getScoutQuestDb();
  return db.collection<ScoutState>(COLLECTION).findOne({ scoutEmail });
}

/** Append events for a scout. Creates the state doc on first call.
 *  Caps events[] at MAX_EVENTS (drops oldest). Updates stats based on the
 *  conversationIds across the new events.
 *
 *  Idempotent on (conversationId, type, source_quote) — re-running the
 *  extractor on the same conversation won't duplicate events. */
export async function appendScoutStateEvents(
  scoutEmail: string,
  newEvents: ScoutStateEvent[],
  opts: { troopId?: string | null } = {},
): Promise<void> {
  if (newEvents.length === 0) return;
  const db = getScoutQuestDb();
  const coll = db.collection<ScoutState>(COLLECTION);
  const now = new Date();

  // Load existing state to dedupe + cap.
  const existing = await coll.findOne({ scoutEmail });
  const existingEvents = existing?.events ?? [];

  // Dedupe key: conv-id + type + first 80 chars of source_quote (or note).
  const seenKeys = new Set(
    existingEvents.map((e) => eventKey(e)),
  );
  const filtered = newEvents.filter((e) => !seenKeys.has(eventKey(e)));
  if (filtered.length === 0) return;

  // Combine: new events first (newest), then existing, capped at MAX_EVENTS.
  const merged = [...filtered, ...existingEvents].slice(0, MAX_EVENTS);

  // Stats: distinct conversationIds = total_sessions; latest ts = last_session.
  const distinctConvIds = new Set<string>();
  let lastSessionAt: Date | null = existing?.stats.last_session_at ?? null;
  for (const e of merged) {
    distinctConvIds.add(e.conversationId.toString());
    if (!lastSessionAt || e.ts > lastSessionAt) lastSessionAt = e.ts;
  }

  // distinct_topics_30d: scan event notes/payloads for badge/rank names. Cheap
  // version: use payload.badgeName + payload.rankName + first word of note.
  // Real topic-extraction lives in the summary path.
  const topics30d = collectTopics30d(merged);

  await coll.updateOne(
    { scoutEmail },
    {
      $set: {
        scoutEmail,
        ...(opts.troopId !== undefined ? { troopId: opts.troopId } : {}),
        events: merged,
        "stats.total_sessions": distinctConvIds.size,
        "stats.last_session_at": lastSessionAt,
        "stats.distinct_topics_30d": topics30d,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        rolling_summary: "",
        rolling_summary_updated_at: null,
        rolling_summary_model: null,
        rolling_summary_input_event_count: 0,
      },
    },
    { upsert: true },
  );
}

function eventKey(e: ScoutStateEvent): string {
  const stem = e.source_quote || e.note || "";
  return `${e.conversationId.toString()}|${e.type}|${stem.slice(0, 80)}`;
}

function collectTopics30d(events: ScoutStateEvent[]): string[] {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const topics = new Set<string>();
  for (const e of events) {
    if (e.ts.getTime() < cutoff) continue;
    if (e.payload?.badgeName) topics.add(`${e.payload.badgeName} MB`);
    if (e.payload?.rankName) topics.add(e.payload.rankName);
  }
  return Array.from(topics).slice(0, 20);
}

const ROLLING_SUMMARY_PROMPT = `You are maintaining a long-term coaching memory for a Boy Scout. You will receive:
  1. The previous rolling summary (may be empty for a new scout)
  2. The most recent observation events (newest first)

Produce an UPDATED rolling summary of 200-400 words that:
- Reflects the scout's current trajectory (rank progress, active merit badges, blockers)
- Names specific BSA artifacts (rank names, requirement codes, badge names) when present
- Carries forward stable details from the previous summary that aren't contradicted by recent events
- Is forward-looking — what should the next session pick up on?
- Uses third person ("Liam is working on...") not first person

Return ONLY the new rolling summary as plain text. No JSON, no headers, no markdown.`;

/** Decide whether to regenerate, then regenerate if eligible. Cheap fast-path
 *  when nothing's changed. Idempotent; safe to call after every append. */
export async function maybeRegenerateRollingSummary(
  scoutEmail: string,
): Promise<{ regenerated: boolean; reason?: string }> {
  const state = await getScoutState(scoutEmail);
  if (!state) return { regenerated: false, reason: "no state" };

  const eventsNow = state.events.length;
  const eventsAtLastRegen = state.rolling_summary_input_event_count;
  const grewBy = eventsNow - eventsAtLastRegen;
  const sinceLastRegenMs = state.rolling_summary_updated_at
    ? Date.now() - state.rolling_summary_updated_at.getTime()
    : Number.POSITIVE_INFINITY;

  let reason: string | null = null;
  if (eventsNow === 0) {
    return { regenerated: false, reason: "no events" };
  } else if (state.rolling_summary_updated_at === null) {
    reason = "first regen";
  } else if (grewBy >= REGEN_EVENT_THRESHOLD) {
    reason = `+${grewBy} events`;
  } else if (sinceLastRegenMs >= REGEN_TIME_THRESHOLD_MS) {
    reason = `${Math.floor(sinceLastRegenMs / 3_600_000)}h since last regen`;
  } else {
    return { regenerated: false, reason: `under threshold (+${grewBy} events, ${Math.floor(sinceLastRegenMs / 60_000)}m old)` };
  }

  await regenerateRollingSummary(scoutEmail);
  return { regenerated: true, reason: reason ?? undefined };
}

/** Forced regeneration. Used by maybeRegenerateRollingSummary internally and
 *  by admin tools. Caller is responsible for cost discipline. */
export async function regenerateRollingSummary(scoutEmail: string): Promise<void> {
  const state = await getScoutState(scoutEmail);
  if (!state) {
    console.warn(`[scout-state] cannot regen — no state for ${scoutEmail}`);
    return;
  }

  const events = state.events.slice(0, ROLLING_INPUT_EVENT_LIMIT);
  const eventLines = events.map((e) => formatEventForPrompt(e)).join("\n");
  const prevSummary = state.rolling_summary?.trim() || "(none — this is the first summary for this scout)";

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content:
            `${ROLLING_SUMMARY_PROMPT}\n\n` +
            `--- PREVIOUS ROLLING SUMMARY ---\n${prevSummary}\n\n` +
            `--- RECENT EVENTS (newest first, max ${ROLLING_INPUT_EVENT_LIMIT}) ---\n${eventLines}`,
        },
      ],
    });
  } catch (err) {
    console.error("[scout-state] regen anthropic call failed:", err instanceof Error ? err.message : err);
    return;
  }

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  if (!text) {
    console.warn(`[scout-state] regen produced empty summary for ${scoutEmail}`);
    return;
  }

  const db = getScoutQuestDb();
  await db.collection<ScoutState>(COLLECTION).updateOne(
    { scoutEmail },
    {
      $set: {
        rolling_summary: text,
        rolling_summary_updated_at: new Date(),
        rolling_summary_model: SUMMARY_MODEL,
        rolling_summary_input_event_count: state.events.length,
        updatedAt: new Date(),
      },
    },
  );
  console.log(`[scout-state] regenerated rolling_summary for ${scoutEmail} (${text.length} chars, ${state.events.length} events)`);
}

function formatEventForPrompt(e: ScoutStateEvent): string {
  const when = e.ts.toISOString().slice(0, 10);
  const payloadStr = e.payload && Object.keys(e.payload).length > 0
    ? ` ${JSON.stringify(e.payload)}`
    : "";
  const quoteStr = e.source_quote ? ` quote=${JSON.stringify(e.source_quote.slice(0, 120))}` : "";
  return `${when} [${e.type}] ${e.note}${payloadStr}${quoteStr}`;
}
