/** OpenAI-compatible provider adapter — works for OpenAI, xAI (Grok), and OpenRouter. */

import type {
  LLMProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderUsage,
  CanonicalMessage,
  ProviderToolCall,
} from "./types.js";
import { toOpenAITools, fromOpenAIToolCalls, type OpenAIToolCall } from "./tool-format.js";

// ---------------------------------------------------------------------------
// Types for OpenAI chat completions API
// ---------------------------------------------------------------------------

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OAIChoice {
  index: number;
  message?: {
    role: string;
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OAIResponse {
  id: string;
  choices: OAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// ---------------------------------------------------------------------------
// Provider class
// ---------------------------------------------------------------------------

export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private baseUrl: string,
    private apiKeyEnvVar: string,
    private extraHeaders?: Record<string, string>,
  ) {}

  private getApiKey(): string {
    const key = process.env[this.apiKeyEnvVar];
    if (!key) {
      throw new Error(
        `Missing API key: environment variable ${this.apiKeyEnvVar} is not set`,
      );
    }
    return key;
  }

  private buildMessages(req: ProviderRequest): OAIMessage[] {
    const msgs: OAIMessage[] = [];

    // System prompt as first message
    if (req.systemPrompt) {
      msgs.push({ role: "system", content: req.systemPrompt });
    }

    // Convert canonical messages to OpenAI format.
    // Messages from buildToolResultMessages() are already in OpenAI shape
    // (assistant with tool_calls, or role:"tool" with tool_call_id) — pass through.
    for (const m of req.messages) {
      const raw = m as unknown as Record<string, unknown>;

      // Pass through OpenAI-shaped messages from buildToolResultMessages()
      if (raw.tool_calls || raw.tool_call_id || raw.role === "tool") {
        msgs.push(raw as unknown as OAIMessage);
        continue;
      }

      // Normal text conversion (string, ContentBlock[], or null)
      let content: string;
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("");
      } else {
        content = "";
      }
      msgs.push({ role: m.role, content });
    }

    return msgs;
  }

  private buildHeaders(req: ProviderRequest): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.getApiKey()}`,
    };

    // Extra static headers (e.g., OpenRouter site headers)
    if (this.extraHeaders) {
      Object.assign(headers, this.extraHeaders);
    }

    // xAI conversation-level cache stickiness
    if (req.conversationId) {
      headers["x-grok-conv-id"] = req.conversationId;
    }

    return headers;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.buildMessages(req),
      max_tokens: req.maxTokens,
      stream: false,
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;

    const tools = toOpenAITools(req.tools);
    if (tools.length > 0) body.tools = tools;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(req),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compat API error ${response.status}: ${errText.substring(0, 500)}`,
      );
    }

    const data = (await response.json()) as OAIResponse;
    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new Error("No choice in OpenAI-compat response");
    }

    const text = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls
      ? fromOpenAIToolCalls(choice.message.tool_calls)
      : [];

    return {
      text,
      toolCalls,
      stopReason: mapFinishReason(choice.finish_reason),
      usage: extractUsage(data.usage),
      rawAssistantContent: choice.message.tool_calls ?? undefined,
    };
  }

  async stream(
    req: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.buildMessages(req),
      max_tokens: req.maxTokens,
      stream: true,
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;

    const tools = toOpenAITools(req.tools);
    if (tools.length > 0) body.tools = tools;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(req),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compat stream error ${response.status}: ${errText.substring(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new Error("No response body for OpenAI-compat stream");
    }

    // Parse SSE stream
    let fullText = "";
    let finishReason: string | null = null;
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6); // Remove "data: "
        if (payload === "[DONE]") continue;

        let chunk: OAIResponse;
        try {
          chunk = JSON.parse(payload) as OAIResponse;
        } catch {
          continue; // Skip malformed chunks
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          fullText += delta.content;
          onText(delta.content);
        }

        // Tool calls come in pieces across multiple chunks
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallAccum.get(tc.index);
            if (existing) {
              // Append argument fragments
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              toolCallAccum.set(tc.index, {
                id: tc.id ?? `tc-${tc.index}`,
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            }
          }
        }

        // Capture finish reason
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
    }

    // Assemble tool calls from accumulated fragments
    const toolCalls: ProviderToolCall[] = [];
    const rawToolCalls: OpenAIToolCall[] = [];
    for (const [, tc] of toolCallAccum) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        console.warn(
          `[openai-compat] Failed to parse tool call arguments for ${tc.name}:`,
          tc.arguments?.substring(0, 200),
        );
      }
      toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
      rawToolCalls.push({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      });
    }

    return {
      text: fullText,
      toolCalls,
      stopReason: mapFinishReason(finishReason),
      usage: { inputTokens: 0, outputTokens: 0 }, // SSE streams rarely include usage
      rawAssistantContent: rawToolCalls.length > 0 ? rawToolCalls : undefined,
    };
  }

  buildToolResultMessages(
    prevMessages: CanonicalMessage[],
    assistantResponse: ProviderResponse,
    toolResults: Array<{ toolCallId: string; result: string }>,
  ): CanonicalMessage[] {
    // OpenAI format: assistant message with tool_calls, then one "tool" message per result.
    // We store these as CanonicalMessage with content carrying the provider-specific structure.
    const updated = [...prevMessages];

    // Assistant message with tool_calls
    const rawToolCalls = assistantResponse.rawAssistantContent as
      | OpenAIToolCall[]
      | undefined;
    const assistantMsg: Record<string, unknown> = {
      role: "assistant",
      content: assistantResponse.text || null,
    };
    if (rawToolCalls && rawToolCalls.length > 0) {
      assistantMsg.tool_calls = rawToolCalls;
    }
    updated.push(assistantMsg as unknown as CanonicalMessage);

    // One tool result message per tool call
    for (const r of toolResults) {
      updated.push({
        role: "tool" as CanonicalMessage["role"],
        content: r.result,
        tool_call_id: r.toolCallId,
      } as unknown as CanonicalMessage);
    }

    return updated;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapFinishReason(
  reason: string | null | undefined,
): ProviderResponse["stopReason"] {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end"; // "stop" or null → end
}

function extractUsage(
  raw: OAIResponse["usage"] | undefined,
): ProviderUsage {
  return {
    inputTokens: raw?.prompt_tokens ?? 0,
    outputTokens: raw?.completion_tokens ?? 0,
  };
}
