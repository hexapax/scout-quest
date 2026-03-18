import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getKnowledgeBlock } from "./knowledge.js";
import { getPersonaBlock } from "./persona.js";
import { getScoutContext } from "./scout-context.js";
import { openaiMessagesToAnthropic, extractSystemText } from "./translate.js";
import { initSSE, writeRoleChunk, writeContentChunk, writeFinishChunk, writeSSEDone, mapStopReason } from "./stream.js";
import type { OpenAIChatRequest, AnthropicSystemBlock } from "./types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANTHROPIC_MODEL = "claude-sonnet-4-6";

/** Validate BACKEND_API_KEY if set. */
function isAuthorized(req: Request): boolean {
  const requiredKey = process.env.BACKEND_API_KEY;
  if (!requiredKey) return true; // No key configured = open (dev mode)
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return token === requiredKey;
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: { message: "Unauthorized", type: "auth_error" } });
    return;
  }

  const body = req.body as OpenAIChatRequest;
  const model = body.model || "scout-coach";
  const userEmail = req.headers["x-user-email"] as string | undefined;
  const stream = body.stream !== false;

  try {
    // Build system blocks (order matters for caching)
    const systemBlocks: AnthropicSystemBlock[] = [
      getKnowledgeBlock(),   // [0] BSA knowledge — cached
      getPersonaBlock(model), // [1] Agent persona
    ];

    // [2] Per-scout context (dynamic — not cached)
    if (userEmail) {
      const scoutCtx = await getScoutContext(userEmail);
      if (scoutCtx) systemBlocks.push(scoutCtx);
    }

    // [3] LibreChat promptPrefix (system messages from the conversation)
    const systemFromMessages = extractSystemText(body.messages);
    if (systemFromMessages) {
      systemBlocks.push({ type: "text", text: systemFromMessages });
    }

    // Convert messages
    const messages = openaiMessagesToAnthropic(body.messages);
    if (messages.length === 0) {
      res.status(400).json({ error: { message: "No messages provided", type: "invalid_request" } });
      return;
    }

    const anthropicReq = {
      model: ANTHROPIC_MODEL,
      max_tokens: body.max_tokens || 4096,
      system: systemBlocks,
      messages,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    };

    const requestId = `chatcmpl-${Date.now()}`;

    if (stream) {
      initSSE(res);
      writeRoleChunk(res, requestId, model);

      const streamResp = await anthropic.messages.create({ ...anthropicReq, stream: true });

      for await (const event of streamResp) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          writeContentChunk(res, requestId, model, event.delta.text);
        } else if (event.type === "message_delta" && event.delta.stop_reason) {
          writeFinishChunk(res, requestId, model, mapStopReason(event.delta.stop_reason));
        }
      }

      writeSSEDone(res);
      res.end();
    } else {
      const response = await anthropic.messages.create(anthropicReq);
      const content = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");

      res.json({
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            logprobs: null,
            finish_reason: mapStopReason(response.stop_reason),
          },
        ],
        usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      });
    }
  } catch (err: unknown) {
    console.error("Chat handler error:", err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: { message, type: "server_error" } });
    }
  }
}
