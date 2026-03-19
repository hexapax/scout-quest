/**
 * V2 Backend Adapter — runs evaluation scenarios against the v2 backend
 * via its HTTP API (/v1/chat/completions).
 *
 * Instead of calling Anthropic directly with MCP tool definitions, this
 * sends requests to the deployed backend which handles:
 *   - Knowledge layer injection (system[0])
 *   - Persona injection (system[1])
 *   - Per-scout context injection (system[2])
 *   - Tool execution (get_scout_status, search_bsa_reference, etc.)
 *   - Anthropic API call with caching
 *
 * The harness still uses:
 *   - Scout simulator (Haiku) — generates scout messages
 *   - Evaluator (Sonnet) — scores responses on 7 dimensions
 *   - Cost tracker — monitors API spend
 *
 * Knowledge layer is controlled by the `--knowledge-layer` flag:
 *   L0: Backend runs with empty knowledge block
 *   L1-thin: Backend runs with interim 52K knowledge doc (default/deployed)
 *   L1-full: Backend runs with production 177K doc
 *   L2: Backend runs with 177K + vector retrieval enabled
 *   L3: Backend runs with 177K + vectors + enriched graph
 */

import type { TranscriptMessage, ToolCallRecord } from "./types.js";

export interface V2BackendConfig {
  /** Base URL of the v2 backend, e.g., https://scout-quest.hexapax.com/backend */
  backendUrl: string;
  /** BACKEND_API_KEY for authentication */
  apiKey: string;
  /** Scout email to test as */
  scoutEmail: string;
}

export interface V2ChatResponse {
  text: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

/**
 * Send a chat request to the v2 backend.
 * The backend handles system prompt assembly, tool execution, and caching.
 */
export async function v2Chat(
  config: V2BackendConfig,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 1500,
): Promise<V2ChatResponse> {
  const res = await fetch(`${config.backendUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "X-User-Email": config.scoutEmail,
    },
    body: JSON.stringify({
      model: "scout-coach",
      messages,
      stream: false,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Backend error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
    },
  };
}

/**
 * Run a single knowledge-layer evaluation question against the v2 backend.
 * Returns the response text and cache metrics.
 */
export async function runV2Question(
  config: V2BackendConfig,
  question: string,
): Promise<V2ChatResponse> {
  return v2Chat(config, [{ role: "user", content: question }]);
}
