/** Stream G: per-conversation summaries (parent/leader-facing).
 *
 * Sibling of episodes.ts:
 *   - episodes        — machine context for next-session preload
 *   - summaries (here) — human-facing recap cards (parent dashboard, scout recap)
 *
 * One ConversationSummary per conversations._id (1:1, upsert keyed on _id).
 *
 * Wire-up to chat.ts / voice-persistence.ts is deferred — that depends on
 * resolving the chat.ts conversationId plumbing (line 391 TODO) and on
 * session-end detection (idle sweeper). This module is the pure building
 * block; wiring lands in a later step of Stream G.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "./db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const COLLECTION = "conversation_summaries";

export interface ConversationSummary {
  _id: ObjectId;
  scoutEmail: string | null;
  userEmail: string;
  troopId?: string | null;
  channel: "chat" | "voice" | "mixed";
  durationMs: number;
  turnCount: number;

  one_liner: string;
  parent_recap: string;
  scout_recap: string;

  topics: string[];
  achievements: string[];
  next_steps: string[];
  blockers: string[];

  safety_tier?: 1 | 2 | 3;

  generated_at: Date;
  generated_by_model: string;
}

export interface SummaryInput {
  conversationId: ObjectId;
  scoutEmail: string | null;
  userEmail: string;
  troopId?: string | null;
  channel: "chat" | "voice" | "mixed";
  messages: Array<{ role: string; content: string }>;
  startedAt?: Date;
  endedAt?: Date;
}

const SUMMARY_PROMPT = `You are summarizing a coaching conversation between Scout Coach and a scout (or about a scout, with a parent/leader). Produce a JSON object with exactly these fields:

{
  "one_liner": "<= 80 chars, title-ish — what was this session about?",
  "parent_recap": "2-3 sentences for the scout's parent, information-forward not alarm-forward",
  "scout_recap": "2-3 sentences in coach voice addressed to the scout, encouraging, names a concrete next step",
  "topics": ["BSA topics — rank names, merit badges, requirement codes"],
  "achievements": ["things the scout reported finishing"],
  "next_steps": ["open loops the scout should follow up on"],
  "blockers": ["things that need adult help — empty array if none"]
}

Be specific (use requirement numbers, badge names). Empty arrays are fine. Return ONLY valid JSON.`;

/** Generate a ConversationSummary from a conversation. Returns null on failure.
 *  Callers should write the result with `writeConversationSummary`. Pure
 *  function — no side effects. */
export async function generateConversationSummary(
  input: SummaryInput
): Promise<ConversationSummary | null> {
  const userMsgs = input.messages.filter((m) => m.role === "user");
  if (userMsgs.length < 2) return null;

  const transcript = input.messages
    .filter((m) => m.role !== "system")
    .slice(-40)
    .map((m) => {
      const role = m.role === "assistant" ? "Coach" : "Scout";
      const text = typeof m.content === "string" ? m.content : "(attachment)";
      return `${role}: ${text.substring(0, 600)}`;
    })
    .join("\n");

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 700,
      messages: [
        { role: "user", content: `${SUMMARY_PROMPT}\n\n--- CONVERSATION ---\n${transcript}` },
      ],
    });
  } catch (err) {
    console.error("[summary] anthropic call failed:", err instanceof Error ? err.message : err);
    return null;
  }

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  let parsed: Record<string, unknown>;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in response");
    parsed = JSON.parse(match[0]);
  } catch (err) {
    console.error("[summary] parse failed:", text.substring(0, 200));
    return null;
  }

  const startedAt = input.startedAt ?? null;
  const endedAt = input.endedAt ?? new Date();
  const durationMs = startedAt ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : 0;

  return {
    _id: input.conversationId,
    scoutEmail: input.scoutEmail,
    userEmail: input.userEmail,
    troopId: input.troopId ?? null,
    channel: input.channel,
    durationMs,
    turnCount: userMsgs.length,
    one_liner: asString(parsed.one_liner, "Coaching session"),
    parent_recap: asString(parsed.parent_recap, ""),
    scout_recap: asString(parsed.scout_recap, ""),
    topics: asStringArray(parsed.topics),
    achievements: asStringArray(parsed.achievements),
    next_steps: asStringArray(parsed.next_steps),
    blockers: asStringArray(parsed.blockers),
    generated_at: new Date(),
    generated_by_model: SUMMARY_MODEL,
  };
}

/** Upsert a summary keyed on _id. Idempotent — re-running on the same
 *  conversation overwrites the prior summary. */
export async function writeConversationSummary(summary: ConversationSummary): Promise<void> {
  const db = getScoutQuestDb();
  await db.collection<ConversationSummary>(COLLECTION).replaceOne(
    { _id: summary._id },
    summary,
    { upsert: true }
  );
}

/** Fire-and-forget: generate + write. Mirrors the captureEpisode pattern.
 *  Errors are logged, never thrown. Wire-up callers should not await. */
export function captureConversationSummary(input: SummaryInput): void {
  generateConversationSummary(input)
    .then((summary) => {
      if (!summary) return;
      return writeConversationSummary(summary);
    })
    .catch((err) => {
      console.error("[summary] capture failed:", err instanceof Error ? err.message : err);
    });
}

export async function getConversationSummary(
  conversationId: ObjectId
): Promise<ConversationSummary | null> {
  const db = getScoutQuestDb();
  return db.collection<ConversationSummary>(COLLECTION).findOne({ _id: conversationId });
}

export async function getRecentSummariesForScout(
  scoutEmail: string,
  limit = 20
): Promise<ConversationSummary[]> {
  const db = getScoutQuestDb();
  return db
    .collection<ConversationSummary>(COLLECTION)
    .find({ scoutEmail })
    .sort({ generated_at: -1 })
    .limit(limit)
    .toArray();
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
