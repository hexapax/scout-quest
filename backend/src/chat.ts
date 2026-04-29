import type { Request, Response } from "express";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { getKnowledgeBlock } from "./knowledge.js";
import { getPersonaBlock, resolvePersonaByRole } from "./persona.js";
import { getScoutContext } from "./scout-context.js";
import { openaiMessagesToAnthropic, extractSystemText } from "./translate.js";
import { initSSE, writeRoleChunk, writeContentChunk, writeFinishChunk, writeSSEDone, writeToolCallChunk, writeToolResultChunk } from "./stream.js";
import type { OpenAIChatRequest, AnthropicSystemBlock } from "./types.js";
import { getToolsForRole, type UserRole } from "./tools/definitions.js";
import { executeToolCalls } from "./tool-executor.js";
import { getUserFromCookie } from "./routes/auth.js";
import { getVoiceContext, getVoiceConversationId, pushToolEvent } from "./voice-context.js";
import { persistVoiceTurn } from "./voice-persistence.js";
import { captureEpisode, getRecentEpisodes, type Episode } from "./episodes.js";
import { getScoutState } from "./scout-state.js";
import { resolveProvider } from "./providers/registry.js";
import type { ProviderRequest, ProviderResponse, CanonicalMessage } from "./providers/types.js";
import { lookupUserRole } from "./auth/role-lookup.js";
import type { Role } from "./types.js";
import { logUsage, type LoggedToolCall } from "./cost/logger.js";

const MAX_TOOL_TURNS = 5;

async function buildScoutMemoryBlock(scoutEmail: string): Promise<AnthropicSystemBlock | null> {
  // Prefer the rolling summary (Stream G step 1) — it's a Haiku-curated
  // narrative that travels well across many sessions. If a scout doesn't
  // yet have a state doc (cold start), fall back to the most recent
  // episodes — same shape as before, lower fidelity, but better than nothing.
  try {
    const state = await getScoutState(scoutEmail);
    if (state?.rolling_summary && state.rolling_summary.trim().length > 0) {
      return {
        type: "text",
        text:
          `RECENT COACHING CONTEXT — ${scoutEmail}\n\n` +
          `${state.rolling_summary.trim()}\n\n` +
          `(Source: scout-reported observations across ${state.stats.total_sessions} prior sessions, ` +
          `last updated ${state.rolling_summary_updated_at?.toISOString().slice(0, 10) ?? "unknown"}. ` +
          `For authoritative current rank/badge/event totals, call get_scout_status.)`,
      };
    }
  } catch (err) {
    console.error(`[chat] getScoutState failed for ${scoutEmail}:`, err);
    // Fall through to episodes fallback.
  }

  let episodes: Episode[];
  try {
    episodes = await getRecentEpisodes(scoutEmail, 5);
  } catch (err) {
    console.error(`[chat] getRecentEpisodes failed for ${scoutEmail}:`, err);
    return null;
  }
  if (!episodes.length) return null;

  const lines = episodes.map((ep) => {
    const when = ep.timestamp instanceof Date ? ep.timestamp.toISOString().slice(0, 10) : String(ep.timestamp).slice(0, 10);
    const topics = ep.topics?.length ? ep.topics.slice(0, 4).join(", ") : "general";
    const summary = (ep.summary || "(no summary)").trim();
    const unresolved = ep.unresolved?.length ? ep.unresolved.slice(0, 2).join("; ") : null;
    return `- ${when} (${ep.mode}, ${ep.turnCount} turns) — ${topics}\n  Summary: ${summary}` +
      (unresolved ? `\n  Open: ${unresolved}` : "");
  });

  return {
    type: "text",
    text: `PRIOR SESSIONS — ${scoutEmail}\n\n${lines.join("\n")}\n\n` +
      `These are observations from prior conversations, not authoritative state. ` +
      `For current rank/badge/event totals, call get_scout_status.`,
  };
}

/** Validate request authorization. Accepts:
 *  1. Correct BACKEND_API_KEY in Authorization header (LibreChat)
 *  2. Valid sq_session cookie (app.html)
 *  3. Active voice context for ElevenLabs requests (context set by authenticated user)
 */
