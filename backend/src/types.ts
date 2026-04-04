// OpenAI API types (subset used by LibreChat → backend requests)

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  // ElevenLabs Conversational AI fields
  user_id?: string;
  elevenlabs_extra_body?: Record<string, unknown>;
}

// Anthropic API types (subset)

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicTextBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
  stream?: boolean;
  temperature?: number;
}
