import mongoose, { Schema } from "mongoose";

const cronLogSchema = new Schema({
  run_date: { type: Date, required: true, index: true },
  scout_email: { type: String, required: true, index: true },
  action: {
    type: String, required: true,
    enum: ["drift_detected", "session_notes_backfill", "notification_sent", "plan_review", "inactivity_alert", "milestone_check"],
  },
  details: String,
  model_used: String,
  changes_made: String,
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const CronLog = mongoose.model("CronLog", cronLogSchema, "cron_log");