function isAuthorized(req: Request): boolean {
  const requiredKey = process.env.BACKEND_API_KEY;
  if (!requiredKey) return true; // No key configured = dev mode

  // API key (LibreChat sends this)
  const authHeader = req.headers["authorization"] || "";
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (token === requiredKey) return true;
  }

  // Cookie auth (app.html)
  if (getUserFromCookie(req)) return true;

  // Voice session: ElevenLabs can't send API key or cookie, but a valid
  // voice context proves an authenticated user recently started this session.
  // Voice context expires after 5 min and is set via cookie-authenticated POST.
  const isVoiceRequest = !!req.body?.elevenlabs_extra_body
    || (req.headers["user-agent"] || "").includes("AsyncOpenAI");
  if (isVoiceRequest && getVoiceContext()) return true;

  return false;
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: { message: "Unauthorized", type: "auth_error" } });
    return;
  }

  // Wall-clock timer for cost logging — captures full handler latency including
  // multi-turn tool dispatch, not just the provider RTT.
  const requestStartedAt = Date.now();

  const body = req.body as OpenAIChatRequest;
  const doStream = body.stream !== false;
  const isVoice = !!body.elevenlabs_extra_body || (req.headers["user-agent"] || "").includes("AsyncOpenAI");

  // Domain-aware defaults: admin domain → scoutmaster model, otherwise body.model.
  // Note: Caddy rewrites x-forwarded-host to the actual inbound host, so we also
  // accept an explicit x-eval-admin-mode header (only trusted when BACKEND_API_KEY
  // auth is used) for eval harnesses that need to exercise the leader tool set.
  const host = (req.headers["x-forwarded-host"] || req.hostname || "").toString();
  const hasApiKeyAuth = (() => {
    const required = process.env.BACKEND_API_KEY;
    if (!required) return false;
    const authHeader = (req.headers["authorization"] || "").toString();
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    return token === required;
  })();
  const evalAdminOverride = hasApiKeyAuth && req.headers["x-eval-admin-mode"] === "true";
  const isAdminDomain = host.includes("ai-chat") || host.includes("admin") || evalAdminOverride;
  const model = body.model || (isAdminDomain ? "scoutmaster" : "scout-coach");

  // User email: emulation header > voice context > cookie (app) > header (LibreChat)
  const cookieUser = getUserFromCookie(req);
  const voiceCtx = isVoice ? getVoiceContext() : null;
  const emulateEmail = req.headers["x-emulate-user"] as string | undefined
    || voiceCtx?.emulateEmail;
  const userEmail = emulateEmail || voiceCtx?.userEmail || cookieUser?.email || (req.headers["x-user-email"] as string | undefined);

  const toolsUsedInRequest: string[] = []; // Track for episode capture
  // Rich tool record for eval observability: name + args + result
  const toolCallRecords: Array<{ name: string; args: unknown; result: string }> = [];

  // Resolve the *authenticated* user's role (always from the cookie — never
  // from an emulation header). Emulation is an admin-only privilege; see below.
  const authRoleInfo = cookieUser
    ? await lookupUserRole(cookieUser.email)
    : null;

  // Role for tool filtering and system-block selection.
  //
  // Precedence:
  //   1. Emulation: admin users can emulate a scout via `x-emulate-user`.
  //      In that case we drop to scout-level tools regardless of their own role.
  //   2. Admin domain override: a logged-in admin on ai-chat.* / admin.* keeps
  //      admin tools. A *non-admin* hitting those hosts does NOT get elevated
  //      (hostname is not a trust boundary on its own).
  //   3. Authenticated user's resolved role from the `users` collection.
  //   4. Legacy `scout-guide` model string still promotes anonymous requests
  //      to the guide tool set (LibreChat API-key auth has no user doc).
  //   5. Fallback: "scout" for API-key auth (LibreChat), "unknown" for
  //      cookie-authenticated users without a user doc — those get no tools
  //      and a warning log.
  const isEmulating = !!emulateEmail && (authRoleInfo?.isAdmin ?? false);
  const userCanUseAdminDomain = authRoleInfo?.isAdmin ?? false;
  const effectiveAdminDomain = isAdminDomain && (userCanUseAdminDomain || evalAdminOverride);

  let userRole: UserRole;
  if (effectiveAdminDomain && !isEmulating) {
    userRole = "admin";
  } else if (isEmulating) {
    userRole = "scout";
  } else if (authRoleInfo) {
    // Unknown role → empty tool list. Log it loudly for alpha debugging.
    if (authRoleInfo.role === "unknown") {
      console.warn(
        JSON.stringify({
          event: "role_lookup_unknown",
          email: cookieUser?.email,
          host,
          path: req.path,
          msg: "Cookie-authenticated user has no users-collection doc and is not on the admin allowlist. Tools disabled.",
        })
      );
    }
    userRole = authRoleInfo.role as UserRole;
  } else if (model.includes("guide")) {
    // Legacy: LibreChat API-key auth with the scout-guide model string.
    userRole = "guide";
  } else {
    // API-key auth (LibreChat) without a guide model → default to scout.
    userRole = "scout";
  }
  const activeTools = getToolsForRole(userRole);

  // Keep a Role-typed view for downstream consumers (e.g., persona, logging).
  const resolvedRole: Role | null = authRoleInfo?.role ?? null;
  void resolvedRole; // reserved for stream B/C — do not remove without coordinating

  // Log incoming request for debugging custom LLM integration
  console.log(
    `[chat] model=${model} stream=${doStream} email=${userEmail || "none"} voice=${isVoice} ` +
    `role=${userRole} roleSource=${authRoleInfo?.source || "anonymous"} ` +
    `isAdmin=${authRoleInfo?.isAdmin ?? false} emulating=${isEmulating} ` +
    `messages=${body.messages?.length ?? 0}`
  );
  if (body.messages?.length) {
    for (const m of body.messages.slice(0, 5)) {
      const content = typeof m.content === "string" ? m.content.substring(0, 100) : JSON.stringify(m.content)?.substring(0, 100);
      console.log(`[chat]   [${m.role}] ${content}`);
    }
  }

  try {
    // Models with context windows too small for full knowledge (~177K tokens).
    // These get compact knowledge (~115K tokens) instead.
    // Match against the raw model string (e.g., "scout-coach:deepseek/deepseek-v3.2").
    const COMPACT_KNOWLEDGE_PATTERNS = [
      "deepseek",   // DeepSeek V3/V3.2: 163K context
      "grok-3",     // Grok 3: 131K context
    ];
    const needsCompact = COMPACT_KNOWLEDGE_PATTERNS.some(p => model.includes(p));

    // Resolve persona by role, not model name. Two personas total:
    //   scout-coach  — Woody tone for scouts
    //   adult-guide  — direct tone for parents, leaders, scoutmaster
    // Use-case differentiation comes from the PARENT USER / LEADER CONTEXT
    // blocks appended below, not from a third persona.
    const personaKey = resolvePersonaByRole(userRole);

    // Build system blocks (order matters for caching)
    const systemBlocks: AnthropicSystemBlock[] = [
      getKnowledgeBlock(needsCompact), // [0] BSA knowledge — cached (ephemeral)
      getPersonaBlock(personaKey),      // [1] Agent persona (scout-coach or adult-guide)
    ];
    if (needsCompact) console.log(`[chat] Using compact knowledge for model ${model}`);

    // [2] Per-user context (dynamic — not cached)
    if (userEmail) {
      // Role-composition for context injection.
      //
      // Roles aren't mutually exclusive: a very common pattern in scouting is a
      // parent who registers as an adult leader so they can come on campouts.
      // That user has roles=["parent","leader"]; the legacy primary-role switch
      // would have taken only the leader branch and lost their scouts' context.
      // We now check the full roles[] list and accumulate context blocks.
      const userRoles = authRoleInfo?.roles || [];
      const isScoutUser = userRoles.includes("scout") || userRoles.includes("test_scout");
      const isParentUser = userRoles.includes("parent");
      const isLeaderUser =
        userRoles.includes("leader") ||
        userRoles.includes("admin") ||
        userRoles.includes("superuser");
      const scoutEmails = authRoleInfo?.scoutEmails || [];
      const troopLabel = authRoleInfo?.troop || "2024";

      const scoutCtx = await getScoutContext(userEmail);

      // 1. Scout user — inject their own profile.
      if (scoutCtx && isScoutUser) {
        systemBlocks.push(scoutCtx);
        const ep = await buildScoutMemoryBlock(userEmail);
        if (ep) systemBlocks.push(ep);
      }

      // 2. Parent user — surface their scouts' state regardless of whether they're
      // also a leader. Assistant stays in its coach/scoutmaster persona and speaks
      // TO the parent ABOUT their scout.
      if (isParentUser && scoutEmails.length > 0) {
        const kidContexts = (
          await Promise.all(scoutEmails.map((se) => getScoutContext(se)))
        ).filter((c): c is AnthropicSystemBlock => c !== null);

        systemBlocks.push({
          type: "text",
          text: `PARENT USER — the person chatting with you is the parent of one or more scouts in this troop.\n` +
            `Speak TO the parent about their scout ("your scout", "they") — do not speak AS the parent.\n\n` +
            `Parent email: ${userEmail}\n` +
            `Troop: ${troopLabel}\n` +
            `Their scout(s): ${scoutEmails.join(", ")}\n` +
            (isLeaderUser
              ? `This parent is ALSO a registered adult leader for the troop — see LEADER CONTEXT below.\n`
              : ``) +
            `\n` +
            `Guidance:\n` +
            `- When the parent asks about their scout's progress, look it up with get_scout_status using the scout's email (from the list above) or name.\n` +
            `- Help the parent help their scout with rank advancement, merit badges, upcoming events, chores, and scouting habits.\n` +
            (isLeaderUser
              ? `- As a registered leader, this parent may have write access to Scoutbook via leader tools. Use them if the parent is logging something for their own scout or another scout they're approved to advance.\n`
              : `- This parent has read-only tools. If an advancement needs to be logged in Scoutbook, recommend the scout or a troop leader log it.\n`) +
            `- The scoutbook userId shown in the scout context block(s) below belongs to the SCOUT. The parent may separately have their own Scoutbook userId from an adult leader registration — that's distinct and not captured here.`,
        });
        for (const kid of kidContexts) {
          systemBlocks.push(kid);
        }
        const epBlocks = (
          await Promise.all(scoutEmails.map((se) => buildScoutMemoryBlock(se)))
        ).filter((b): b is AnthropicSystemBlock => b !== null);
        for (const ep of epBlocks) systemBlocks.push(ep);
      }

      // 3. Leader/admin user — inject leader identity and tool guidance.
      if (isLeaderUser) {
        const roleLabel =
          userRoles.includes("admin") || userRoles.includes("superuser")
            ? "Scoutmaster (admin)"
            : "Troop leader";
        systemBlocks.push({
          type: "text",
          text: `LEADER CONTEXT\nEmail: ${userEmail}\nRole: ${roleLabel}\nTroop: ${troopLabel}\n` +
            (isParentUser && scoutEmails.length > 0
              ? `This leader is also a parent — see PARENT USER block above for their scout(s).\n`
              : ``) +
            `\n` +
            `You have access to leader tools. Use troop_insights and session_planner freely.\n` +
            `For individual scout lookups, use get_scout_status with a scout name via get_roster first.\n` +
            `This user may have their own Scoutbook adult-leader userId; it is separate from any scout userId shown in context blocks.`,
        });
      }

      // 4. Fallback: scoutCtx exists but user isn't a scout and isn't a parent-with-scouts.
      // Example: adult_readonly user whose email happens to match a scoutbook parents[] entry.
      if (scoutCtx && !isScoutUser && !(isParentUser && scoutEmails.length > 0)) {
        systemBlocks.push(scoutCtx);
        const ep = await buildScoutMemoryBlock(userEmail);
        if (ep) systemBlocks.push(ep);
      }
    }

    // [3] Voice mode instructions + prior chat context (when called from ElevenLabs ConvAI)
    if (isVoice) {
      let voiceSystemText = `VOICE MODE — your response will be spoken aloud via text-to-speech.
Rules for voice output:
- Keep responses to 1-3 sentences. Be concise and conversational.
- Never use markdown, bullet points, numbered lists, or special formatting.
- Don't say "asterisk" or spell out formatting characters.
- Use natural speech patterns: "first... then... and finally" instead of lists.
- Spell out abbreviations on first use (say "Board of Review" not "BOR").
- If a question needs a long answer, give the key point first and offer to explain more.`;

      // Inject prior chat context so voice continues the conversation
      const priorChat = voiceCtx?.messages;
      if (priorChat && priorChat.length > 0) {
        const lines = priorChat.slice(-20).map(m => {
          const role = m.role === 'assistant' ? 'Scout Coach' : 'User';
          return `${role}: ${m.content.substring(0, 300)}`;
        });
        voiceSystemText += `\n\nPRIOR CONVERSATION (from text chat — continue naturally, don't repeat what was already said):\n${lines.join('\n')}`;
        console.log(`[chat] Injected ${priorChat.length} prior messages into voice context`);
      }

      systemBlocks.push({ type: "text", text: voiceSystemText });
    }

    // [4] LibreChat promptPrefix (system messages from conversation history)
    const systemFromMessages = extractSystemText(body.messages);
    if (systemFromMessages) {
      systemBlocks.push({ type: "text", text: systemFromMessages });
    }

    // Convert OpenAI messages to Anthropic format (canonical for all providers)
    let messages = openaiMessagesToAnthropic(body.messages) as MessageParam[];

    // For voice: prepend prior chat history as actual message turns
    if (isVoice) {
      const priorChat = voiceCtx?.messages;
      if (priorChat && priorChat.length > 0) {
        const priorMessages: MessageParam[] = [];
        for (const m of priorChat) {
          const role = m.role === 'assistant' ? 'assistant' : 'user';
          priorMessages.push({ role, content: m.content } as MessageParam);
        }
        // Ensure alternating turns by merging with ElevenLabs messages
        messages = [...priorMessages, ...messages];
        // Re-merge consecutive same-role messages
        const merged: MessageParam[] = [];
        for (const m of messages) {
          const last = merged[merged.length - 1];
          if (last && last.role === m.role) {
            const lastText = typeof last.content === 'string' ? last.content : '';
            const curText = typeof m.content === 'string' ? m.content : '';
            (last as { role: string; content: string }).content = `${lastText}\n\n${curText}`;
          } else {
            merged.push(m);
          }
        }
        // Ensure starts with user
        if (merged.length > 0 && merged[0].role === 'assistant') {
          merged.unshift({ role: 'user', content: '(continuing from text chat)' } as MessageParam);
        }
        messages = merged;
      }
    }

    console.log(`[chat] Converted ${body.messages?.length ?? 0} OpenAI msgs → ${messages.length} Anthropic msgs`);
    if (messages.length === 0) {
      console.error(`[chat] ERROR: No messages after conversion. Raw messages:`, JSON.stringify(body.messages?.slice(0, 3)));
      res.status(400).json({ error: { message: "No messages provided", type: "invalid_request" } });
      return;
    }

    // Resolve provider from model name
    const { provider, modelId, providerName } = resolveProvider(model);
    console.log(`[chat] Provider: ${providerName}, modelId: ${modelId}`);

    // Build the provider-agnostic request
    const providerReq: ProviderRequest = {
      systemPrompt: systemBlocks.map(b => b.text).join("\n\n=== SECTION BREAK ===\n\n"),
      systemBlocks: systemBlocks as ProviderRequest["systemBlocks"],
      messages: messages as unknown as CanonicalMessage[],
      tools: activeTools as ProviderRequest["tools"],
      maxTokens: body.max_tokens || 16384,
      temperature: body.temperature,
      model: modelId,
      conversationId: body.conversationId ?? undefined,
    };

    const requestId = `chatcmpl-${Date.now()}`;

    // Streaming path tracks the most recent provider response's usage so we
    // can log a single message_usage row after the full multi-turn loop ends.
    let streamLastUsage: ProviderResponse["usage"] | null = null;
    // Accumulate the assistant's streamed text so voice-persistence can write
    // the final assistant message (streaming deltas are fire-and-forget to SSE).
    let streamedAssistantText = "";

    if (doStream) {
      initSSE(res);
      writeRoleChunk(res, requestId, model);

      // Stream with tool loop: stream text tokens, execute tools if needed, repeat.
      try {
        let workingReq = { ...providerReq };

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const response: ProviderResponse = await provider.stream(workingReq, (delta) => {
            writeContentChunk(res, requestId, model, delta);
            streamedAssistantText += delta;
          });
          streamLastUsage = response.usage;

          // No tool calls — done
          if (response.stopReason !== "tool_use") break;

          // Emit tool call events to the client (SSE for chat, buffer for voice)
          console.log(`[chat] stream tool turn=${turn} tools=${response.toolCalls.map(tc => tc.name).join(",")}`);
          for (const tc of response.toolCalls) {
            writeToolCallChunk(res, tc.name, tc.arguments, tc.id);
            if (isVoice) pushToolEvent(tc.name, "call", tc.arguments);
            toolsUsedInRequest.push(tc.name);
          }

          // Execute tools
          const toolResults = await executeToolCalls(
            response.toolCalls.map(tc => ({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
            userEmail
          );

          // Emit tool result events + record rich tool info for eval
          for (const r of toolResults) {
            if (r.type === "tool_result") {
              const tc = response.toolCalls.find(t => t.id === r.tool_use_id);
              writeToolResultChunk(res, r.tool_use_id, tc?.name || "", r.content);
              if (isVoice) pushToolEvent(tc?.name || "", "result", undefined, r.content);
              if (tc) toolCallRecords.push({ name: tc.name, args: tc.arguments, result: r.content });
            }
          }

          // Build messages for next turn using provider-specific formatting
          const updatedMessages = provider.buildToolResultMessages(
            workingReq.messages,
            response,
            toolResults.map(r => ({ toolCallId: r.tool_use_id, result: r.content })),
          );
          workingReq = { ...workingReq, messages: updatedMessages };
        }
      } catch (streamErr) {
        console.error("Stream error:", streamErr);
        // Fallback: try a non-streaming complete() call
        try {
          const fallbackResp = await provider.complete(providerReq);
          writeContentChunk(res, requestId, model, fallbackResp.text);
        } catch (fallbackErr) {
          console.error("Fallback complete() also failed:", fallbackErr);
          writeContentChunk(res, requestId, model, "I encountered an error processing your request.");
        }
      }

      writeFinishChunk(res, requestId, model, "stop");
      writeSSEDone(res);
      res.end();

      // CLS Phase 1: capture episode (fire-and-forget)
      const episodeMessages = (body.messages || []).map(m => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : "(attachment)",
      }));
      captureEpisode(episodeMessages, {
        scoutEmail: userEmail || null,
        mode: isVoice ? "voice" : "chat",
        toolsUsed: toolsUsedInRequest,
      });

      // Stream C: cost logging (fire-and-forget — never blocks the response).
      logUsage(buildUsageRecord({
        usage: streamLastUsage,
        cookieEmail: cookieUser?.email,
        userEmail,
        emulateEmail: emulateEmail ?? null,
        userRole,
        troopId: authRoleInfo?.troop ?? null,
        provider: providerName,
        modelExact: modelId,
        requestedModel: model,
        toolCallRecords,
        channel: isVoice ? "voice" : "chat",
        latencyMs: Date.now() - requestStartedAt,
        conversationId: isVoice ? getVoiceConversationId() : (body.conversationId ?? null),
      })).catch(() => { /* logger swallows already; defensive */ });

      // Stream B follow-up: voice-session conversation persistence. Creates
      // (or appends to) a conversations doc with channel:"voice" so the user
      // can view voice transcripts in history.html. Closes the long-standing
      // conversationId TODO that lost Jeremy's chat with Ben on 2026-04-18.
      if (isVoice) {
        persistVoiceTurn({
          userEmail: cookieUser?.email ?? voiceCtx?.userEmail ?? null,
          effectiveEmail: userEmail ?? null,
          model,
          userMessage: lastUserTextFrom(body.messages),
          assistantMessage: streamedAssistantText,
          toolCalls: toolCallRecords,
        }).catch(() => { /* persistence swallows already; defensive */ });
      }
    } else {
      // Non-streaming: complete() with tool loop
      let workingReq = { ...providerReq };
      let finalText = "I was unable to complete that request.";
      let lastUsage: { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number } = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await provider.complete(workingReq);
        lastUsage = response.usage;

        // No tool calls — return final text
        if (response.stopReason !== "tool_use") {
          finalText = response.text;
          break;
        }

        // Track tool calls for response metadata
        for (const tc of response.toolCalls) {
          toolsUsedInRequest.push(tc.name);
        }

        // Execute tools
        const toolResults = await executeToolCalls(
          response.toolCalls.map(tc => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
          userEmail
        );

        // Record rich tool info for eval observability
        for (const r of toolResults) {
          if (r.type === "tool_result") {
            const tc = response.toolCalls.find(t => t.id === r.tool_use_id);
            if (tc) toolCallRecords.push({ name: tc.name, args: tc.arguments, result: r.content });
          }
        }

        // Build messages for next turn
        const updatedMessages = provider.buildToolResultMessages(
          workingReq.messages,
          response,
          toolResults.map(r => ({ toolCallId: r.tool_use_id, result: r.content })),
        );
        workingReq = { ...workingReq, messages: updatedMessages };
      }

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
        // Expose internal tool usage for eval observability.
        // Name list kept for backward compat; records include args+result for scoring.
        backend_tool_calls: toolsUsedInRequest.length > 0 ? toolsUsedInRequest : undefined,
        backend_tool_records: toolCallRecords.length > 0 ? toolCallRecords : undefined,
        usage: {
          prompt_tokens: lastUsage.inputTokens,
          completion_tokens: lastUsage.outputTokens,
          total_tokens: lastUsage.inputTokens + lastUsage.outputTokens,
          cache_creation_input_tokens: lastUsage.cacheCreationTokens ?? 0,
          cache_read_input_tokens: lastUsage.cacheReadTokens ?? 0,
        },
      });

      // Stream C: cost logging (fire-and-forget).
      logUsage(buildUsageRecord({
        usage: lastUsage,
        cookieEmail: cookieUser?.email,
        userEmail,
        emulateEmail: emulateEmail ?? null,
        userRole,
        troopId: authRoleInfo?.troop ?? null,
        provider: providerName,
        modelExact: modelId,
        requestedModel: model,
        toolCallRecords,
        channel: isVoice ? "voice" : "chat",
        latencyMs: Date.now() - requestStartedAt,
        conversationId: isVoice ? getVoiceConversationId() : (body.conversationId ?? null),
      })).catch(() => { /* logger swallows already; defensive */ });

      // Voice persistence — see streaming branch for rationale.
      if (isVoice) {
        persistVoiceTurn({
          userEmail: cookieUser?.email ?? voiceCtx?.userEmail ?? null,
          effectiveEmail: userEmail ?? null,
          model,
          userMessage: lastUserTextFrom(body.messages),
          assistantMessage: finalText,
          toolCalls: toolCallRecords,
        }).catch(() => { /* persistence swallows already; defensive */ });
      }
    }
  } catch (err: unknown) {
    console.error("Chat handler error:", err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: { message, type: "server_error" } });
    }
  }
}

