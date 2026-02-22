import { scouts, choreLogs, budgetEntries, sessionNotes, questPlans } from "../db.js";

export interface QueuedNotification {
  scout_email: string;
  type: "chore_reminder" | "diary_reminder" | "inactivity_check_in" | "inactivity_parent_alert" | "budget_behind";
  message: string;
  priority: "low" | "default" | "high";
  target: "scout" | "parent";
}

export interface MechanicalResult {
  scout_email: string;
  notifications: QueuedNotification[];
  drift_detected: boolean;
  drift_details: string[];
}

export async function runMechanicalChecks(
  thresholds: { inactivity_reminder_days: number; inactivity_parent_alert_days: number },
): Promise<MechanicalResult[]> {
  const scoutsCol = await scouts();
  const activeScouts = await scoutsCol.find({ "quest_state.quest_status": "active" }).toArray();
  const results: MechanicalResult[] = [];

  for (const scout of activeScouts) {
    const notifications: QueuedNotification[] = [];
    const driftDetails: string[] = [];

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Chore streak risk — no log today after 6pm
    if (now.getHours() >= 18) {
      const choreCol = await choreLogs();
      const todaysLog = await choreCol.findOne({
        scout_email: scout.email,
        date: { $gte: today },
      });
      if (!todaysLog) {
        notifications.push({
          scout_email: scout.email,
          type: "chore_reminder",
          message: "Don't forget your chores today — keep that streak going!",
          priority: "default",
          target: "scout",
        });
      }
    }

    // Session inactivity
    const notesCol = await sessionNotes();
    const lastNote = await notesCol.findOne(
      { scout_email: scout.email },
      { sort: { session_date: -1 } },
    );
    if (lastNote) {
      const daysSinceSession = Math.floor(
        (now.getTime() - new Date(lastNote.session_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceSession >= thresholds.inactivity_parent_alert_days) {
        notifications.push({
          scout_email: scout.email,
          type: "inactivity_parent_alert",
          message: `${scout.name} hasn't had a Scout Quest session in ${daysSinceSession} days.`,
          priority: "high",
          target: "parent",
        });
      } else if (daysSinceSession >= thresholds.inactivity_reminder_days) {
        notifications.push({
          scout_email: scout.email,
          type: "inactivity_check_in",
          message: `Hey! It's been ${daysSinceSession} days since your last Scout Quest session. Ready to jump back in?`,
          priority: "default",
          target: "scout",
        });
      }
    }

    // Budget tracking pace
    if (scout.quest_state.quest_start_date) {
      const budgetCol = await budgetEntries();
      const latestBudget = await budgetCol.findOne(
        { scout_email: scout.email },
        { sort: { week_number: -1 } },
      );
      const weeksTracked = latestBudget?.week_number ?? 0;
      const weeksSinceStart = Math.floor(
        (now.getTime() - new Date(scout.quest_state.quest_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000),
      );
      if (weeksSinceStart > weeksTracked + 1) {
        notifications.push({
          scout_email: scout.email,
          type: "budget_behind",
          message: `You're ${weeksSinceStart - weeksTracked} week(s) behind on budget tracking.`,
          priority: "default",
          target: "scout",
        });
      }
    }

    // Milestone drift check
    const planCol = await questPlans();
    const plan = await planCol.findOne({ scout_email: scout.email });
    if (plan?.milestones) {
      for (const milestone of plan.milestones) {
        if (!milestone.completed && milestone.target_date) {
          const targetDate = new Date(milestone.target_date);
          if (now > targetDate) {
            driftDetails.push(`Milestone "${milestone.label}" past target date ${targetDate.toISOString().split("T")[0]}`);
          }
        }
      }
    }

    results.push({
      scout_email: scout.email,
      notifications,
      drift_detected: driftDetails.length > 0,
      drift_details: driftDetails,
    });
  }

  return results;
}
