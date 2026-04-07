/** Provider-agnostic types for multi-LLM support. */

// ---------------------------------------------------------------------------
// System blocks
// ---------------------------------------------------------------------------

export interface SystemBlock {
  type: "text";
  text: string;
  /** If true, provider adapters that support caching should mark this block. */
  cacheControl?: boolean;
  /** Anthropic-specific cache_control passthrough. */
  cache_control?: { type: "ephemeral" };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ContentBlock {
  type: "text" | "image";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
}

export interface CanonicalMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface CanonicalTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider request/response
// ---------------------------------------------------------------------------

export interface ProviderRequest {
  /** Plain text system prompt (concatenated blocks) — for OpenAI-compat providers. */
  systemPrompt: string;
  /** Structured system blocks — for Anthropic (cache_control) and future use. */
  systemBlocks: SystemBlock[];
  /** Conversation messages in provider-agnostic format. */
  messages: CanonicalMessage[];
  /** Tool definitions in canonical format (matches Anthropic's input_schema). */
  tools: CanonicalTool[];
  /** Max output tokens. */
  maxTokens: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Model ID for the provider API (e.g., "claude-sonnet-4-6", "grok-3-fast"). */
  model: string;
  /** Stable conversation ID — used by xAI for cache stickiness via x-grok-conv-id. */
  conversationId?: string;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ProviderResponse {
  /** Concatenated text output from the model. */
  text: string;
  /** Tool calls requested by the model (empty if none). */
  toolCalls: ProviderToolCall[];
  /** Why the model stopped. */
  stopReason: "end" | "tool_use" | "max_tokens";
  /** Token usage metrics. */
  usage: ProviderUsage;
  /** Raw assistant content blocks — needed for Anthropic tool loop (assistant turn). */
  rawAssistantContent?: unknown;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /** Non-streaming call. Returns after complete response. */
  complete(req: ProviderRequest): Promise<ProviderResponse>;

  /** Streaming call. Calls onText for each text delta.
   *  Returns full response (including tool calls) when stream ends. */
  stream(
    req: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResponse>;

  /** Build the messages array for the next tool turn.
   *  Each provider formats assistant+tool_result messages differently. */
  buildToolResultMessages(
    prevMessages: CanonicalMessage[],
    assistantResponse: ProviderResponse,
    toolResults: Array<{ toolCallId: string; result: string }>,
  ): CanonicalMessage[];
}
