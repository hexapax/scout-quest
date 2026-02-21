import mongoose, { Schema } from "mongoose";

const emailSentSchema = new Schema({
  scout_email: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  to: { type: String, required: true },
  cc: [String],
  subject: { type: String, required: true },
  context: String,
});

export const EmailSent = mongoose.model("EmailSent", emailSentSchema, "emails_sent");
