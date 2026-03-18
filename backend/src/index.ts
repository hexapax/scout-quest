import express from "express";
import { connectDb } from "./db.js";
import { loadKnowledge, getKnowledgeBlock } from "./knowledge.js";
import { connectFalkorDB } from "./falkordb.js";
import { chatHandler } from "./chat.js";
import { createBsaTokenRouter } from "./routes/bsa-token.js";
import { createActionsRouter } from "./routes/actions.js";
import { createProgressRouter } from "./routes/progress.js";

const app = express();

app.use(express.json({ limit: "4mb" }));

// OpenAI-compatible chat completions endpoint
app.post("/v1/chat/completions", chatHandler);

// BSA token management
app.use("/", createBsaTokenRouter());

// Pending actions API (micro-app backend)
app.use("/", createActionsRouter());

// Progress API (for progress micro-app)
app.use("/", createProgressRouter());

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