// ---------------------------------------------------------------------------
// Cost logging helpers
// ---------------------------------------------------------------------------

/**
 * Build the LogUsageInput record for `cost/logger.ts`.
 *
 * Attribution rules:
 *   - userEmail: the *actual* spender — cookie owner > LibreChat header user.
 *     Never the emulated scout, even when admin is emulating.
 *   - scoutEmail: who the conversation is *about* — the emulated scout when
 *     admin is emulating, else the user themselves if they're a scout, else null.
 */
function buildUsageRecord(args: {
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number } | null;
  cookieEmail: string | undefined;
  userEmail: string | undefined;
  emulateEmail: string | null;
  userRole: string;
  troopId: string | null;
  provider: string;
  modelExact: string;
  requestedModel: string;
  toolCallRecords: Array<{ name: string; args: unknown; result: string }>;
  channel: "chat" | "voice";
  latencyMs: number;
  conversationId: string | null;
}): Parameters<typeof logUsage>[0] {
  const attributedEmail = args.cookieEmail ?? args.userEmail ?? null;
  const scoutEmail = args.emulateEmail
    ?? (args.userRole === "scout" || args.userRole === "test_scout" ? args.userEmail ?? null : null);

  // Tool calls are recorded as success when a tool_result was returned
  // (executeToolCalls always returns a result block — error states get folded
  // into the content string today). When we add structured failure tracking,
  // update this to honor the real outcome.
  const toolCalls: LoggedToolCall[] = args.toolCallRecords.map((r) => ({
    name: r.name,
    success: true,
  }));

  return {
    userEmail: attributedEmail,
    scoutEmail: scoutEmail ?? null,
    troopId: args.troopId,
    conversationId: args.conversationId,
    channel: args.channel,
    provider: args.provider,
    modelExact: args.modelExact,
    requestedModel: args.requestedModel,
    usage: args.usage ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    latencyMs: args.latencyMs,
    toolCalls,
    role: args.userRole,
  };
}

/** Extract the most recent user-authored text from an OpenAI-style message list. */
function lastUserTextFrom(messages: OpenAIChatRequest["messages"] | undefined): string {
  if (!messages || !messages.length) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text" && typeof (c as { text?: string }).text === "string")
        .map((c) => c.text)
        .join(" ");
    }
  }
  return "";
}
