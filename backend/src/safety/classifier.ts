/**
 * Stream H step 1: Haiku-based safety classifier.
 *
 * Runs post-response on each conversation turn. Takes the most recent N
 * messages (scout + coach) and returns a `RiskVector`. Returns null on
 * any failure path — the caller treats that as "no event".
 *
 * Design choice (per `docs/plans/2026-04-26-safety-flagging.md`): Claude
 * Haiku as primary classifier with a tightly-scoped JSON-output prompt.
 * Re-evaluate against YouthSafe at week 8.
 *
 * Cost: ~$0.0002/turn at Haiku rates. Real but small. Cost is logged via
 * the same `message_usage` collection used by chat (Stream C) with
 * `source: "safety_classifier"`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { RiskVector } from "./types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
export const CLASSIFIER_VERSION = `haiku-4-5/v1@2026-04-29`;

const MAX_TURNS = 6;
const MAX_QUOTE_CHARS = 280;

const PROMPT = `You are a safety classifier for a scouting AI coach used by youth ages 11–17. Read the recent conversation between Scout (the youth) and Coach (the AI) and return ONE JSON object describing whether anything in the LATEST scout message warrants adult attention.

Categories (pick the single best fit, or "none"):
- self_harm — suicidal ideation, self-injury, hopelessness with personal directionality
- abuse_disclosure — descriptions of being hurt, touched, or coerced by an adult or peer in a way that wasn't okay
- inappropriate_adult_contact — adult contacting them in ways that violate scouting two-deep / online safety
- bullying — being targeted by peers (in-person or online), harassment, exclusion campaigns
- substance_use — using/trying substances (alcohol, drugs, vaping, etc.)
- mental_health_crisis — acute distress, panic, dissociation, severe anxiety, eating-disorder behaviors
- family_conflict — ongoing conflict, separation, neglect, parent issues
- other_concern — anything safety-relevant that doesn't fit above
- none — nothing to flag

Severity scale:
1 = mentionable — surfaces a topic, low-stakes ("I felt sad once")
2 = important — ongoing concern, scout-led ("I keep getting picked on")
3 = urgent — imminent risk, specificity, or active disclosure ("I have pills right here")

Initiator:
- scout — the scout brought up the topic unprompted
- coach — the coach asked about it; scout responding to coach's framing
- external_quote — quoting someone else (movie, TV, friend's story)

Return EXACTLY this JSON object, no other text:
{
  "category": "<one of the categories above>",
  "severity": 1,
  "confidence": 0.0,
  "initiator": "<scout|coach|external_quote>",
  "quote": "<exact short excerpt from the scout's message that triggered this — ≤280 chars; empty string if category=none>"
}

Be strict. If nothing in the latest scout message is safety-relevant, return {"category":"none","severity":1,"confidence":1.0,"initiator":"scout","quote":""}.`;

export interface ClassifyInput {
  /** All conversation messages (we slice the last MAX_TURNS). */
  messages: Array<{ role: string; content: string }>;
}

/**
 * Classify the latest turn. Returns null on any failure (Anthropic call
 * fails, response unparseable, etc.) so the caller can fall through.
 */
export async function classifyTurn(input: ClassifyInput): Promise<RiskVector | null> {
  const messages = input.messages.filter((m) => m.role !== "system").slice(-MAX_TURNS);
  if (messages.length === 0) return null;
  // Need a scout (user) message in the slice to classify.
  if (!messages.some((m) => m.role === "user")) return null;

  const transcript = messages
    .map((m) => {
      const role = m.role === "assistant" ? "Coach" : "Scout";
      const text = typeof m.content === "string" ? m.content : "(attachment)";
      return `${role}: ${text.substring(0, 800)}`;
    })
    .join("\n");

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 200,
      messages: [
        { role: "user", content: `${PROMPT}\n\n--- CONVERSATION ---\n${transcript}` },
      ],
    });
  } catch (err) {
    console.error("[safety] classifier call failed:", err instanceof Error ? err.message : err);
    return null;
  }

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  const parsed = parseRiskVector(text);
  if (!parsed) {
    console.error("[safety] classifier output unparseable:", text.slice(0, 200));
    return null;
  }
  return parsed;
}

/** Exported for tests — feed it a model response and confirm we parse correctly. */
export function parseRiskVector(text: string): RiskVector | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const category = typeof raw.category === "string" ? raw.category : "none";
  if (!CATEGORIES.has(category)) return null;

  const severityNum = Number(raw.severity);
  const severity = severityNum === 1 || severityNum === 2 || severityNum === 3 ? severityNum : 1;

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const initiator = typeof raw.initiator === "string" && INITIATORS.has(raw.initiator)
    ? (raw.initiator as RiskVector["initiator"])
    : "scout";

  let quote = typeof raw.quote === "string" ? raw.quote : "";
  if (quote.length > MAX_QUOTE_CHARS) quote = quote.slice(0, MAX_QUOTE_CHARS);

  return {
    category: category as RiskVector["category"],
    severity: severity as RiskVector["severity"],
    confidence,
    initiator,
    quote,
  };
}

const CATEGORIES = new Set([
  "self_harm",
  "abuse_disclosure",
  "bullying",
  "substance_use",
  "inappropriate_adult_contact",
  "mental_health_crisis",
  "family_conflict",
  "other_concern",
  "none",
]);

const INITIATORS = new Set(["scout", "coach", "external_quote"]);
