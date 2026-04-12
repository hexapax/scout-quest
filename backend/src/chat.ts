import type { Request, Response } from "express";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { getKnowledgeBlock } from "./knowledge.js";
import { getPersonaBlock } from "./persona.js";
import { getScoutContext } from "./scout-context.js";
import { openaiMessagesToAnthropic, extractSystemText } from "./translate.js";
import { initSSE, writeRoleChunk, writeContentChunk, writeFinishChunk, writeSSEDone, writeToolCallChunk, writeToolResultChunk } from "./stream.js";
import type { OpenAIChatRequest, AnthropicSystemBlock } from "./types.js";
import { getToolsForRole, type UserRole } from "./tools/definitions.js";
import { executeToolCalls } from "./tool-executor.js";
import { getUserFromCookie } from "./routes/auth.js";
import { getVoiceContext, pushToolEvent } from "./voice-context.js";
import { captureEpisode } from "./episodes.js";
import { resolveProvider } from "./providers/registry.js";
import type { ProviderRequest, ProviderResponse, CanonicalMessage } from "./providers/types.js";

const MAX_TOOL_TURNS = 5;

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

  const body = req.body as OpenAIChatRequest;
  const doStream = body.stream !== false;
  const isVoice = !!body.elevenlabs_extra_body || (req.headers["user-agent"] || "").includes("AsyncOpenAI");

  // Domain-aware defaults: admin domain → scoutmaster model, otherwise body.model
  const host = (req.headers["x-forwarded-host"] || req.hostname || "").toString();
  const isAdminDomain = host.includes("ai-chat") || host.includes("admin");
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

  // Determine user role for tool filtering.
  // Admin domain → admin role. Otherwise role from email + model.
  const ADMIN_EMAILS = ["jeremy@hexapax.com", "jebramwell@gmail.com"];
  const isAdmin = isAdminDomain || ADMIN_EMAILS.some(e => cookieUser?.email?.toLowerCase() === e.toLowerCase());
  let userRole: UserRole = "scout";
  if (isAdmin && !emulateEmail) userRole = "admin";
  else if (isAdmin && emulateEmail) userRole = "scout"; // emulating a scout
  else if (model.includes("guide")) userRole = "guide";
  const activeTools = getToolsForRole(userRole);

  // Log incoming request for debugging custom LLM integration
  console.log(`[chat] model=${model} stream=${doStream} email=${userEmail || "none"} voice=${isVoice} role=${userRole} messages=${body.messages?.length ?? 0}`);
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

    // Build system blocks (order matters for caching)
    const systemBlocks: AnthropicSystemBlock[] = [
      getKnowledgeBlock(needsCompact), // [0] BSA knowledge — cached (ephemeral)
      getPersonaBlock(model),           // [1] Agent persona
    ];
    if (needsCompact) console.log(`[chat] Using compact knowledge for model ${model}`);

    // [2] Per-user context (dynamic — not cached)
    if (userEmail) {
      const scoutCtx = await getScoutContext(userEmail);
      if (scoutCtx) {
        systemBlocks.push(scoutCtx);
      } else if (userRole === "admin") {
        // Leader context — no scout profile, inject identity + instructions
        systemBlocks.push({
          type: "text",
          text: `LEADER CONTEXT\nEmail: ${userEmail}\nRole: Scoutmaster (admin)\nTroop: 2024\n\n` +
            `You have access to ALL tools. Use troop_insights and session_planner freely.\n` +
            `For individual scout lookups, use get_scout_status with a scout name via get_roster first.\n` +
            `You do NOT have a personal Scoutbook userId — you are a leader, not a scout.`,
        });
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
      conversationId: undefined, // TODO: from conversation persistence
    };

    const requestId = `chatcmpl-${Date.now()}`;

    if (doStream) {
      initSSE(res);
      writeRoleChunk(res, requestId, model);

      // Stream with tool loop: stream text tokens, execute tools if needed, repeat.
      try {
        let workingReq = { ...providerReq };

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const response: ProviderResponse = await provider.stream(workingReq, (delta) => {
            writeContentChunk(res, requestId, model, delta);
          });

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
    }
  } catch (err: unknown) {
    console.error("Chat handler error:", err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: { message, type: "server_error" } });
    }
  }
}
