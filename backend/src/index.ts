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

// ElevenLabs Conversational AI — domain-aware agent selection.
// Different domains get different voices/agents.
const AGENT_IDS: Record<string, string> = {
  scout: process.env.ELEVENLABS_AGENT_ID || "agent_8001kn8cac71ekpt18tcaxrn8whg",
  admin: process.env.ELEVENLABS_ADMIN_AGENT_ID || process.env.ELEVENLABS_AGENT_ID || "agent_8001kn8cac71ekpt18tcaxrn8whg",
};

/** Pick ElevenLabs agent based on request hostname. */
function pickAgentId(req: express.Request): string {
  const host = (req.headers["x-forwarded-host"] || req.hostname || "").toString();
  if (host.includes("ai-chat") || host.includes("admin")) return AGENT_IDS.admin;
  return AGENT_IDS.scout;
}

// Returns both token (for WebRTC) and signedUrl (for WebSocket)
app.get("/api/voice/signed-url", async (req, res) => {
  const apiKey = process.env.ELEVENLABS_ADMIN_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });
    return;
  }
  const agentId = pickAgentId(req);
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
import { setVoiceContext, getToolEvents, clearToolEvents } from "./voice-context.js";
import { getUserFromCookie } from "./routes/auth.js";

app.post("/api/voice/context", (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const msgs = req.body?.messages;
  if (Array.isArray(msgs)) {
    setVoiceContext(msgs, {
      emulateEmail: req.body?.emulateEmail,
      userEmail: req.body?.userEmail || user.email,
    });
    clearToolEvents(); // Fresh session
    res.json({ ok: true, count: msgs.length });
  } else {
    res.status(400).json({ error: "messages array required" });
  }
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

  // FalkorDB is optional — backend works without it (tools degrade gracefully)
  connectFalkorDB().catch((err: unknown) => {
    console.warn("FalkorDB not available — graph tools will be disabled:", err);
  });

  const port = Number(process.env.PORT || 3090);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Scout Quest backend listening on :${port}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
