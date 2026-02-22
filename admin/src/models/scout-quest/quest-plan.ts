import mongoose, { Schema } from "mongoose";

const questPlanSchema = new Schema({
  scout_email: { type: String, required: true, unique: true, index: true },
  current_priorities: [String],
  strategy_notes: String,
  milestones: [{
    id: String,
    label: String,
    category: { type: String, enum: ["savings", "streak", "requirement", "counselor", "custom"] },
    target_metric: String,
    target_date: Date,
    completed: Boolean,
    completed_date: Date,
    celebrated: Boolean,
  }],
  next_counselor_session: {
    badge: { type: String, enum: ["personal_management", "family_life"] },
    requirements_to_present: [String],
    prep_notes: String,
  },
  scout_observations: {
    engagement_patterns: String,
    attention_notes: String,
    motivation_triggers: String,
    tone_notes: String,
  },
  last_reviewed: Date,
}, { timestamps: { createdAt: false, updatedAt: "updated_at" } });

export const QuestPlan = mongoose.model("QuestPlan", questPlanSchema, "quest_plans");
