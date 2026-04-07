/** Convert between canonical tool format and provider-specific formats. */

import type { CanonicalTool, ProviderToolCall } from "./types.js";

// ---------------------------------------------------------------------------
// OpenAI function calling format
// ---------------------------------------------------------------------------

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Convert canonical tools to OpenAI function calling format. */
export function toOpenAITools(tools: CanonicalTool[]): OpenAIToolDef[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Convert OpenAI tool_calls to canonical ProviderToolCall[]. */
export function fromOpenAIToolCalls(calls: OpenAIToolCall[]): ProviderToolCall[] {
  return calls.map((c) => ({
    id: c.id,
    name: c.function.name,
    arguments: typeof c.function.arguments === "string"
      ? JSON.parse(c.function.arguments)
      : c.function.arguments,
  }));
}

// ---------------------------------------------------------------------------
// Anthropic format (identity — canonical format IS Anthropic format)
// ---------------------------------------------------------------------------

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Convert Anthropic tool_use blocks to canonical ProviderToolCall[]. */
export function fromAnthropicToolCalls(blocks: AnthropicToolUseBlock[]): ProviderToolCall[] {
  return blocks.map((b) => ({
    id: b.id,
    name: b.name,
    arguments: b.input,
  }));
}

// ---------------------------------------------------------------------------
// Gemini format
// ---------------------------------------------------------------------------

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/** Convert canonical tools to Gemini FunctionDeclaration format. */
export function toGeminiTools(tools: CanonicalTool[]): GeminiFunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

/** Convert Gemini FunctionCall parts to canonical ProviderToolCall[]. */
export function fromGeminiToolCalls(calls: GeminiFunctionCall[]): ProviderToolCall[] {
  return calls.map((c, i) => ({
    id: `gemini-tc-${Date.now()}-${i}`,
    name: c.name,
    arguments: c.args ?? {},
  }));
}
