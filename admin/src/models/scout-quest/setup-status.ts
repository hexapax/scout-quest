import mongoose, { Schema } from "mongoose";

const setupStatusSchema = new Schema({
  scout_email: { type: String, required: true, unique: true, index: true },
  guide_email: { type: String, required: true, index: true },
  steps: [{
    id: String,
    label: String,
    status: { type: String, enum: ["pending", "complete", "skipped", "delegated_to_scout"] },
    completed_at: Date,
    delegated_at: Date,
  }],
}, { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } });

export const SetupStatus = mongoose.model("SetupStatus", setupStatusSchema, "setup_status");
