/** Temporary store for chat history, user identity, and tool events for voice sessions. */

let voiceContext: {
  messages: Array<{role: string; content: string}>;
  emulateEmail?: string;
  userEmail?: string;
  ts: number;
} | null = null;

/** Tool events buffer — appended during voice LLM calls, polled by client. */
let toolEventBuffer: Array<{ type: string; name: string; input?: unknown; result?: unknown; ts: number }> = [];
let toolEventCursor = 0; // client tracks what it's already seen

export function setVoiceContext(
  messages: Array<{role: string; content: string}>,
  opts?: { emulateEmail?: string; userEmail?: string }
): void {
  voiceContext = { messages, ts: Date.now(), ...opts };
  console.log(`[voice-ctx] Stored ${messages.length} messages, emulate=${opts?.emulateEmail || 'none'}, user=${opts?.userEmail || 'none'}`);
}

/** Get stored voice context (expires after 5 min). */
export function getVoiceContext(): typeof voiceContext {
  if (!voiceContext) return null;
  if (Date.now() - voiceContext.ts > 5 * 60 * 1000) { voiceContext = null; return null; }
  return voiceContext;
}

/** Append a tool event for the client to pick up. */
export function pushToolEvent(name: string, type: "call" | "result", input?: unknown, result?: unknown): void {
  toolEventBuffer.push({ type, name, input, result, ts: Date.now() });
  // Keep buffer bounded
  if (toolEventBuffer.length > 100) toolEventBuffer = toolEventBuffer.slice(-50);
}

/** Get tool events since a cursor. Returns events + new cursor. */
export function getToolEvents(since = 0): { events: typeof toolEventBuffer; cursor: number } {
  const events = toolEventBuffer.filter(e => e.ts > since);
  return { events, cursor: Date.now() };
}

/** Clear tool events (called when voice session starts). */
export function clearToolEvents(): void {
  toolEventBuffer = [];
}
