/**
 * DB Snapshot utility — captures and diffs MongoDB state between chain steps.
 *
 * Used by the chain runner to record what the DB looks like before and after
 * each step, enabling verification that the coach's actions match expectations.
 */

import { Db } from "mongodb";
import type { DBSnapshot } from "./types.js";

/**
 * Capture a snapshot of the relevant collections for a given scout.
 */
export async function captureSnapshot(db: Db, scoutEmail: string): Promise<DBSnapshot> {
  const scout = await db.collection("scouts").findOne(
    { email: scoutEmail },
    { projection: { _id: 0 } },
  );

  const requirements = await db.collection("requirements")
    .find({ scout_email: scoutEmail }, { projection: { _id: 0 } })
    .sort({ req_id: 1 })
    .toArray();

  const choreLogCount = await db.collection("chore_logs")
    .countDocuments({ scout_email: scoutEmail });

  const budgetEntries = await db.collection("budget_entries")
    .find({ scout_email: scoutEmail })
    .sort({ week_number: -1 })
    .toArray();

  const budgetRunningTotal = budgetEntries.length > 0
    ? (budgetEntries[0].running_savings_total as number) || 0
    : 0;

  const sessionNotes = await db.collection("session_notes")
    .find({ scout_email: scoutEmail }, { projection: { _id: 0 } })
    .sort({ session_date: -1 })
    .toArray();

  const questPlan = await db.collection("quest_plans").findOne(
    { scout_email: scoutEmail },
    { projection: { _id: 0 } },
  );

  return {
    scout: scout ? stripMongo(scout) : null,
    requirements: requirements.map(stripMongo),
    choreLogCount,
    budgetEntryCount: budgetEntries.length,
    budgetRunningTotal,
    sessionNotes: sessionNotes.map(stripMongo),
    questPlan: questPlan ? stripMongo(questPlan) : null,
  };
}

/**
 * Compute a human-readable diff between two snapshots.
 * Returns a list of change descriptions.
 */
export function diffSnapshots(before: DBSnapshot, after: DBSnapshot): string[] {
  const changes: string[] = [];

  // Scout profile changes
  if (before.scout && after.scout) {
    const bqs = before.scout.quest_state as Record<string, unknown> | undefined;
    const aqs = after.scout.quest_state as Record<string, unknown> | undefined;
    if (bqs && aqs) {
      if (bqs.current_savings !== aqs.current_savings) {
        changes.push(`savings: $${bqs.current_savings} → $${aqs.current_savings}`);
      }
      if (bqs.goal_item !== aqs.goal_item) {
        changes.push(`goal: ${bqs.goal_item} → ${aqs.goal_item}`);
      }
      if (bqs.target_budget !== aqs.target_budget) {
        changes.push(`target_budget: $${bqs.target_budget} → $${aqs.target_budget}`);
      }
    }
    const bc = before.scout.character as Record<string, unknown> | undefined;
    const ac = after.scout.character as Record<string, unknown> | undefined;
    if (bc && ac) {
      if (bc.tone_dial !== ac.tone_dial) {
        changes.push(`tone_dial: ${bc.tone_dial} → ${ac.tone_dial}`);
      }
      if (bc.domain_intensity !== ac.domain_intensity) {
        changes.push(`domain_intensity: ${bc.domain_intensity} → ${ac.domain_intensity}`);
      }
    }
  }

  // Requirement status changes
  const beforeReqs = new Map(before.requirements.map(r => [r.req_id as string, r.status as string]));
  for (const r of after.requirements) {
    const reqId = r.req_id as string;
    const oldStatus = beforeReqs.get(reqId);
    const newStatus = r.status as string;
    if (oldStatus && oldStatus !== newStatus) {
      changes.push(`req ${reqId}: ${oldStatus} → ${newStatus}`);
    }
  }

  // Collection count changes
  if (before.choreLogCount !== after.choreLogCount) {
    changes.push(`chore_logs: ${before.choreLogCount} → ${after.choreLogCount} (+${after.choreLogCount - before.choreLogCount})`);
  }
  if (before.budgetEntryCount !== after.budgetEntryCount) {
    changes.push(`budget_entries: ${before.budgetEntryCount} → ${after.budgetEntryCount} (+${after.budgetEntryCount - before.budgetEntryCount})`);
  }
  if (before.budgetRunningTotal !== after.budgetRunningTotal) {
    changes.push(`budget_total: $${before.budgetRunningTotal} → $${after.budgetRunningTotal}`);
  }
  if (before.sessionNotes.length !== after.sessionNotes.length) {
    changes.push(`session_notes: ${before.sessionNotes.length} → ${after.sessionNotes.length} (+${after.sessionNotes.length - before.sessionNotes.length})`);
  }
  if (!before.questPlan && after.questPlan) {
    changes.push("quest_plan: created");
  }

  return changes;
}

/** Strip MongoDB _id and other internal fields for clean JSON. */
function stripMongo(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, _test_seeded, ...rest } = doc;
  return rest;
}
