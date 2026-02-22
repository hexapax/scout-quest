import mongoose, { Schema } from "mongoose";

const planChangelogSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  change_date: { type: Date, required: true, index: true },
  source: { type: String, enum: ["agent", "cron", "admin"], required: true },
  field_changed: { type: String, required: true },
  old_value: String,
  new_value: { type: String, required: true },
  reason: { type: String, required: true },
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const PlanChangelog = mongoose.model("PlanChangelog", planChangelogSchema, "plan_changelog");
