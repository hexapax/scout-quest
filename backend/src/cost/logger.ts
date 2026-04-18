/**
 * Production cost logging — writes one `message_usage` doc per assistant
 * message. Designed for two consumers:
 *
 *   - Per-user / per-scout / per-troop spend dashboards (admin)
 *   - Future quota enforcement (out of scope for alpha; just log first)
 *
 * Schema mirrors `eval_usage` plus the attribution fields that production
 * adds (userEmail, scoutEmail, troopId, conversationId, channel, latency_ms,
 * toolCalls). The `source: "prod"` discriminator distinguishes prod rows
 * from eval rows when we eventually merge collections.
 *
 * Failures here are non-fatal — we never want a logging miss to break a
 * user request, so callers should fire-and-forget (await is optional).
 */

import { getScoutQuestDb } from "../db.js";
import { computeCostUsd, getPricingMeta, type UsageTokens } from "./pricing.js";

export interface LoggedToolCall {
  name: string;
  /** Whether the tool dispatch returned a result (vs. errored). */
  success: boolean;
}

export interface LogUsageInput {
  /** Authenticated user email. May be null for fully anonymous (rare). */
  userEmail: string | null;
  /** When an admin is emulating a scout, the emulated scout's email. */
  scoutEmail: string | null;
  troopId: string | null;
  /** Future Stream B: real conversation ID. Currently always null. */
  conversationId: string | null;
  /** "chat" or "voice" — voice sessions hit the same handler with elevenlabs_extra_body. */
  channel: "chat" | "voice";
  /** Provider name as resolved by `providers/registry.ts` (e.g., "anthropic"). */
  provider: string;
  /** The exact API model id sent to the provider (e.g., "claude-opus-4-7"). */
  modelExact: string;
  /** The model name in the request (e.g., "scoutmaster:claude-opus-4-7"). */
  requestedModel: string;
  /** Token usage from the *final* provider response in a multi-turn loop. */
  usage: UsageTokens;
  /** Wall-clock ms from request handler entry to response end. */
  latencyMs: number;
  /** Tool calls executed during this request (across all turns). */
  toolCalls: LoggedToolCall[];
  /** Resolved role at request time — useful for slicing spend by audience. */
  role: string;
}

const COLLECTION_NAME = "message_usage";

/**
 * Write a single usage row. Never throws — errors are logged and swallowed
 * because cost logging must never break a user-visible request.
 */
export async function logUsage(input: LogUsageInput): Promise<void> {
  try {
    const cost = computeCostUsd(input.modelExact, input.usage);
    const pricingMeta = getPricingMeta();
    const doc = {
      source: "prod" as const,
      createdAt: new Date(),
      userEmail: input.userEmail,
      scoutEmail: input.scoutEmail,
      troopId: input.troopId,
      conversationId: input.conversationId,
      channel: input.channel,
      role: input.role,
      provider: input.provider,
      modelExact: input.modelExact,
      requestedModel: input.requestedModel,
      promptTokens: input.usage.inputTokens,
      completionTokens: input.usage.outputTokens,
      cacheCreationTokens: input.usage.cacheCreationTokens ?? 0,
      cacheReadTokens: input.usage.cacheReadTokens ?? 0,
      totalTokens:
        input.usage.inputTokens +
        input.usage.outputTokens,
      costUsd: cost,
      latencyMs: input.latencyMs,
      toolCallCount: input.toolCalls.length,
      toolCalls: input.toolCalls,
      pricingSource: pricingMeta,
    };

    const db = getScoutQuestDb();
    await db.collection(COLLECTION_NAME).insertOne(doc);

    // Single-line structured log for ad-hoc cost queries via grep before the
    // viewer ships in Stream F.
    console.log(
      JSON.stringify({
        event: "message_usage",
        userEmail: input.userEmail,
        scoutEmail: input.scoutEmail,
        role: input.role,
        channel: input.channel,
        model: input.modelExact,
        costUsd: cost,
        promptTokens: input.usage.inputTokens,
        completionTokens: input.usage.outputTokens,
        cacheReadTokens: input.usage.cacheReadTokens ?? 0,
        cacheCreationTokens: input.usage.cacheCreationTokens ?? 0,
        latencyMs: input.latencyMs,
        toolCallCount: input.toolCalls.length,
      }),
    );
  } catch (err) {
    // Don't break the user request because cost logging fell over.
    console.error(
      "[cost] logUsage failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
