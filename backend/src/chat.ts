import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { getKnowledgeBlock } from "./knowledge.js";
import { getPersonaBlock } from "./persona.js";
import { getScoutContext } from "./scout-context.js";
import { openaiMessagesToAnthropic, extractSystemText } from "./translate.js";
import { initSSE, writeRoleChunk, writeContentChunk, writeFinishChunk, writeSSEDone, mapStopReason } from "./stream.js";
import type { OpenAIChatRequest, AnthropicSystemBlock } from "./types.js";
import { SCOUT_TOOLS } from "./tools/definitions.js";
import { executeToolCalls } from "./tool-executor.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_TURNS = 5;

/** Validate BACKEND_API_KEY if set. */
function isAuthorized(req: Request): boolean {
  const requiredKey = process.env.BACKEND_API_KEY;
  if (!requiredKey) return true;
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return token === requiredKey;
}

/** Run the Anthropic tool execution loop and return the final response text. */
async function runWithTools(
  baseReq: object,
  messages: MessageParam[],
  userEmail: string | undefined
): Promise<string> {
  const workingMessages = [...messages];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      ...(baseReq as Parameters<typeof anthropic.messages.create>[0]),
      messages: workingMessages,
      tools: SCOUT_TOOLS as Parameters<typeof anthropic.messages.create>[0]["tools"],
      stream: false,
    });

    // No tool calls — return final text
    if (resp.stop_reason !== "tool_use") {
      return resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
    }

    // Execute tool calls
    const toolUseBlocks = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const toolResults = await executeToolCalls(
      toolUseBlocks.map((b) => ({
        type: "tool_use" as const,
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      })),
      userEmail
    );

    workingMessages.push({ role: "assistant", content: resp.content });
    workingMessages.push({ role: "user", content: toolResults });
  }

  return "I was unable to complete that request.";
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: { message: "Unauthorized", type: "auth_error" } });
    return;
  }

  const body = req.body as OpenAIChatRequest;
  const model = body.model || "scout-coach";
  const userEmail = req.headers["x-user-email"] as string | undefined;
  const doStream = body.stream !== false;

  try {
    // Build system blocks (order matters for caching)
    const systemBlocks: AnthropicSystemBlock[] = [
      getKnowledgeBlock(),    // [0] BSA knowledge — cached (ephemeral)
      getPersonaBlock(model), // [1] Agent persona
    ];

    // [2] Per-scout context (dynamic — not cached)
    if (userEmail) {
      const scoutCtx = await getScoutContext(userEmail);
      if (scoutCtx) systemBlocks.push(scoutCtx);
    }

    // [3] LibreChat promptPrefix (system messages from conversation history)
    const systemFromMessages = extractSystemText(body.messages);
    if (systemFromMessages) {
      systemBlocks.push({ type: "text", text: systemFromMessages });
    }

    // Convert OpenAI messages to Anthropic format
    const messages = openaiMessagesToAnthropic(body.messages) as MessageParam[];
    if (messages.length === 0) {
      res.status(400).json({ error: { message: "No messages provided", type: "invalid_request" } });
      return;
    }

    const baseReq = {
      model: ANTHROPIC_MODEL,
      max_tokens: body.max_tokens || 4096,
      system: systemBlocks,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    };

    const requestId = `chatcmpl-${Date.now()}`;

    if (doStream) {
      // Use tool execution loop (may involve non-streaming tool turns),
      // then stream the final text to the client.
      //
      // For simple responses (no tool calls), Anthropic returns in one turn
      // and we fake-stream the result. For tool calls, there's a natural pause
      // during execution which users expect.
      initSSE(res);
      writeRoleChunk(res, requestId, model);

      const finalText = await runWithTools(baseReq, messages, userEmail);

      // Stream the final text
      writeContentChunk(res, requestId, model, finalText);
      writeFinishChunk(res, requestId, model, "stop");
      writeSSEDone(res);
      res.end();
    } else {
      const finalText = await runWithTools(baseReq, messages, userEmail);
      res.json({
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: finalText },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
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
