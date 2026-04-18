/**
 * Voice-session conversation persistence — closes the `chat.ts`
 * `conversationId: undefined` TODO that had been open since the voice
 * endpoint shipped.
 *
 * On the first voice turn of a session we create a `conversations` doc
 * with `channel: "voice"` and stash the resulting _id on the in-memory
 * voice context. Every subsequent turn of the same voice session
 * appends its user+assistant messages to that doc.
 *
 * Voice context TTL is 5 min, so a conversation naturally "ends" when
 * the user goes silent — the next call starts a fresh doc. That matches
 * how the user actually thinks about voice sessions (one call = one
 * conversation, reconnects within a few seconds counts as same session,
 * a 20-minute gap counts as a new one).
 */

import { ObjectId, type Document } from "mongodb";
import { getScoutQuestDb } from "./db.js";
import { getVoiceContext, setVoiceConversationId } from "./voice-context.js";
import { lookupUserRole } from "./auth/role-lookup.js";

interface VoiceTurnMessage {
  role: string;
  content: string;
  /** Structured tool-call records for this turn. Attached to the assistant
   *  message so the history viewer can render them inline. */
  toolCalls?: Array<{ name: string; args: unknown; result: string }>;
}

const COLLECTION = "conversations";
const TITLE_MAX_LEN = 60;
const TRANSCRIPT_PREVIEW_LEN = 240;

/**
 * Persist one voice turn. Creates the conversation doc if needed, else
 * appends to the existing one. Fire-and-forget — caller should not await.
 *
 * @param args Attribution and content for this single turn.
 */
export async function persistVoiceTurn(args: {
  /** Email of the authenticated user (cookie owner). */
  userEmail: string | null;
  /** Effective email in the chat context — possibly an emulated scout. */
  effectiveEmail: string | null;
  /** Model string from the request (e.g., "scoutmaster:claude-opus-4-7"). */
  model: string;
  /** The user message for this turn (last user content from body.messages). */
  userMessage: string;
  /** The assistant's full response text (accumulated across SSE deltas). */
  assistantMessage: string;
  /** Tool calls executed during this turn. */
  toolCalls: Array<{ name: string; args: unknown; result: string }>;
}): Promise<void> {
  try {
    if (!args.userEmail) return; // Nothing to attribute to
    if (!args.assistantMessage.trim() && !args.userMessage.trim()) return;

    const db = getScoutQuestDb();
    const coll = db.collection<Document>(COLLECTION);
    const now = new Date();

    const userMsg: VoiceTurnMessage = {
      role: "user",
      content: args.userMessage,
    };
    const assistantMsg: VoiceTurnMessage = {
      role: "assistant",
      content: args.assistantMessage,
      ...(args.toolCalls.length ? { toolCalls: args.toolCalls } : {}),
    };

    const existingId = getVoiceContext()?.conversationId;

    if (existingId) {
      // Append to existing conversation. MongoDB's strict `PushOperator` type
      // refuses pushes into an arbitrary field on a generic `Document`;
      // conversations.ts owns the real schema, so we cast the update to the
      // driver's generic shape here.
      const update = {
        $push: {
          messages: {
            $each: [
              { ...userMsg, ts: now },
              { ...assistantMsg, ts: now },
            ],
          },
        },
        $set: { updatedAt: now },
      } as unknown as Parameters<typeof coll.updateOne>[1];
      await coll.updateOne({ _id: new ObjectId(existingId) }, update);
      return;
    }

    // First turn — create a new voice conversation doc.
    const roleInfo = await lookupUserRole(args.userEmail);
    const emulateEmail = getVoiceContext()?.emulateEmail ?? null;
    const scoutEmail =
      emulateEmail ??
      (roleInfo.role === "scout" || roleInfo.role === "test_scout"
        ? args.userEmail
        : null);

    const title = makeVoiceTitle(args.userMessage, args.assistantMessage);

    const doc = {
      userEmail: args.userEmail,
      scoutEmail,
      troopId: roleInfo.troop ?? null,
      channel: "voice" as const,
      title,
      model: args.model,
      messages: [
        { ...userMsg, ts: now },
        { ...assistantMsg, ts: now },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const result = await coll.insertOne(doc);
    setVoiceConversationId(result.insertedId.toString());

    console.log(
      JSON.stringify({
        event: "voice_conversation_created",
        conversationId: result.insertedId.toString(),
        userEmail: args.userEmail,
        scoutEmail,
        title,
      }),
    );
  } catch (err) {
    // Persistence must never break the voice user's experience.
    console.error(
      "[voice-persist] error (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Derive a conversation title from the first user/assistant exchange. */
function makeVoiceTitle(userText: string, assistantText: string): string {
  const src = userText.trim() || assistantText.trim();
  const clean = src.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_MAX_LEN) return `\u{1F399} ${clean}`.trim();
  return `\u{1F399} ${clean.slice(0, Math.min(TRANSCRIPT_PREVIEW_LEN, TITLE_MAX_LEN - 2))}\u2026`.trim();
}
