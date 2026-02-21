import { Schema } from "mongoose";
import { libreChatDb } from "../connections.js";

const libreChatUserSchema = new Schema(
  {
    name: String,
    username: String,
    email: { type: String, index: true },
    avatar: String,
    provider: String,
    role: String,
    emailVerified: Boolean,
    createdAt: Date,
    updatedAt: Date,
  },
  { collection: "users", strict: false }
);

export const LibreChatUser = libreChatDb.model("LibreChatUser", libreChatUserSchema);
