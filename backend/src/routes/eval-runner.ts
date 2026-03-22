/** Eval Runner API — configure and launch eval runs from the web UI.
 * GET  /api/eval/configs       — resolved RunConfig definitions from configs.yaml
 * GET  /api/eval/eval-sets     — list eval set YAML files with metadata
 * GET  /api/eval/versions      — current version fingerprint
 * POST /api/eval/launch        — launch an eval run as background subprocess
 * GET  /api/eval/launch/active — list active runs
 * POST /api/eval/launch/:runId/stop — kill a running eval
 * GET  /api/eval/estimate      — cost estimate for a config+question combination
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { execSync, spawn } from "child_process";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From backend/dist/routes/ -> scout-quest repo root
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const EVAL_SETS_DIR = path.join(PROJECT_ROOT, "eval-sets");
const CONFIGS_YAML = path.join(EVAL_SETS_DIR, "configs.yaml");
const RUN_EVAL_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run-eval.py");

interface ActiveRun {
  runId: string;
  pid: number;
  startedAt: string;
  spectre: string;
  evalSet: string;
  configs: string[];
  description?: string;
}

const activeRuns = new Map<string, ActiveRun>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pythonExec(code: string): string {
  return execSync(
    `python3 -c "${code.replace(/"/g, '\\"')}"`,
    { cwd: PROJECT_ROOT, timeout: 15_000, encoding: "utf-8" },
  ).trim();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createEvalRunnerRouter(): Router {
  const router = createRouter();

  // ── GET /api/eval/configs ──
  router.get("/api/eval/configs", (_req: Request, res: Response) => {
    try {
      const pyCode = [
        "import sys, json",
        `sys.path.insert(0, '${path.join(PROJECT_ROOT, "scripts").replace(/'/g, "\\'")}')`,
        "from eval_framework import load_configs_yaml",
        `print(json.dumps(load_configs_yaml('${CONFIGS_YAML.replace(/'/g, "\\'")}')))`
      ].join("; ");
      const raw = pythonExec(pyCode);
      const configs = JSON.parse(raw);
      res.json({ configs });
    } catch (err: any) {
      console.error("eval-runner: configs error:", err.message);
      res.status(500).json({ error: "Failed to load configs", detail: err.message });
    }
  });

  // ── GET /api/eval/eval-sets ──
  router.get("/api/eval/eval-sets", (_req: Request, res: Response) => {
    try {
      const files = readdirSync(EVAL_SETS_DIR).filter(
        (f) => f.endsWith(".yaml") && f !== "configs.yaml",
      );

      const evalSets = files.map((file) => {
        const content = readFileSync(path.join(EVAL_SETS_DIR, file), "utf-8");
        // Simple YAML front-matter extraction (avoids needing a YAML parser)
        const getName = content.match(/^name:\s*(.+)$/m);
        const getVersion = content.match(/^version:\s*(.+)$/m);
        const getPerspective = content.match(/^perspective:\s*(.+)$/m);
        const getDesc = content.match(/^description:\s*(.+)$/m);

        // Count questions/items (lines matching "- id:" at any indentation)
        const itemMatches = content.match(/^-\s+id:/gm) || content.match(/^\s+- id:/gm);
        const questionCount = itemMatches ? itemMatches.length : 0;

        return {
          name: getName?.[1]?.trim() ?? file.replace(".yaml", ""),
          file,
          perspective: getPerspective?.[1]?.trim() ?? "knowledge",
          version: parseInt(getVersion?.[1]?.trim() ?? "1", 10),
          description: getDesc?.[1]?.trim() ?? "",
          questionCount,
        };
      });

      res.json(evalSets);
    } catch (err: any) {
      console.error("eval-runner: eval-sets error:", err.message);
      res.status(500).json({ error: "Failed to list eval sets", detail: err.message });
    }
  });

  // ── GET /api/eval/versions ──
  router.get("/api/eval/versions", (_req: Request, res: Response) => {
    try {
      const pyCode = [
        "import sys, json",
        `sys.path.insert(0, '${path.join(PROJECT_ROOT, "scripts").replace(/'/g, "\\'")}')`,
        "from eval_framework import compute_version_fingerprint, EvalSetConfig, ScoringDimension, AssessorConfig",
        // Create a minimal eval set so fingerprint can compute
        "es = EvalSetConfig(name='stub', version=0, perspective='knowledge', description='', dimensions=[], assessors=[], scorer_model='', scorer_prompt='', items=[], raw={})",
        `fp = compute_version_fingerprint('${PROJECT_ROOT.replace(/'/g, "\\'")}', es)`,
        "print(json.dumps(fp, default=str))",
      ].join("; ");
      const raw = pythonExec(pyCode);
      const versions = JSON.parse(raw);
      res.json(versions);
    } catch (err: any) {
      console.error("eval-runner: versions error:", err.message);
      res.status(500).json({ error: "Failed to get versions", detail: err.message });
    }
  });

  // ── POST /api/eval/launch ──
  router.post("/api/eval/launch", (req: Request, res: Response) => {
    try {
      const {
        spectre = "knowledge",
        evalSet,
        configs,
        budget,
        sample,
        questions,
        description,
      } = req.body as {
        spectre?: string;
        evalSet?: string;
        configs: string[];
        budget: number;
        sample?: number;
        questions?: string;
        description?: string;
      };

      if (!configs || configs.length === 0) {
        res.status(400).json({ error: "At least one config is required" });
        return;
      }
      if (!budget || budget <= 0) {
        res.status(400).json({ error: "Budget is required and must be positive" });
        return;
      }

      // Build command args
      const args: string[] = [
        RUN_EVAL_SCRIPT,
        "--spectre", spectre,
        "--config", configs.join(","),
        "--budget", String(budget),
      ];

      if (evalSet) {
        args.push("--eval-set", path.join(EVAL_SETS_DIR, evalSet));
      }
      if (sample && sample > 0) {
        args.push("--sample", String(sample));
      }
      if (questions) {
        args.push("--questions", questions);
      }
      if (description) {
        args.push("--desc", description);
      }

      // Spawn detached process
      const child = spawn("python3", args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });

      child.unref();

      const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1);
      const pid = child.pid!;

      activeRuns.set(runId, {
        runId,
        pid,
        startedAt: new Date().toISOString(),
        spectre,
        evalSet: evalSet ?? "",
        configs,
        description,
      });

      console.log(`eval-runner: launched run ${runId} (pid=${pid}) configs=${configs.join(",")}`);
      res.json({ runId, pid });
    } catch (err: any) {
      console.error("eval-runner: launch error:", err.message);
      res.status(500).json({ error: "Failed to launch eval", detail: err.message });
    }
  });

  // ── GET /api/eval/launch/active ──
  router.get("/api/eval/launch/active", (_req: Request, res: Response) => {
    try {
      const runs: (ActiveRun & { alive: boolean })[] = [];

      for (const [id, run] of activeRuns.entries()) {
        const alive = isProcessAlive(run.pid);
        if (!alive) {
          // Clean up dead entries after returning them one last time
          setTimeout(() => activeRuns.delete(id), 60_000);
        }
        runs.push({ ...run, alive });
      }

      res.json(runs);
    } catch (err: any) {
      console.error("eval-runner: active runs error:", err.message);
      res.status(500).json({ error: "Failed to list active runs", detail: err.message });
    }
  });

  // ── POST /api/eval/launch/:runId/stop ──
  router.post("/api/eval/launch/:runId/stop", (req: Request, res: Response) => {
    try {
      const runId = req.params.runId as string;
      const run = activeRuns.get(runId);

      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }

      try {
        process.kill(run.pid, "SIGTERM");
      } catch {
        // Process already dead
      }

      res.json({ stopped: true, runId, pid: run.pid });
    } catch (err: any) {
      console.error("eval-runner: stop error:", err.message);
      res.status(500).json({ error: "Failed to stop run", detail: err.message });
    }
  });

  // ── GET /api/eval/estimate ──
  router.get("/api/eval/estimate", (req: Request, res: Response) => {
    try {
      const configNames = ((req.query.configs as string) || "").split(",").filter(Boolean);
      const questionCount = parseInt((req.query.questions as string) || "54", 10);

      // Load configs for pricing info
      const pyCode = [
        "import sys, json",
        `sys.path.insert(0, '${path.join(PROJECT_ROOT, "scripts").replace(/'/g, "\\'")}')`,
        "from eval_framework import load_configs_yaml",
        `print(json.dumps(load_configs_yaml('${CONFIGS_YAML.replace(/'/g, "\\'")}')))`
      ].join("; ");
      const raw = pythonExec(pyCode);
      const allConfigs = JSON.parse(raw);

      // Estimate cost per question per config
      // Base cost: ~$0.02-0.10 per question for response + panel evaluation
      // Rough model: (input_price/1M * ~4000_tokens + output_price/1M * ~1500_tokens) * 3 (model + assessors + scorer)
      const PRICE_MAP: Record<string, number> = {
        // Per-question estimated cost (response + panel eval)
        "claude": 0.08,
        "claude-adaptive-low": 0.06,
        "claude-adaptive-med": 0.07,
        "claude-adaptive-high": 0.09,
        "claude-thinking": 0.12,
        "opus": 0.20,
        "opus-adaptive-med": 0.18,
        "gpt41": 0.06,
        "gpt41-mini": 0.02,
        "gpt41-nano": 0.01,
        "gpt54": 0.10,
        "gpt54-mini": 0.04,
        "gpt54-nano": 0.02,
        "gemini25flash": 0.015,
        "gemini25flash-lite": 0.01,
        "gemini3flash": 0.04,
        "gemini31flash-lite": 0.02,
        "deepseek": 0.01,
      };
      // Layer configs inherit claude pricing
      for (const key of Object.keys(allConfigs)) {
        if (key.startsWith("layer-") && !(key in PRICE_MAP)) {
          PRICE_MAP[key] = PRICE_MAP["claude"] || 0.08;
        }
      }

      const breakdown = configNames.map((name) => {
        const perQ = PRICE_MAP[name] ?? 0.05; // default estimate
        return {
          config: name,
          label: allConfigs[name]?.label ?? name,
          perQuestion: perQ,
          total: Math.round(perQ * questionCount * 100) / 100,
        };
      });

      const estimatedCost = breakdown.reduce((sum, b) => sum + b.total, 0);

      res.json({
        estimatedCost: Math.round(estimatedCost * 100) / 100,
        questionCount,
        breakdown,
      });
    } catch (err: any) {
      console.error("eval-runner: estimate error:", err.message);
      res.status(500).json({ error: "Failed to estimate cost", detail: err.message });
    }
  });

  return router;
}
