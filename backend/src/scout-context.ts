import { getScoutQuestDb } from "./db.js";
import type { AnthropicSystemBlock } from "./types.js";
import { emailMatchRegex } from "./email-normalize.js";

interface ScoutDoc {
  email: string;
  name: string;
  age?: number;
  troop?: string;
  patrol?: string;
  quest_state?: {
    goal_item?: string;
    goal_description?: string;
    target_budget?: number;
    current_savings?: number;
    quest_status?: string;
    quest_start_date?: Date | null;
  };
  character?: {
    base?: string;
    quest_overlay?: string;
    tone_dial?: number;
  };
}

interface AdvancementDoc {
  userId: string;
  userFullName?: string;
  rankName?: string;
  percentComplete?: number;
  dateEarned?: string | null;
}

interface RequirementDoc {
  userId: string;
  requirementName?: string;
  rankName?: string;
  dateCompleted?: string | null;
  isComplete?: boolean;
}

/** Build per-scout context block. Returns null if scout not found. */
export async function getScoutContext(email: string): Promise<AnthropicSystemBlock | null> {
  try {
    const db = getScoutQuestDb();

    // Look up scout profile — Gmail-normalized, case-insensitive
    const emailRe = emailMatchRegex(email);
    const scout = await db.collection<ScoutDoc>("scouts").findOne({ email: emailRe });

    // Look up in Scoutbook scouts if quest profile doesn't exist
    const scoutbookScout = await db.collection("scoutbook_scouts").findOne({
      $or: [{ email: emailRe }, { "parents": { $elemMatch: { email: emailRe } } }],
    });

    if (!scout && !scoutbookScout) return null;

    const sb = scoutbookScout as Record<string, any> | null;
    const name = scout?.name || (sb ? `${sb.firstName || ""} ${sb.lastName || ""}`.trim() : "") || "Scout";
    const userId: string | undefined = sb?.userId;
    const patrol: string | undefined = scout?.patrol || sb?.patrol?.name;
    const troop: string | undefined = scout?.troop || "2024";

    // Get advancement summary from Scoutbook
    const advancement = userId
      ? await db.collection<AdvancementDoc>("scoutbook_advancement")
          .find({ userId })
          .toArray()
      : [];

    // Get in-progress rank requirements
    const inProgressRank = advancement.find(
      (a) => !a.dateEarned && a.rankName
    );

    const earnedRanks = advancement
      .filter((a) => a.dateEarned && a.rankName)
      .map((a) => a.rankName)
      .join(", ");

    // Get upcoming events (next 30 days)
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcomingEvents = userId
      ? await db.collection("scoutbook_events")
          .find({
            startDate: { $gte: now.toISOString(), $lte: in30.toISOString() },
            "invitedUsers.userId": userId,
          })
          .project({ eventName: 1, startDate: 1, location: 1, invitedUsers: 1 })
          .limit(5)
          .toArray()
      : [];

    // Build context text
    const lines: string[] = [`SCOUT CONTEXT — ${name}`];
    lines.push(`Email: ${email}`);
    if (troop) lines.push(`Troop: ${troop}`);
    if (patrol) lines.push(`Patrol: ${patrol}`);
    if (scout?.age) lines.push(`Age: ${scout.age}`);
    if (userId) lines.push(`Scoutbook userId: ${userId}`);

    if (earnedRanks) {
      lines.push(`\nEarned ranks: ${earnedRanks}`);
    }

    if (inProgressRank) {
      lines.push(
        `\nCurrently working on: ${inProgressRank.rankName} (${inProgressRank.percentComplete ?? "?"}% complete)`
      );
    }

    if (scout?.quest_state) {
      const q = scout.quest_state;
      if (q.quest_status && q.quest_status !== "setup") {
        lines.push(`\nSavings Quest:`);
        lines.push(`  Goal: ${q.goal_item || "not set"} — ${q.goal_description || ""}`);
        lines.push(`  Budget: $${q.target_budget || 0} | Saved: $${q.current_savings || 0}`);
        lines.push(`  Status: ${q.quest_status}`);
        if (q.quest_start_date) {
          lines.push(`  Started: ${new Date(q.quest_start_date).toLocaleDateString()}`);
        }
      }
    }

    if (scout?.character) {
      const c = scout.character;
      if (c.base) {
        lines.push(`\nCharacter: ${c.base}${c.quest_overlay ? ` (${c.quest_overlay})` : ""}`);
        if (c.tone_dial !== undefined) {
          lines.push(`Tone dial: ${c.tone_dial}/10 (${c.tone_dial <= 3 ? "formal" : c.tone_dial >= 7 ? "casual" : "balanced"})`);
        }
      }
    }

    if (upcomingEvents.length > 0) {
      lines.push(`\nUpcoming events (next 30 days):`);
      for (const evt of upcomingEvents) {
        const e = evt as any;
        const rsvp = userId
          ? e.invitedUsers?.find((u: any) => u.userId === userId)?.rsvpCode
          : null;
        const rsvpStr = rsvp === "Y" ? "Going" : rsvp === "N" ? "Not going" : "No response";
        lines.push(`  - ${e.eventName} on ${e.startDate?.substring(0, 10) || "TBD"} (RSVP: ${rsvpStr})`);
      }
    }

    return {
      type: "text",
      text: lines.join("\n"),
    };
  } catch (err) {
    console.error("scout-context lookup failed:", err);
    return null;
  }
}
