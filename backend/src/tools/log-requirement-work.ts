/** Tool: log_requirement_work
 * Generic evidence logging for any requirement type.
 * Replaces badge-specific tools (log_chore, log_budget_entry, log_diary_entry, setup_time_mgmt).
 * Records work evidence in MongoDB and updates requirement progress.
 */

import { getScoutQuestDb } from "../db.js";

export type EvidenceType =
  | "chore_log"
  | "budget_entry"
  | "diary_entry"
  | "time_management"
  | "service_hours"
  | "skill_practice"
  | "general";

export interface LogRequirementWorkInput {
  scoutEmail: string;
  evidenceType: EvidenceType;
  description: string;
  /** Optional: tie this to a specific requirement (e.g., "PM 2c", "FL 3a") */
  requirementRef?: string;
  /** Type-specific data */
  data?: Record<string, unknown>;
}

export async function logRequirementWork(
  input: LogRequirementWorkInput
): Promise<string> {
  try {
    const db = getScoutQuestDb();
    const now = new Date();

    // Store the evidence entry
    const entry = {
      scout_email: input.scoutEmail,
      evidence_type: input.evidenceType,
      description: input.description,
      requirement_ref: input.requirementRef ?? null,
      data: input.data ?? {},
      logged_at: now,
    };

    await db.collection("requirement_work_log").insertOne(entry);

    // Type-specific side effects
    switch (input.evidenceType) {
      case "chore_log": {
        // Also log to chore_logs collection for streak tracking
        const choreName = input.data?.choreName ?? input.description;
        await db.collection("chore_logs").insertOne({
          scout_email: input.scoutEmail,
          chore_name: String(choreName),
          logged_at: now,
          amount: input.data?.amount ?? 0,
        });
        const amount = input.data?.amount ?? 0;
        return `Chore logged: ${choreName}${Number(amount) > 0 ? ` ($${amount})` : ""}. Evidence recorded.`;
      }

      case "budget_entry": {
        const type = input.data?.type ?? "expense";
        const amount = Number(input.data?.amount ?? 0);
        const category = input.data?.category ?? "other";
        await db.collection("budget_entries").insertOne({
          scout_email: input.scoutEmail,
          type,
          amount,
          category: String(category),
          description: input.description,
          date: now,
        });
        return `Budget entry logged: ${type} $${amount.toFixed(2)} (${category}). Evidence recorded.`;
      }

      case "diary_entry": {
        await db.collection("diary_entries").insertOne({
          scout_email: input.scoutEmail,
          entry: input.description,
          date: now,
        });
        return `Diary entry logged for ${now.toLocaleDateString()}. Evidence recorded.`;
      }

      case "time_management": {
        await db.collection("time_mgmt").insertOne({
          scout_email: input.scoutEmail,
          type: input.data?.type ?? "todo",
          items: input.data?.items ?? [],
          logged_at: now,
        });
        return `Time management entry logged. Evidence recorded.`;
      }

      default:
        return `Work evidence logged: ${input.evidenceType} — ${input.description}`;
    }
  } catch (err) {
    return `Failed to log work: ${err instanceof Error ? err.message : String(err)}`;
  }
}
