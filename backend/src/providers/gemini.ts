/** Gemini provider adapter — wraps @google/genai for the LLMProvider interface.
 *
 * Mirrors the structure of anthropic.ts and openai-compat.ts:
 *   - complete() / stream() both return ProviderResponse with tool calls
 *   - buildToolResultMessages() appends a model turn with functionCall parts
 *     followed by a user turn with functionResponse parts (Gemini's convention).
 *
 * API key resolution (first match wins):
 *   1. GEMINI_API_KEY  (preferred — matches backend convention)
 *   2. GOOGLE_API_KEY
 *   3. GOOGLE_KEY      (the env var already used by scripts/)
 */

import { GoogleGenAI } from "@google/genai";
import type {
  Content,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
  Tool,
} from "@google/genai";
import type {
  LLMProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderUsage,
  CanonicalMessage,
} from "./types.js";
import {
  toGeminiTools,
  fromGeminiToolCalls,
  type GeminiFunctionCall,
} from "./tool-format.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Provider class
// ---------------------------------------------------------------------------

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenAI;

  constructor() {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error(
        "Missing Gemini API key: set GEMINI_API_KEY (or GOOGLE_API_KEY / GOOGLE_KEY)",
      );
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const { model, contents, config } = this.buildRequest(req);

    const resp = await this.client.models.generateContent({
      model,
      contents,
      config,
    });

    return this.parseResponse(resp);
  }

  async stream(
    req: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResponse> {
    const { model, contents, config } = this.buildRequest(req);

    const stream = await this.client.models.generateContentStream({
      model,
      contents,
      config,
    });

    let fullText = "";
    const functionCalls: FunctionCall[] = [];
    let lastFinishReason: string | null = null;
    let lastUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      // Accumulate usage from the final chunk (Gemini emits it on the last frame).
      if (chunk.usageMetadata) {
        lastUsage = extractUsage(chunk);
      }

      const parts = candidate.content?.parts ?? [];
      for (const p of parts) {
        if (typeof p.text === "string" && p.text.length > 0) {
          fullText += p.text;
          onText(p.text);
        }
        if (p.functionCall) {
          functionCalls.push(p.functionCall);
        }
      }

      if (candidate.finishReason) {
        lastFinishReason = String(candidate.finishReason);
      }
    }

    const toolCalls = fromGeminiToolCalls(
      functionCalls.map(toGeminiFunctionCall),
    );

    return {
      text: fullText,
      toolCalls,
      stopReason: toolCalls.length > 0
        ? "tool_use"
        : mapFinishReason(lastFinishReason),
      usage: lastUsage,
      rawAssistantContent: functionCalls.length > 0 ? functionCalls : undefined,
    };
  }

  buildToolResultMessages(
    prevMessages: CanonicalMessage[],
    assistantResponse: ProviderResponse,
    toolResults: Array<{ toolCallId: string; result: string }>,
  ): CanonicalMessage[] {
    // Gemini convention:
    //   model turn   — parts include functionCall[] (and optional text)
    //   user turn    — parts include functionResponse[] with matching name
    // We store these as CanonicalMessage using a tagged shape; buildRequest()
    // recognizes the tag and emits Gemini Content parts verbatim.
    const updated = [...prevMessages];

    const rawCalls =
      (assistantResponse.rawAssistantContent as FunctionCall[] | undefined) ?? [];
    const modelParts: Part[] = [];
    if (assistantResponse.text) {
      modelParts.push({ text: assistantResponse.text });
    }
    for (const fc of rawCalls) {
      modelParts.push({ functionCall: fc });
    }
    updated.push({
      role: "assistant",
      content: (modelParts as unknown) as CanonicalMessage["content"],
    });

    // For tool results we need to match the call name back by id. The
    // ProviderResponse.toolCalls carries the canonical id → name mapping.
    const idToName = new Map<string, string>();
    for (const c of assistantResponse.toolCalls) {
      idToName.set(c.id, c.name);
    }

    const userParts: Part[] = toolResults.map((r) => ({
      functionResponse: {
        name: idToName.get(r.toolCallId) ?? r.toolCallId,
        response: { result: r.result },
      },
    }));
    updated.push({
      role: "user",
      content: (userParts as unknown) as CanonicalMessage["content"],
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildRequest(req: ProviderRequest): {
    model: string;
    contents: Content[];
    config: GenerateContentConfig;
  } {
    const model = req.model || DEFAULT_MODEL;

    // Build system instruction: Gemini takes a ContentUnion; a plain string
    // is accepted and is how the Python eval engine already talks to Gemini.
    const systemInstruction = req.systemPrompt || undefined;

    // Convert messages to Gemini Content[]
    const contents = req.messages.map((m) => canonicalToGeminiContent(m));

    // Convert canonical tools to Gemini function declarations. Use
    // parametersJsonSchema (not parameters) so the canonical JSON Schema
    // passes through without needing Gemini's trimmed-down Schema type.
    const functionDeclarations = toGeminiTools(req.tools).map<FunctionDeclaration>((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    }));

    const config: GenerateContentConfig = {
      maxOutputTokens: req.maxTokens,
    };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (req.temperature !== undefined) config.temperature = req.temperature;
    if (functionDeclarations.length > 0) {
      const tool: Tool = { functionDeclarations };
      config.tools = [tool];
    }

    return { model, contents, config };
  }

  private parseResponse(resp: GenerateContentResponse): ProviderResponse {
    const candidate = resp.candidates?.[0];
    if (!candidate || !candidate.content) {
      return {
        text: "",
        toolCalls: [],
        stopReason: "end",
        usage: extractUsage(resp),
      };
    }

    const parts = candidate.content.parts ?? [];

    let text = "";
    const functionCalls: FunctionCall[] = [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text.length > 0) {
        text += p.text;
      }
      if (p.functionCall) {
        functionCalls.push(p.functionCall);
      }
    }

    const toolCalls = fromGeminiToolCalls(
      functionCalls.map(toGeminiFunctionCall),
    );

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0
        ? "tool_use"
        : mapFinishReason(candidate.finishReason ? String(candidate.finishReason) : null),
      usage: extractUsage(resp),
      rawAssistantContent: functionCalls.length > 0 ? functionCalls : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

function resolveApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || process.env.GOOGLE_KEY
    || undefined
  );
}

