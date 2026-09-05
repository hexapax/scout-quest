/** Provider registry — resolves model names to provider instances. */

import type { LLMProvider } from "./types.js";
import { AnthropicProvider, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";
import { GeminiProvider } from "./gemini.js";

// ---------------------------------------------------------------------------
// Provider instances (lazy singletons)
// ---------------------------------------------------------------------------

let anthropicProvider: AnthropicProvider | null = null;
let openaiProvider: OpenAICompatProvider | null = null;
let xaiProvider: OpenAICompatProvider | null = null;
let openrouterProvider: OpenAICompatProvider | null = null;
let geminiProvider: GeminiProvider | null = null;

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

function getGeminiProvider(): GeminiProvider {
  if (!geminiProvider) {
    const hasKey = process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.GOOGLE_KEY
      || process.env.GEMINI_KEY;   // the name the scout-quest stack actually sets
    if (!hasKey) {
      throw new Error(
        "No Gemini API key set — expected GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_KEY, or GEMINI_KEY",
      );
    }
    geminiProvider = new GeminiProvider();
  }
  return geminiProvider;
}

// ---------------------------------------------------------------------------
// Default Anthropic model
// ---------------------------------------------------------------------------

// Single source of truth lives in anthropic.ts; imported here so the two never drift.
const DEFAULT_ANTHROPIC_MODEL = ANTHROPIC_DEFAULT_MODEL;

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
// Ops override for the persona default
// ---------------------------------------------------------------------------

/**
 * DEFAULT_CHAT_MODEL lets ops re-point the bare persona names (scout-coach,
 * scout-guide, scoutmaster) at a non-Anthropic model without touching client
 * code. The app always sends a bare persona name unless the user picked a
 * model in Settings, so this is the only knob that changes what "default"
 * means for every user at once.
 *
 * Added 2026-09-05 when the Anthropic account ran out of credits (every
 * default-persona request had been failing with a 400 since 2026-08-09) while
 * the Gemini and OpenAI keys on the same box still worked. Set it to a model
 * suffix the resolver understands, e.g. `gemini-2.5-flash` or `gpt-4.1-mini`.
 * Leave it empty to keep the Anthropic default.
 *
 * Only bare persona names are rewritten. An explicit `persona:model` from the
 * user, or a raw provider model id, is always honored as sent.
 */
export function applyDefaultChatModel(modelName: string): string {
  const override = (process.env.DEFAULT_CHAT_MODEL || "").trim();
  if (!override) return modelName;
  if (!PERSONA_NAMES.has(modelName)) return modelName;
  // Refuse a value that would just loop back to a persona name.
  if (PERSONA_NAMES.has(override) || override.includes(":")) return modelName;
  return `${modelName}:${override}`;
}

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
 * - `gemini-*` → Google Gemini
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

  // Gemini models → Google Gemini
  if (modelName.startsWith("gemini-")) {
    return {
      provider: getGeminiProvider(),
      modelId: modelName,
      providerName: "google",
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
