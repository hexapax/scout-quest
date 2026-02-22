import mongoose, { Schema } from "mongoose";

const sessionNoteSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  session_date: { type: Date, required: true, index: true },
  source: { type: String, enum: ["agent", "cron"], required: true },
  topics_discussed: [String],
  progress_made: String,
  pending_items: [String],
  next_session_focus: String,
}, { timestamps: { createdAt: "created_at", updatedAt: false } });

export const SessionNote = mongoose.model("SessionNote", sessionNoteSchema, "session_notes");
