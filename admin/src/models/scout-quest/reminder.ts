import mongoose, { Schema } from "mongoose";

const reminderSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ["chore", "deadline", "check_in", "diary", "budget_update"],
    required: true,
  },
  message: { type: String, required: true },
  schedule: String,
  last_triggered: Date,
  next_trigger: Date,
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

export const Reminder = mongoose.model("Reminder", reminderSchema, "reminders");