/** Convert a CanonicalMessage into a Gemini Content turn.
 *
 * The chat handler stores three shapes in CanonicalMessage:
 *   1. role + string content (plain user/assistant text)
 *   2. role + ContentBlock[] (text blocks, possibly with images)
 *   3. role + Gemini Part[] (after buildToolResultMessages() — pass through)
 */
function canonicalToGeminiContent(msg: CanonicalMessage): Content {
  const role = msg.role === "assistant" ? "model" : "user";

  // Case 3: buildToolResultMessages() already stored Gemini parts.
  // Detect by checking for Part-shaped properties.
  if (Array.isArray(msg.content)) {
    const asParts = msg.content as unknown as Part[];
    const looksLikeGeminiPart = asParts.every(
      (p) => p && (("functionCall" in p) || ("functionResponse" in p) || ("text" in p)),
    );
    if (looksLikeGeminiPart) {
      return { role, parts: asParts };
    }

    // Case 2: canonical ContentBlock[]
    const parts: Part[] = msg.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => ({ text: b.text as string }));
    return { role, parts };
  }

  // Case 1: plain string
  return {
    role,
    parts: [{ text: (msg.content as string) || "" }],
  };
}

function toGeminiFunctionCall(fc: FunctionCall): GeminiFunctionCall {
  return {
    name: fc.name ?? "",
    args: (fc.args as Record<string, unknown>) ?? {},
  };
}

function extractUsage(resp: GenerateContentResponse): ProviderUsage {
  const u = resp.usageMetadata;
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    cacheReadTokens: u?.cachedContentTokenCount ?? 0,
  };
}

function mapFinishReason(
  reason: string | null,
): ProviderResponse["stopReason"] {
  if (!reason) return "end";
  if (reason === "MAX_TOKENS") return "max_tokens";
  // Gemini returns "STOP" on normal completion; anything else maps to "end"
  // (errors are raised by the SDK before we get here).
  return "end";
}
