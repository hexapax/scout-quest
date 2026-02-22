import { runMechanicalChecks } from "./mechanicalChecks.js";
import { sendNotifications } from "./notifications.js";
import { cronLog } from "../db.js";

interface PipelineConfig {
  thresholds: {
    inactivity_reminder_days: number;
    inactivity_parent_alert_days: number;
    plan_review_staleness_days: number;
  };
  ntfy_topic: string;
  parent_topic?: string;
}

export async function runDailyPipeline(config: PipelineConfig): Promise<void> {
  const logCol = await cronLog();
  const now = new Date();

  console.log(`[cron] Starting daily pipeline at ${now.toISOString()}`);

  // Step 1: Mechanical checks
  const results = await runMechanicalChecks(config.thresholds);

  // Log drift detections
  for (const result of results) {
    if (result.drift_detected) {
      await logCol.insertOne({
        run_date: now,
        scout_email: result.scout_email,
        action: "drift_detected",
        details: result.drift_details.join("; "),
        created_at: now,
      });
    }
  }

  // Step 2: Session notes backfill (Task 13)
  // Step 3: Plan review (Task 13)

  // Step 4: Send accumulated notifications
  const allNotifications = results.flatMap(r => r.notifications);
  if (allNotifications.length > 0) {
    await sendNotifications(allNotifications, config.ntfy_topic, config.parent_topic);
  }

  console.log(`[cron] Pipeline complete. ${results.length} scouts checked, ${allNotifications.length} notifications sent.`);
}
