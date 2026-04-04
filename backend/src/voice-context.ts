/** Temporary store for chat history and user identity to inject into voice sessions. */

let voiceContext: {
  messages: Array<{role: string; content: string}>;
  emulateEmail?: string;
  userEmail?: string;
  ts: number;
} | null = null;

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
