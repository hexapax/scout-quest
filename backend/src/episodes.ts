/** CLS Phase 1: Episode capture.
 *
 * After each conversation turn, capture a structured episode summary.
 * Episodes accumulate in MongoDB and are used in later phases to:
 *  - Pre-load session context (Phase 2)
 *  - Build scout learning profiles (Phase 3)
 *  - Surface troop-wide patterns (Phase 4)
 */

import Anthropic from "@anthropic-ai/sdk";
import { getScoutQuestDb } from "./db.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EPISODE_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for summaries

export interface Episode {
  scoutEmail: string | null;
  mode: "chat" | "voice";
  timestamp: Date;
  /** Topics discussed (e.g., "Camping MB", "First Class req 7a") */
  topics: string[];
  /** Tools the model called */
  toolsUsed: string[];
  /** Key questions the scout asked */
  questions: string[];
  /** Corrections or clarifications the scout made */
  corrections: string[];
  /** Items left unresolved */
  unresolved: string[];
  /** Scout's apparent engagement/mood */
  engagement: "high" | "medium" | "low" | "unknown";
  /** 2-3 sentence summary of the session */
  summary: string;
  /** Number of turns in the conversation */
  turnCount: number;
}

const EPISODE_PROMPT = `Analyze this conversation between Scout Coach and a scout. Extract a structured episode summary as JSON.

Return ONLY valid JSON with these fields:
{
  "topics": ["list of BSA topics discussed — rank names, merit badges, specific requirements"],
  "questions": ["key questions the scout asked"],
  "corrections": ["times the scout corrected or clarified something"],
  "unresolved": ["questions or topics left unfinished"],
  "engagement": "high|medium|low|unknown",
  "summary": "2-3 sentence summary of what happened and what the scout needs next"
}

Be specific about BSA content (use requirement numbers, badge names). Keep the summary forward-looking — what should the next session pick up on?`;

/** Generate and store an episode from a conversation. Fire-and-forget — don't block the response. */
export function captureEpisode(
  messages: Array<{ role: string; content: string }>,
  opts: { scoutEmail?: string | null; mode: "chat" | "voice"; toolsUsed: string[] }
): void {
  // Skip very short conversations (< 2 user messages)
  const userMsgs = messages.filter(m => m.role === "user");
  if (userMsgs.length < 2) return;

  // Fire async — don't await
  _generateEpisode(messages, opts).catch(err => {
    console.error("[episodes] Failed to capture episode:", err.message || err);
  });
}

async function _generateEpisode(
  messages: Array<{ role: string; content: string }>,
  opts: { scoutEmail?: string | null; mode: "chat" | "voice"; toolsUsed: string[] }
): Promise<void> {
  // Build a condensed transcript for the LLM
  const transcript = messages
    .filter(m => m.role !== "system")
    .slice(-30) // last 30 messages max
    .map(m => {
      const role = m.role === "assistant" ? "Coach" : "Scout";
      const text = typeof m.content === "string" ? m.content : "(attachment)";
      return `${role}: ${text.substring(0, 500)}`;
    })
    .join("\n");

  const resp = await anthropic.messages.create({
    model: EPISODE_MODEL,
    max_tokens: 500,
    messages: [
      { role: "user", content: `${EPISODE_PROMPT}\n\n--- CONVERSATION ---\n${transcript}` },
    ],
  });

  const text = resp.content
    .filter(b => b.type === "text")
    .map(b => b.type === "text" ? b.text : "")
    .join("");

  // Parse the JSON response
  let parsed: Record<string, unknown>;
  try {
    // Extract JSON from possible markdown code block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("[episodes] Failed to parse LLM response:", text.substring(0, 200));
    return;
  }

  const episode: Episode = {
    scoutEmail: opts.scoutEmail || null,
    mode: opts.mode,
    timestamp: new Date(),
    topics: (parsed.topics as string[]) || [],
    toolsUsed: opts.toolsUsed,
    questions: (parsed.questions as string[]) || [],
    corrections: (parsed.corrections as string[]) || [],
    unresolved: (parsed.unresolved as string[]) || [],
    engagement: (parsed.engagement as Episode["engagement"]) || "unknown",
    summary: (parsed.summary as string) || "",
    turnCount: messages.filter(m => m.role === "user").length,
  };

  const db = getScoutQuestDb();
  await db.collection("scout_episodes").insertOne(episode);
  console.log(`[episodes] Captured episode: ${episode.summary.substring(0, 80)}... (${episode.topics.join(", ")})`);
}

/** Load recent episodes for a scout (used in Phase 2 for session pre-loading). */
export async function getRecentEpisodes(scoutEmail: string, limit = 5): Promise<Episode[]> {
  const db = getScoutQuestDb();
  return db.collection<Episode>("scout_episodes")
    .find({ scoutEmail })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}
