import mongoose, { Schema } from "mongoose";

const roleSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["superuser", "admin", "adult_readonly", "parent", "scout", "test_scout"],
      required: true,
    },
    troop: String,
    scout_emails: [String],
    test_account: Boolean,
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, index: true },
    roles: { type: [roleSchema], default: [] },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const User = mongoose.model("User", userSchema, "users");
