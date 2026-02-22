import { MongoClient } from "mongodb";
import { sessionNotes, cronLog, scouts } from "../db.js";

export async function backfillSessionNotes(
  backfillModel: string,
): Promise<void> {
  const lcUri = process.env.LIBRECHAT_MONGO_URI || "";
  if (!lcUri) {
    console.log("[cron] LIBRECHAT_MONGO_URI not set — skipping session backfill");
    return;
  }

  const scoutsCol = await scouts();
  const activeScouts = await scoutsCol.find({ "quest_state.quest_status": "active" }).toArray();
  const notesCol = await sessionNotes();
  const logCol = await cronLog();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const client = new MongoClient(lcUri);
  try {
    await client.connect();
    const lcDb = client.db();

    for (const scout of activeScouts) {
      // Check if agent already logged notes today
      const existingNote = await notesCol.findOne({
        scout_email: scout.email,
        session_date: { $gte: todayStart },
        source: "agent",
      });
      if (existingNote) continue;

      // Check for conversations today in LibreChat
      const conversations = await lcDb.collection("conversations")
        .find({ user: scout.email, updatedAt: { $gte: todayStart } })
        .toArray();

      if (conversations.length === 0) continue;

      // Get messages for the most recent conversation
      const latestConvo = conversations[conversations.length - 1];
      const messages = await lcDb.collection("messages")
        .find({ conversationId: latestConvo.conversationId })
        .sort({ createdAt: 1 })
        .limit(50)
        .toArray();

      if (messages.length < 2) continue;

      // Use Anthropic API to extract session summary
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.log("[cron] ANTHROPIC_API_KEY not set — skipping LLM backfill");
        return;
      }

      const transcript = messages.map(m =>
        `${m.sender === "User" ? "Scout" : "Coach"}: ${typeof m.text === "string" ? m.text.slice(0, 300) : ""}`
      ).join("\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: backfillModel,
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `Extract a brief session summary from this Scout Quest conversation. Return JSON with: topics_discussed (string[]), progress_made (string), pending_items (string[]), next_session_focus (string or null). Be concise.\n\n${transcript}`,
          }],
        }),
      });

      if (!response.ok) {
        console.error(`[cron] Anthropic API error: ${response.status}`);
        continue;
      }

      const result = await response.json() as { content: { text: string }[] };
      const text = result.content?.[0]?.text || "";

      try {
        const parsed = JSON.parse(text);
        await notesCol.insertOne({
          scout_email: scout.email,
          session_date: now,
          source: "cron",
          topics_discussed: parsed.topics_discussed || ["Session content"],
          progress_made: parsed.progress_made || "See conversation",
          pending_items: parsed.pending_items || [],
          next_session_focus: parsed.next_session_focus || undefined,
          created_at: now,
        });

        await logCol.insertOne({
          run_date: now,
          scout_email: scout.email,
          action: "session_notes_backfill",
          details: `Backfilled session notes from ${messages.length} messages`,
          model_used: backfillModel,
          created_at: now,
        });
      } catch {
        console.error(`[cron] Failed to parse LLM response for ${scout.email}`);
      }
    }
  } finally {
    await client.close();
  }
}
