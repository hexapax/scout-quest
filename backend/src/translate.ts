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

/** Check if content has images. */
function hasImages(content: OpenAIMessage["content"]): boolean {
  if (!content || typeof content === "string") return false;
  return content.some((p) => p.type === "image_url");
}

/** Convert OpenAI content parts to Anthropic content blocks (text + images). */
function toAnthropicContent(content: OpenAIMessage["content"]): Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> {
  if (!content || typeof content === "string") return [{ type: "text", text: content || "" }];
  const blocks: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      // data:image/jpeg;base64,/9j/4AAQ... → extract media_type and base64
      const match = part.image_url.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
      }
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
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

    // If message has images, use multipart content blocks
    if (hasImages(msg.content)) {
      result.push({ role, content: toAnthropicContent(msg.content) as AnthropicTextBlock[] });
      continue;
    }

    const text = extractText(msg.content);
    if (!text.trim()) continue;

    // Merge consecutive same-role messages (Anthropic requires alternating turns)
    const last = result[result.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${text}`;
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
