import type { ResourceWithOptions } from "adminjs";
import { Conversation, Message, LibreChatUser } from "../models/librechat/index.js";

// All LibreChat resources are read-only
const readOnly = {
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  new: { isAccessible: false },
};

export const libreChatResources: ResourceWithOptions[] = [
  {
    resource: Conversation,
    options: {
      navigation: { name: "LibreChat", icon: "MessageCircle" },
      listProperties: ["title", "user", "endpoint", "model", "createdAt"],
      filterProperties: ["user", "endpoint", "model"],
      actions: readOnly,
    },
  },
  {
    resource: Message,
    options: {
      navigation: { name: "LibreChat", icon: "MessageCircle" },
      listProperties: ["conversationId", "sender", "model", "isCreatedByUser", "createdAt"],
      filterProperties: ["conversationId", "sender", "model", "isCreatedByUser"],
      showProperties: ["messageId", "conversationId", "sender", "text", "model", "endpoint", "isCreatedByUser", "createdAt"],
      actions: readOnly,
    },
  },
  {
    resource: LibreChatUser,
    options: {
      navigation: { name: "LibreChat", icon: "MessageCircle" },
      listProperties: ["name", "email", "provider", "role", "createdAt"],
      actions: readOnly,
    },
  },
];
