/** Provider registry — resolves model names to provider instances. */

import type { LLMProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";

// ---------------------------------------------------------------------------
// Provider instances (lazy singletons)
// ---------------------------------------------------------------------------

let anthropicProvider: AnthropicProvider | null = null;
let openaiProvider: OpenAICompatProvider | null = null;
let xaiProvider: OpenAICompatProvider | null = null;
let openrouterProvider: OpenAICompatProvider | null = null;

function getAnthropicProvider(): AnthropicProvider {
  if (!anthropicProvider) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set — cannot use Anthropic provider");
    }
    anthropicProvider = new AnthropicProvider();
  }
  return anthropicProvider;
}

function getOpenAIProvider(): OpenAICompatProvider {
  if (!openaiProvider) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set — cannot use OpenAI provider");
    }
    openaiProvider = new OpenAICompatProvider(
      "https://api.openai.com/v1",
      "OPENAI_API_KEY",
    );
  }
  return openaiProvider;
}

function getXAIProvider(): OpenAICompatProvider {
  if (!xaiProvider) {
    if (!process.env.XAI_API_KEY) {
      throw new Error("XAI_API_KEY is not set — cannot use xAI (Grok) provider");
    }
    xaiProvider = new OpenAICompatProvider(
      "https://api.x.ai/v1",
      "XAI_API_KEY",
    );
  }
  return xaiProvider;
}

function getOpenRouterProvider(): OpenAICompatProvider {
  if (!openrouterProvider) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not set — cannot use OpenRouter provider");
    }
    openrouterProvider = new OpenAICompatProvider(
      "https://openrouter.ai/api/v1",
      "OPENROUTER_API_KEY",
      {
        "HTTP-Referer": "https://scout-quest.hexapax.com",
        "X-Title": "Scout Quest",
      },
    );
  }
  return openrouterProvider;
}

// ---------------------------------------------------------------------------
// Default Anthropic model
// ---------------------------------------------------------------------------

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Persona → model mapping
// Persona names without a `:suffix` default to Anthropic.
// ---------------------------------------------------------------------------

const PERSONA_NAMES = new Set([
  "scout-coach",
  "scout-guide",
  "scoutmaster",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedProvider {
  provider: LLMProvider;
  modelId: string;
  providerName: string;
}

/**
 * Resolve a model name (from the request) to a provider instance and API model ID.
 *
 * Routing rules:
 * - Persona names (scout-coach, scout-guide, scoutmaster) without `:suffix` → Anthropic, default model
 * - Persona with suffix (e.g., `scout-coach:grok-3-fast`) → parse suffix, route accordingly
 * - `claude-*` → Anthropic (model name passthrough)
 * - `claude-opus-*` → Anthropic (model name passthrough)
 * - `grok-*` → xAI
 * - `gpt-*` → OpenAI
 * - Contains `/` → OpenRouter (model name passthrough)
 * - Anything else → Anthropic with default model
 */
export function resolveProvider(modelName: string): ResolvedProvider {
  // Handle persona:model syntax
  if (modelName.includes(":")) {
    const colonIdx = modelName.indexOf(":");
    const suffix = modelName.substring(colonIdx + 1);
    // Recurse with the suffix model name to resolve the actual provider
    return resolveProvider(suffix);
  }

  // Persona names without suffix → Anthropic default
  if (PERSONA_NAMES.has(modelName)) {
    return {
      provider: getAnthropicProvider(),
      modelId: DEFAULT_ANTHROPIC_MODEL,
      providerName: "anthropic",
    };
  }

  // Claude models → Anthropic
  if (modelName.startsWith("claude-")) {
    return {
      provider: getAnthropicProvider(),
      modelId: modelName,
      providerName: "anthropic",
    };
  }

  // Grok models → xAI
  if (modelName.startsWith("grok-")) {
    return {
      provider: getXAIProvider(),
      modelId: modelName,
      providerName: "xai",
    };
  }

  // GPT models → OpenAI
  if (modelName.startsWith("gpt-")) {
    return {
      provider: getOpenAIProvider(),
      modelId: modelName,
      providerName: "openai",
    };
  }

  // OpenRouter (model names contain a slash, e.g., "deepseek/deepseek-chat")
  if (modelName.includes("/")) {
    return {
      provider: getOpenRouterProvider(),
      modelId: modelName,
      providerName: "openrouter",
    };
  }

  // Default fallback → Anthropic with default model
  return {
    provider: getAnthropicProvider(),
    modelId: DEFAULT_ANTHROPIC_MODEL,
    providerName: "anthropic",
  };
}
