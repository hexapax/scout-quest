import express from "express";
import { connectDb } from "./db.js";
import { loadKnowledge, getKnowledgeBlock } from "./knowledge.js";
import { connectFalkorDB } from "./falkordb.js";
import { chatHandler } from "./chat.js";
import { createBsaTokenRouter } from "./routes/bsa-token.js";
import { createActionsRouter } from "./routes/actions.js";
import { createProgressRouter } from "./routes/progress.js";
import { createEvalReportsRouter } from "./routes/eval-reports.js";
import { createAuthRouter } from "./routes/auth.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { createHistoryRouter } from "./routes/history.js";
import { createSummariesRouter } from "./routes/summaries.js";
import { createSafetyRouter } from "./routes/safety.js";
import { createCostRouter } from "./routes/cost.js";
import { loadPricing } from "./cost/pricing.js";
import { lookupUserRole } from "./auth/role-lookup.js";
import { startSummarySweeper } from "./cron/summary-sweeper.js";

const app = express();

// Log every incoming request for debugging
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path} from=${req.ip} ua=${(req.headers["user-agent"] || "").substring(0, 60)}`);
  next();
});

app.use(express.json({ limit: "4mb" }));

// OpenAI-compatible chat completions endpoint
app.post("/v1/chat/completions", chatHandler);

// BSA token management
app.use("/", createBsaTokenRouter());

// Pending actions API (micro-app backend)
app.use("/", createActionsRouter());

// Progress API (for progress micro-app)
app.use("/", createProgressRouter());

// Eval reports API (for eval viewer micro-app)
app.use("/", createEvalReportsRouter());

// Auth routes (Google OAuth)
app.use("/", createAuthRouter());

// Conversation persistence
app.use("/", createConversationsRouter());

// Role-based history viewers (Stream B)
app.use("/", createHistoryRouter());

// Conversation summaries — Stream G read endpoints
app.use("/", createSummariesRouter());

// Admin Safety Queue — Stream H step 7 (read-only in Phase 1)
app.use("/", createSafetyRouter());

// Production cost summary (admin-only)
app.use("/", createCostRouter());

// Serve static micro-app files
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use("/", (await import("express")).default.static(join(__dirname, "../public")));

// Internal admin routes (protected by BACKEND_API_KEY)
app.post("/internal/reload-knowledge", (req, res) => {
  const apiKey = process.env.BACKEND_API_KEY;
  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (apiKey && provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    loadKnowledge();
    const block = getKnowledgeBlock();
    const chars = block.text.length;
    res.json({ ok: true, chars, approxTokens: Math.round(chars / 4) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ElevenLabs Conversational AI — role-aware (preferred) + domain-aware
// (fallback) agent selection. Per Stream E: parents and leaders should get a
// different persona/voice than scouts. The env vars are additive — if a
// role-specific agent isn't set, we fall back to the admin agent (if admin
// domain) or the scout agent.
const AGENT_IDS: Record<string, string | undefined> = {
  scout: process.env.ELEVENLABS_SCOUT_AGENT_ID || process.env.ELEVENLABS_AGENT_ID,
  parent: process.env.ELEVENLABS_PARENT_AGENT_ID,
  leader: process.env.ELEVENLABS_LEADER_AGENT_ID,
  admin: process.env.ELEVENLABS_ADMIN_AGENT_ID,
};

const DEFAULT_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || "agent_8001kn8cac71ekpt18tcaxrn8whg";

/**
 * Pick an ElevenLabs agent for a request.
 *
 * Precedence:
 *   1. Authenticated role (cookie → lookupUserRole) — parent, leader, admin, scout
 *   2. Admin-domain fallback for anonymous admin-domain callers
 *   3. Default scout agent
 */
async function pickAgentIdAsync(req: express.Request): Promise<string> {
  const cookie = getUserFromCookie(req);
  if (cookie) {
    try {
      const info = await lookupUserRole(cookie.email);
      if (info.isAdmin && AGENT_IDS.admin) return AGENT_IDS.admin;
      if (info.roles.includes("leader") && AGENT_IDS.leader) return AGENT_IDS.leader;
      if (info.roles.includes("parent") && AGENT_IDS.parent) return AGENT_IDS.parent;
      if ((info.role === "scout" || info.role === "test_scout") && AGENT_IDS.scout) return AGENT_IDS.scout;
    } catch (err) {
      console.warn("[voice] role lookup failed; falling back to domain-based agent:", err);
    }
  }

  const host = (req.headers["x-forwarded-host"] || req.hostname || "").toString();
  if ((host.includes("ai-chat") || host.includes("admin")) && AGENT_IDS.admin) return AGENT_IDS.admin;
  return AGENT_IDS.scout || DEFAULT_AGENT_ID;
}

// Returns both token (for WebRTC) and signedUrl (for WebSocket)
app.get("/api/voice/signed-url", async (req, res) => {
  const apiKey = process.env.ELEVENLABS_ADMIN_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });
    return;
  }
  const agentId = await pickAgentIdAsync(req);
  try {
    const tokenResp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } }
    );
    if (!tokenResp.ok) {
      const err = await tokenResp.text().catch(() => "");
      res.status(tokenResp.status).json({ error: `ElevenLabs error: ${tokenResp.status}`, detail: err });
      return;
    }
    const urlData = (await tokenResp.json()) as { signed_url: string };

    let conversationToken: string | null = null;
    try {
      const ctResp = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      if (ctResp.ok) {
        const ctData = (await ctResp.json()) as { token: string };
        conversationToken = ctData.token;
      }
    } catch {
      // Token endpoint may not be available — fall back to signed URL
    }

    res.json({
      signedUrl: urlData.signed_url,
      conversationToken,
      agentId,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Voice context — client POSTs chat history before starting a voice session.
// Requires cookie auth because this is the trust anchor for voice sessions:
// ElevenLabs requests are authorized by the existence of a valid voice context.
import {
  setVoiceContext,
  getVoiceContext,
  getVoiceConversationId,
  getToolEvents,
  clearToolEvents,
} from "./voice-context.js";
import { getUserFromCookie } from "./routes/auth.js";

app.post("/api/voice/context", (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const msgs = req.body?.messages;
  if (Array.isArray(msgs)) {
    // conversationId flows text→voice when the client is already in an
    // active text conversation. persistVoiceTurn then APPENDS voice turns
    // to that existing conversation instead of creating a new voice-only
    // one — this is what stitches chat+voice into a single transcript.
    setVoiceContext(msgs, {
      emulateEmail: req.body?.emulateEmail,
      userEmail: req.body?.userEmail || user.email,
      conversationId: typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined,
    });
    clearToolEvents(); // Fresh session
    res.json({ ok: true, count: msgs.length });
  } else {
    res.status(400).json({ error: "messages array required" });
  }
});

// Active-voice-conversation id — lets app.js sync currentConversationId when
// the user flips voice→text mid-session. Returns null if no active voice
// context or if voice persistence hasn't yet created a conversation doc.
app.get("/api/voice/active-conversation", (req, res) => {
  if (!getUserFromCookie(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json({
    conversationId: getVoiceConversationId(),
    // Also echo the context's known email for sanity-check from the client.
    userEmail: getVoiceContext()?.userEmail ?? null,
  });
});

// Poll for tool events during voice sessions (requires cookie auth)
app.get("/api/voice/tool-events", (req, res) => {
  if (!getUserFromCookie(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const since = Number(req.query.since) || 0;
  res.json(getToolEvents(since));
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "scout-quest-backend" });
});

// Models list (LibreChat may call this)
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "scout-coach", object: "model", owned_by: "scout-quest" },
      { id: "scout-guide", object: "model", owned_by: "scout-quest" },
      { id: "scoutmaster", object: "model", owned_by: "scout-quest" },
    ],
  });
});

async function start(): Promise<void> {
  await connectDb();
  loadKnowledge();
  loadPricing();

  // FalkorDB is optional — backend works without it (tools degrade gracefully)
  connectFalkorDB().catch((err: unknown) => {
    console.warn("FalkorDB not available — graph tools will be disabled:", err);
  });

  // Stream G — periodic conversation summaries (in-process, no separate cron container).
  // Disable with SUMMARY_SWEEPER_DISABLED=1 (e.g. for tests or one-off runs).
  if (process.env.SUMMARY_SWEEPER_DISABLED !== "1") {
    startSummarySweeper();
  }

  const port = Number(process.env.PORT || 3090);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Scout Quest backend listening on :${port}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
