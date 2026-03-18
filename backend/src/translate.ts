import type { OpenAIMessage, AnthropicMessage, AnthropicTextBlock } from "./types.js";

/** Extract plain text from an OpenAI message's content field. */
function extractText(content: OpenAIMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join("");
}

/** Convert OpenAI messages to Anthropic format. Skips system messages (handled as system blocks). */
export function openaiMessagesToAnthropic(messages: OpenAIMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    // System messages go into system blocks, not the message array
    if (msg.role === "system") continue;
    // Tool messages not supported in Phase 1 — skip
    if (msg.role === "tool") continue;

    const role = msg.role as "user" | "assistant";
    const text = extractText(msg.content);
    if (!text.trim()) continue;

    // Merge consecutive same-role messages (Anthropic requires alternating turns)
    const last = result[result.length - 1];
    if (last && last.role === role) {
      const lastContent = typeof last.content === "string" ? last.content : "";
      last.content = `${lastContent}\n\n${text}`;
    } else {
      result.push({ role, content: text });
    }
  }

  // Anthropic requires messages to start with a user turn
  if (result.length > 0 && result[0].role === "assistant") {
    result.unshift({ role: "user", content: "(conversation continued)" });
  }

  return result;
}

/** Extract system message text from OpenAI messages (promptPrefix from LibreChat). */
export function extractSystemText(messages: OpenAIMessage[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => extractText(m.content))
    .filter(Boolean)
    .join("\n\n");
}
