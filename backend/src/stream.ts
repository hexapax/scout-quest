import type { Response } from "express";

/** Set SSE response headers and flush. */
export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();
}

/** Write a content delta chunk in OpenAI SSE format. */
export function writeContentChunk(
  res: Response,
  id: string,
  model: string,
  content: string
): void {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, logprobs: null, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Write the opening chunk (role announcement). */
export function writeRoleChunk(res: Response, id: string, model: string): void {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Write the finish chunk. */
export function writeFinishChunk(
  res: Response,
  id: string,
  model: string,
  finishReason: string
): void {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Write a tool call event (custom extension for the app UI). */
export function writeToolCallChunk(
  res: Response,
  toolName: string,
  toolInput: unknown,
  toolId: string
): void {
  const event = {
    type: "tool_call",
    tool_call: { id: toolId, name: toolName, input: toolInput },
  };
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Write a tool result event. */
export function writeToolResultChunk(
  res: Response,
  toolId: string,
  toolName: string,
  result: unknown
): void {
  const event = {
    type: "tool_result",
    tool_result: { id: toolId, name: toolName, result },
  };
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Write the stream terminator. */
export function writeSSEDone(res: Response): void {
  res.write("data: [DONE]\n\n");
}

/** Map Anthropic stop reasons to OpenAI finish reasons. */
export function mapStopReason(reason: string | null | undefined): string {
  if (!reason) return "stop";
  if (reason === "end_turn") return "stop";
  if (reason === "max_tokens") return "length";
  return "stop";
}
