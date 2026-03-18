import express from "express";
import { connectDb } from "./db.js";
import { loadKnowledge } from "./knowledge.js";
import { chatHandler } from "./chat.js";

const app = express();

app.use(express.json({ limit: "4mb" }));

// OpenAI-compatible chat completions endpoint
app.post("/v1/chat/completions", chatHandler);

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

  const port = Number(process.env.PORT || 3090);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Scout Quest backend listening on :${port}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
