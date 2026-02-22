import { Schema } from "mongoose";
import { libreChatDb } from "../connections.js";

const conversationSchema = new Schema(
  {
    conversationId: { type: String, index: true },
    title: String,
    user: { type: String, index: true },
    endpoint: String,
    model: String,
    chatGptLabel: String,
    promptPrefix: String,
    createdAt: Date,
    updatedAt: Date,
  },
  { collection: "conversations", strict: false }
);

export const Conversation = libreChatDb.model("Conversation", conversationSchema);
