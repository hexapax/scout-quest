import express from "express";
import { createEvalReportsRouter } from "./dist/routes/eval-reports.js";
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
app.listen(port, "0.0.0.0", () => {
  console.log(`Eval viewer listening on :${port}`);
});
