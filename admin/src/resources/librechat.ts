import type { ResourceWithOptions, ActionResponse, RecordJSON } from "adminjs";
import { Conversation, Message, LibreChatUser } from "../models/librechat/index.js";
import { exportActions } from "./export.js";

// All LibreChat resources are read-only (plus export actions)
const readOnly = {
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  new: { isAccessible: false },
  ...exportActions(),
};

// --- User ID resolution ---

// Cache user lookups to avoid repeated DB queries within a request
const userCache = new Map<string, string>();
const CACHE_TTL = 60_000; // 1 minute
let cacheTime = 0;

async function resolveUserIds(userIds: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  if (now - cacheTime > CACHE_TTL) {
    userCache.clear();
    cacheTime = now;
  }

  const missing = userIds.filter((id) => !userCache.has(id));
  if (missing.length > 0) {
    const users = await LibreChatUser.find({ _id: { $in: missing } }).lean();
    for (const u of users) {
      const display = u.name ? `${u.name} (${u.email})` : (u.email as string) || String(u._id);
      userCache.set(String(u._id), display);
    }
    // Mark unfound IDs so we don't re-query
    for (const id of missing) {
      if (!userCache.has(id)) userCache.set(id, id);
    }
  }

  const result = new Map<string, string>();
  for (const id of userIds) {
    result.set(id, userCache.get(id) || id);
  }
  return result;
}

function resolveUserInRecord(record: RecordJSON, resolved: Map<string, string>) {
  const userId = record.params?.user;
  if (userId && resolved.has(userId)) {
    record.params.user = resolved.get(userId)!;
  }
}

// --- Message summary helpers ---

function getMessageText(params: Record<string, unknown>): string {
  // User messages: text field
  const text = params.text as string | undefined;
  if (text) return text;

  // Assistant messages: content array — params are flattened by AdminJS
  // Look for content.0.text, content.1.text, etc.
  for (let i = 0; i < 10; i++) {
    const ct = params[`content.${i}.text`] as string | undefined;
    if (ct) return ct;
  }
  return "";
}

function formatSummary(params: Record<string, unknown>): string {
  // Timestamp
  const createdAt = params.createdAt as string | undefined;
  let ts = "";
  if (createdAt) {
    const d = new Date(createdAt);
    ts = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // Source
  const isUser = params.isCreatedByUser === true || params.isCreatedByUser === "true";
  const source = isUser ? "User" : ((params.model as string) || (params.sender as string) || "Assistant");

  // Content preview
  const fullText = getMessageText(params);
  const preview = fullText.length > 120 ? fullText.slice(0, 120) + "..." : fullText;

  return `${ts} · ${source}: ${preview}`;
}

// --- Available values for enum filters ---

const endpointValues = [
  { value: "openAI", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "azureOpenAI", label: "Azure OpenAI" },
  { value: "bedrock", label: "Bedrock" },
  { value: "custom", label: "Custom" },
];

const senderValues = [
  { value: "User", label: "User" },
  { value: "ChatGPT", label: "ChatGPT" },
  { value: "Claude", label: "Claude" },
  { value: "BingAI", label: "BingAI" },
  { value: "Google", label: "Google" },
];

const boolValues = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

// --- Resources ---

export const libreChatResources: ResourceWithOptions[] = [
  {
    resource: Conversation,
    options: {
      navigation: { name: "LibreChat", icon: "MessageCircle" },
      listProperties: ["title", "user", "endpoint", "model", "createdAt"],
      filterProperties: ["user", "endpoint", "model"],
      properties: {
        endpoint: { availableValues: endpointValues },
      },
      actions: {
        ...readOnly,
        list: {
          after: async (response: ActionResponse) => {
            if (response.records) {
              const userIds = response.records
                .map((r: RecordJSON) => r.params?.user)
                .filter(Boolean) as string[];
              const resolved = await resolveUserIds([...new Set(userIds)]);
              for (const record of response.records) {
                resolveUserInRecord(record, resolved);
              }
            }
            return response;
          },
        },
        show: {
          after: async (response: ActionResponse) => {
            if (response.record) {
              const userId = response.record.params?.user;
              if (userId) {
                const resolved = await resolveUserIds([userId]);
                resolveUserInRecord(response.record, resolved);
              }
            }
            return response;
          },
        },
        viewMessages: {
          actionType: "record",
          icon: "MessageSquare",
          component: false,
          handler: async (_request, _response, context) => {
            const { record } = context;
            const convId = record?.params?.conversationId;
            return {
              record: record!.toJSON(context.currentAdmin),
              redirectUrl: `/resources/Message?filters.conversationId=${encodeURIComponent(convId)}`,
            };
          },
        },
      },
    },
  },
  {
    resource: Message,
    options: {
      navigation: false, // Access messages through Conversations only
      listProperties: ["summary"],
      filterProperties: ["conversationId", "sender", "model", "isCreatedByUser"],
      showProperties: [
        "messageId", "conversationId", "sender", "text", "content",
        "model", "endpoint", "isCreatedByUser", "createdAt",
      ],
      properties: {
        endpoint: { availableValues: endpointValues },
        sender: { availableValues: senderValues },
        isCreatedByUser: { availableValues: boolValues },
      },
      actions: {
        ...readOnly,
        list: {
          before: async (request) => {
            // Require conversationId filter
            const filters = request.query as Record<string, unknown> | undefined;
            const hasConvFilter = filters?.["filters.conversationId"];
            if (!hasConvFilter) {
              throw new Error(
                "Messages must be viewed through a Conversation. Go to Conversations and click 'View Messages' on a conversation."
              );
            }
            return request;
          },
          after: async (response: ActionResponse) => {
            if (response.records) {
              for (const record of response.records) {
                record.params.summary = formatSummary(record.params);
              }
            }
            return response;
          },
        },
      },
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
