import { Schema } from "mongoose";
import { libreChatDb } from "../connections.js";

const messageSchema = new Schema(
  {
    messageId: { type: String, index: true },
    conversationId: { type: String, index: true },
    parentMessageId: String,
    sender: String,
    text: String,
    isCreatedByUser: Boolean,
    model: String,
    endpoint: String,
    user: String,
    createdAt: Date,
    updatedAt: Date,
  },
  { collection: "messages", strict: false }
);

export const Message = libreChatDb.model("Message", messageSchema);
