import cron from "node-cron";
import { runDailyPipeline } from "./cron/pipeline.js";

const schedule = process.env.CRON_SCHEDULE || "0 20 * * *";
const ntfyTopic = process.env.NTFY_TOPIC || "";
const parentTopic = process.env.NTFY_PARENT_TOPIC;
const backfillModel = process.env.BACKFILL_MODEL || "claude-3-5-haiku-20241022";
const reviewModel = process.env.REVIEW_MODEL || "claude-sonnet-4-20250514";

if (!ntfyTopic) {
  console.error("NTFY_TOPIC not set");
  process.exit(1);
}

// Ensure MongoDB connection is initialized
await import("./db.js");

console.log(`[cron] Scheduled daily review at: ${schedule}`);

cron.schedule(schedule, async () => {
  try {
    await runDailyPipeline({
      thresholds: {
        inactivity_reminder_days: parseInt(process.env.INACTIVITY_REMINDER_DAYS || "3", 10),
        inactivity_parent_alert_days: parseInt(process.env.INACTIVITY_PARENT_ALERT_DAYS || "7", 10),
        plan_review_staleness_days: parseInt(process.env.PLAN_REVIEW_STALENESS_DAYS || "7", 10),
      },
      ntfy_topic: ntfyTopic,
      parent_topic: parentTopic,
      backfill_model: backfillModel,
      review_model: reviewModel,
    });
  } catch (err) {
    console.error("[cron] Pipeline failed:", err);
  }
});
