import mongoose, { Schema } from "mongoose";

const requirementSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  req_id: { type: String, required: true },
  badge: {
    type: String,
    enum: ["personal_management", "family_life"],
    required: true,
  },
  status: {
    type: String,
    enum: [
      "not_started", "in_progress", "tracking", "blocked",
      "needs_approval", "ready_for_review", "submitted",
      "needs_revision", "signed_off", "completed_prior",
      "excluded", "offered",
    ],
    required: true,
  },
  quest_driven: { type: Boolean, default: false },
  interaction_mode: {
    type: String,
    enum: ["in_person", "video", "email", "digital_submission", "parent_verify"],
  },

  tracking_start_date: Date,
  tracking_duration: {
    days: Number,
    weeks: Number,
  },
  tracking_progress: Number,

  parent_approved: Boolean,
  counselor_approved: Boolean,

  documents: [
    {
      name: String,
      content: String,
      submitted_date: Date,
    },
  ],

  submitted_to_counselor_date: Date,
  counselor_feedback: String,
  signed_off_date: Date,
  signed_off_by: String,

  notes: String,
  updated_at: { type: Date, default: Date.now },
});

requirementSchema.index({ scout_email: 1, req_id: 1 }, { unique: true });

export const Requirement = mongoose.model("Requirement", requirementSchema, "requirements");
