import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema({
  admin_email: { type: String, required: true, index: true },
  action: { type: String, required: true, enum: ["create", "update", "delete"] },
  resource: { type: String, required: true },
  record_id: { type: String, required: true },
  old_value: Schema.Types.Mixed,
  new_value: Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now, index: true },
});

export const AuditLog = mongoose.model("AuditLog", auditLogSchema, "admin_audit_log");
