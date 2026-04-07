/** Anthropic provider adapter — wraps @anthropic-ai/sdk for the LLMProvider interface. */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderUsage,
  CanonicalMessage,
} from "./types.js";
import { fromAnthropicToolCalls, type AnthropicToolUseBlock } from "./tool-format.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const model = req.model || DEFAULT_MODEL;

    const resp = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens,
      system: req.systemBlocks as Anthropic.MessageCreateParams["system"],
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as Anthropic.MessageCreateParams["tools"],
      stream: false,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });

    const usage = extractUsage(resp.usage);
    logCache("complete", usage);

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolUseBlocks = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    return {
      text,
      toolCalls: fromAnthropicToolCalls(
        toolUseBlocks as unknown as AnthropicToolUseBlock[],
      ),
      stopReason: mapStopReason(resp.stop_reason),
      usage,
      rawAssistantContent: resp.content,
    };
  }

  async stream(
    req: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResponse> {
    const model = req.model || DEFAULT_MODEL;

    const stream = this.client.messages.stream({
      model,
      max_tokens: req.maxTokens,
      system: req.systemBlocks as Anthropic.MessageCreateParams["system"],
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as Anthropic.MessageCreateParams["tools"],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });

    stream.on("text", onText);

    const finalMessage = await stream.finalMessage();
    const usage = extractUsage(finalMessage.usage);
    logCache("stream", usage);

    const text = finalMessage.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    return {
      text,
      toolCalls: fromAnthropicToolCalls(
        toolUseBlocks as unknown as AnthropicToolUseBlock[],
      ),
      stopReason: mapStopReason(finalMessage.stop_reason),
      usage,
      rawAssistantContent: finalMessage.content,
    };
  }

  buildToolResultMessages(
    prevMessages: CanonicalMessage[],
    assistantResponse: ProviderResponse,
    toolResults: Array<{ toolCallId: string; result: string }>,
  ): CanonicalMessage[] {
    // Anthropic requires the assistant's exact content array (text + tool_use blocks)
    // followed by a user message containing tool_result blocks.
    const updated = [...prevMessages];

    updated.push({
      role: "assistant",
      content: assistantResponse.rawAssistantContent as CanonicalMessage["content"],
    });

    updated.push({
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolCallId,
        content: r.result,
      })) as unknown as CanonicalMessage["content"],
    });

    return updated;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractUsage(raw: unknown): ProviderUsage {
  const u = raw as Record<string, number>;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
  };
}

function logCache(mode: string, usage: ProviderUsage): void {
  console.log(
    `[cache] ${mode} input=${usage.inputTokens} output=${usage.outputTokens} cache_create=${usage.cacheCreationTokens ?? 0} cache_read=${usage.cacheReadTokens ?? 0}`,
  );
}

function mapStopReason(
  reason: string | null | undefined,
): ProviderResponse["stopReason"] {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end";
}
