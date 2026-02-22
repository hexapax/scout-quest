import mongoose, { Schema } from "mongoose";

const choreLogSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  chores_completed: [String],
  income_earned: { type: Number, default: 0 },
  notes: String,
  created_at: { type: Date, default: Date.now },
});

export const ChoreLog = mongoose.model("ChoreLog", choreLogSchema, "chore_logs");
