/**
 * LLM client — wraps the Anthropic SDK for simulator, evaluator, and
 * model-under-test calls.  Tracks token usage for cost accounting.
 */

import Anthropic from "@anthropic-ai/sdk";
import { calculateCost } from "../config.js";
import type { AnthropicToolDef, ToolCallRecord } from "../types.js";

// ---------------------------------------------------------------------------
// Token usage tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolUseBlock {
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolUseBlock[];
  usage: TokenUsage;
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LlmClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Simple text completion (used by scout simulator and evaluator).
   */
  async complete(opts: {
    model: string;
    system: string;
    messages: LlmMessage[];
    maxTokens?: number;
  }): Promise<{ text: string; usage: TokenUsage }> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
    });
    const latencyMs = Date.now() - start;

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      text: textBlock?.text?.trim() || "",
      usage: {
        model: opts.model,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(opts.model, inputTokens, outputTokens),
        latencyMs,
      },
    };
  }

  /**
   * Completion with tool use — sends tools and handles multi-turn tool calls.
   * Returns the full response including any tool_use blocks.
   */
  async completeWithTools(opts: {
    model: string;
    system: string;
    messages: Anthropic.MessageParam[];
    tools: AnthropicToolDef[];
    maxTokens?: number;
  }): Promise<ModelResponse> {
    const start = Date.now();

    const anthropicTools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: opts.messages,
      tools: anthropicTools,
    });
    const latencyMs = Date.now() - start;

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      text: textBlocks.map((b) => b.text).join("\n"),
      toolCalls: toolUseBlocks.map((b) => ({
        name: b.name,
        input: b.input as Record<string, unknown>,
        id: b.id,
      })),
      usage: {
        model: opts.model,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(opts.model, inputTokens, outputTokens),
        latencyMs,
      },
      stopReason: response.stop_reason || "end_turn",
    };
  }

  /**
   * Build Anthropic message param list from tool call results for a
   * multi-turn tool-use loop.
   */
  buildToolResultMessages(
    previousResponse: Anthropic.ContentBlock[],
    toolResults: ToolCallRecord[],
  ): Anthropic.MessageParam[] {
    const assistantContent = previousResponse;
    const toolResultContent: Anthropic.ToolResultBlockParam[] =
      toolResults.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.args._tool_use_id as string,
        content: tr.result,
      }));

    return [
      { role: "assistant" as const, content: assistantContent },
      { role: "user" as const, content: toolResultContent },
    ];
  }
}
