import express from "express";
import { createEvalReportsRouter } from "./dist/routes/eval-reports.js";
import { connectDb } from "./dist/db.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use("/", createEvalReportsRouter());
app.use("/", express.static(join(__dirname, "public")));

// Redirect root to eval-viewer
app.get("/", (_req, res) => res.redirect("/eval-viewer.html"));

const port = Number(process.env.PORT || 9090);

// Load keys from .env for TTS and other services
import { readFileSync } from "fs";
try {
  for (const line of readFileSync("/home/devuser/LibreChat/.env", "utf-8").split("\n")) {
    if (line.includes("=") && !line.startsWith("#")) {
      const [k, ...v] = line.split("=");
      if (!process.env[k]) process.env[k] = v.join("=");
    }
  }
} catch {}

// MongoDB URI for devbox: localhost, not docker hostname
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/scoutquest";

connectDb()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Eval viewer listening on :${port}`);
    });
  })
  .catch((err) => {
    console.warn("MongoDB not available — cost dashboard will not work:", err.message);
    app.listen(port, "0.0.0.0", () => {
      console.log(`Eval viewer listening on :${port} (no MongoDB)`);
    });
  });
