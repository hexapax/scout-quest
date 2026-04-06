import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { getKnowledgeBlock } from "./knowledge.js";
import { getPersonaBlock } from "./persona.js";
import { getScoutContext } from "./scout-context.js";
import { openaiMessagesToAnthropic, extractSystemText } from "./translate.js";
import { initSSE, writeRoleChunk, writeContentChunk, writeFinishChunk, writeSSEDone, writeToolCallChunk, writeToolResultChunk, mapStopReason } from "./stream.js";
import type { OpenAIChatRequest, AnthropicSystemBlock } from "./types.js";
import { SCOUT_TOOLS, getToolsForRole, type UserRole } from "./tools/definitions.js";
import { executeToolCalls } from "./tool-executor.js";
import { getUserFromCookie } from "./routes/auth.js";
import { getVoiceContext, pushToolEvent } from "./voice-context.js";
import { captureEpisode } from "./episodes.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
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

interface CacheMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** Run the Anthropic tool execution loop and return the final response text + cache metrics. */
async function runWithTools(
  baseReq: object,
  messages: MessageParam[],
  userEmail: string | undefined,
  tools: unknown[] = SCOUT_TOOLS
): Promise<{ text: string; usage: CacheMetrics }> {
  const workingMessages = [...messages];
  let lastUsage: CacheMetrics = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      ...(baseReq as Parameters<typeof anthropic.messages.create>[0]),
      messages: workingMessages,
      tools: tools as Parameters<typeof anthropic.messages.create>[0]["tools"],
      stream: false,
    });

    // Capture cache metrics from usage
    const u = resp.usage as unknown as Record<string, number>;
    lastUsage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    };
    console.log(`[cache] turn=${turn} input=${lastUsage.input_tokens} output=${lastUsage.output_tokens} cache_create=${lastUsage.cache_creation_input_tokens} cache_read=${lastUsage.cache_read_input_tokens}`);

    // No tool calls — return final text
    if (resp.stop_reason !== "tool_use") {
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      return { text, usage: lastUsage };
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

  return { text: "I was unable to complete that request.", usage: lastUsage };
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
    // Build system blocks (order matters for caching)
    const systemBlocks: AnthropicSystemBlock[] = [
      getKnowledgeBlock(),    // [0] BSA knowledge — cached (ephemeral)
      getPersonaBlock(model), // [1] Agent persona
    ];

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

    // Convert OpenAI messages to Anthropic format
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

    const baseReq = {
      model: ANTHROPIC_MODEL,
      max_tokens: body.max_tokens || 16384,
      system: systemBlocks,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    };

    const requestId = `chatcmpl-${Date.now()}`;

    if (doStream) {
      initSSE(res);
      writeRoleChunk(res, requestId, model);

      // Stream with tool loop: stream text tokens, execute tools if needed, repeat.
      try {
        const workingMessages = [...messages] as Parameters<typeof anthropic.messages.create>[0]["messages"];

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const stream = anthropic.messages.stream({
            ...(baseReq as Parameters<typeof anthropic.messages.create>[0]),
            messages: workingMessages,
            tools: activeTools as Parameters<typeof anthropic.messages.create>[0]["tools"],
          });

          stream.on("text", (text) => {
            writeContentChunk(res, requestId, model, text);
          });

          const finalMessage = await stream.finalMessage();

          // No tool calls — done
          if (finalMessage.stop_reason !== "tool_use") break;

          // Execute tools and continue
          const toolUseBlocks = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          console.log(`[chat] stream tool turn=${turn} tools=${toolUseBlocks.map(b => b.name).join(",")}`);
          toolsUsedInRequest.push(...toolUseBlocks.map(b => b.name));

          // Emit tool call events to the client (SSE for chat, buffer for voice)
          for (const b of toolUseBlocks) {
            writeToolCallChunk(res, b.name, b.input, b.id);
            if (isVoice) pushToolEvent(b.name, "call", b.input);
          }

          const toolResults = await executeToolCalls(
            toolUseBlocks.map((b) => ({
              type: "tool_use" as const,
              id: b.id,
              name: b.name,
              input: b.input as Record<string, unknown>,
            })),
            userEmail
          );

          // Emit tool result events
          for (const r of toolResults) {
            if (r.type === "tool_result") {
              const block = toolUseBlocks.find(b => b.id === r.tool_use_id);
              writeToolResultChunk(res, r.tool_use_id, block?.name || "", r.content);
              if (isVoice) pushToolEvent(block?.name || "", "result", undefined, r.content);
            }
          }

          workingMessages.push({ role: "assistant" as const, content: finalMessage.content });
          workingMessages.push({ role: "user" as const, content: toolResults });
        }
      } catch (streamErr) {
        console.error("Stream error, falling back to runWithTools:", streamErr);
        const { text: finalText } = await runWithTools(baseReq, messages, userEmail, activeTools);
        writeContentChunk(res, requestId, model, finalText);
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
      const { text: finalText, usage } = await runWithTools(baseReq, messages, userEmail, activeTools);
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
        usage: {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.input_tokens + usage.output_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
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
