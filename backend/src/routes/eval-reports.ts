/** Eval Reports API — serves model comparison evaluation data for the eval viewer.
 * GET /api/eval/reports         — list all report runs
 * GET /api/eval/reports/:ts     — full results for a specific run
 * GET /api/eval/reports/:ts/status — lightweight progress polling
 * GET /api/eval/cost?period=today|week|month|all — cost summary + breakdowns
 * GET /api/eval/cost/daily      — daily cost totals for charting
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getScoutQuestDb } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_DIR = path.resolve(
  __dirname,
  "../../../mcp-servers/scout-quest/test/reports/model-comparison",
);

const SCORE_DIMS = ["accuracy", "specificity", "safety", "coaching", "troop_voice"] as const;

// Expected number of questions per model (7 categories, ~8 questions each)
const EXPECTED_QUESTIONS_PER_MODEL = 54;

interface ScoreSet {
  accuracy: number;
  specificity: number;
  safety: number;
  coaching: number;
  troop_voice: number;
  notes?: string;
}

interface ResultEntry {
  model: string;
  label?: string;
  price?: string;
  questionId: string;
  category: string;
  question: string;
  expected?: string;
  response?: string;
  scores?: ScoreSet;
  error?: string;
  timestamp: string;
}

type ResultsData = Record<string, ResultEntry[]>;

async function readResults(ts: string): Promise<ResultsData | null> {
  const filePath = path.join(REPORTS_DIR, ts, "results.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as ResultsData;
  } catch {
    return null;
  }
}

function computeSummary(data: ResultsData) {
  const models: {
    key: string;
    label: string;
    price: string;
    questionCount: number;
    errorCount: number;
    avgScores: Record<string, number>;
  }[] = [];

  let totalQuestions = 0;
  const questionIds = new Set<string>();

  for (const [modelKey, entries] of Object.entries(data)) {
    const scored = entries.filter((e) => e.scores && !e.error);
    const errors = entries.filter((e) => e.error);

    for (const e of entries) questionIds.add(e.questionId);

    const avgScores: Record<string, number> = {};
    if (scored.length > 0) {
      for (const dim of SCORE_DIMS) {
        const sum = scored.reduce((acc, e) => acc + (e.scores?.[dim] ?? 0), 0);
        avgScores[dim] = Math.round((sum / scored.length) * 10) / 10;
      }
      // overall average
      const allDims = SCORE_DIMS.map((d) => avgScores[d]);
      avgScores.overall =
        Math.round((allDims.reduce((a, b) => a + b, 0) / allDims.length) * 10) / 10;
    }

    models.push({
      key: modelKey,
      label: entries[0]?.label ?? modelKey,
      price: entries[0]?.price ?? "",
      questionCount: scored.length,
      errorCount: errors.length,
      avgScores,
    });

    totalQuestions = Math.max(totalQuestions, entries.length);
  }

  return {
    modelCount: models.length,
    questionCount: questionIds.size,
    totalEntries: totalQuestions,
    models,
  };
}

export function createEvalReportsRouter(): Router {
  const router = createRouter();

  // List all report runs
  router.get("/api/eval/reports", async (_req: Request, res: Response) => {
    try {
      let dirs: string[];
      try {
        dirs = await readdir(REPORTS_DIR);
      } catch {
        res.json([]);
        return;
      }

      // Filter to directories matching timestamp pattern
      const reports: {
        timestamp: string;
        description: string | null;
        status: string | null;
        totalCost: number | null;
        modelCount: number;
        questionCount: number;
        models: { key: string; label: string; avgOverall: number }[];
      }[] = [];

      for (const dir of dirs) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(dir)) continue;
        const data = await readResults(dir);
        if (!data) continue;

        // Read optional meta.json for description
        let meta: { description?: string; status?: string; totalCost?: number } = {};
        try {
          const metaRaw = await readFile(path.join(REPORTS_DIR, dir, "meta.json"), "utf-8");
          meta = JSON.parse(metaRaw);
        } catch {
          // no meta.json — older run
        }

        const summary = computeSummary(data);
        reports.push({
          timestamp: dir,
          description: meta.description ?? null,
          status: meta.status ?? null,
          totalCost: meta.totalCost ?? null,
          modelCount: summary.modelCount,
          questionCount: summary.questionCount,
          models: summary.models.map((m) => ({
            key: m.key,
            label: m.label,
            avgOverall: m.avgScores.overall ?? 0,
          })),
        });
      }

      // Sort newest first
      reports.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      res.json(reports);
    } catch (err) {
      console.error("Eval reports list error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Full results for a specific run
  router.get("/api/eval/reports/:timestamp", async (req: Request, res: Response) => {
    try {
      const timestamp = req.params.timestamp as string;
      const data = await readResults(timestamp);
      if (!data) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      res.json(data);
    } catch (err) {
      console.error("Eval report fetch error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Lightweight progress/status endpoint
  router.get("/api/eval/reports/:timestamp/status", async (req: Request, res: Response) => {
    try {
      const timestamp = req.params.timestamp as string;
      const filePath = path.join(REPORTS_DIR, timestamp, "results.json");

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      const data = await readResults(timestamp);
      if (!data) {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      const modelKeys = Object.keys(data);
      let completedQuestions = 0;
      for (const entries of Object.values(data)) {
        completedQuestions += entries.length;
      }

      const totalExpected = modelKeys.length * EXPECTED_QUESTIONS_PER_MODEL;

      // Consider complete if file hasn't been modified in 30+ seconds
      const mtime = fileStat.mtime.getTime();
      const now = Date.now();
      const isComplete = now - mtime > 30_000;

      res.json({
        timestamp,
        models: modelKeys,
        completedQuestions,
        totalExpected,
        isComplete,
        lastModified: fileStat.mtime.toISOString(),
      });
    } catch (err) {
      console.error("Eval report status error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Cost endpoints ──

  function getPeriodStart(period: string): Date {
    const now = new Date();
    switch (period) {
      case "week": {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case "month": {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case "all":
        return new Date(0);
      case "today":
      default: {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d;
      }
    }
  }

  // Cost summary + breakdowns by model and run
  router.get("/api/eval/cost", async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || "today";
      const startDate = getPeriodStart(period);
      const db = getScoutQuestDb();
      const col = db.collection("eval_usage");

      // Total for period
      const [totalResult] = await col
        .aggregate([
          { $match: { timestamp: { $gte: startDate } } },
          {
            $group: {
              _id: null,
              totalCost: { $sum: "$cost" },
              totalCalls: { $sum: 1 },
              totalInputTokens: { $sum: "$input_tokens" },
              totalOutputTokens: { $sum: "$output_tokens" },
              totalCachedTokens: { $sum: "$cached_tokens" },
            },
          },
        ])
        .toArray();

      // By model
      const byModel = await col
        .aggregate([
          { $match: { timestamp: { $gte: startDate } } },
          {
            $group: {
              _id: "$label",
              cost: { $sum: "$cost" },
              calls: { $sum: 1 },
              inputTokens: { $sum: "$input_tokens" },
              outputTokens: { $sum: "$output_tokens" },
              cachedTokens: { $sum: "$cached_tokens" },
            },
          },
          { $sort: { cost: -1 } },
        ])
        .toArray();

      // By run
      const byRun = await col
        .aggregate([
          { $match: { timestamp: { $gte: startDate } } },
          {
            $group: {
              _id: "$run_id",
              cost: { $sum: "$cost" },
              calls: { $sum: 1 },
              models: { $addToSet: "$label" },
              firstTimestamp: { $min: "$timestamp" },
            },
          },
          { $sort: { firstTimestamp: -1 } },
        ])
        .toArray();

      res.json({
        period,
        startDate: startDate.toISOString(),
        total: totalResult
          ? {
              cost: totalResult.totalCost,
              calls: totalResult.totalCalls,
              inputTokens: totalResult.totalInputTokens,
              outputTokens: totalResult.totalOutputTokens,
              cachedTokens: totalResult.totalCachedTokens,
            }
          : { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        byModel: byModel.map((m) => ({
          model: m._id,
          cost: m.cost,
          calls: m.calls,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cachedTokens: m.cachedTokens,
        })),
        byRun: byRun.map((r) => ({
          runId: r._id,
          cost: r.cost,
          calls: r.calls,
          models: r.models,
          timestamp: r.firstTimestamp,
        })),
      });
    } catch (err) {
      console.error("Eval cost error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Daily cost totals for charting
  router.get("/api/eval/cost/daily", async (_req: Request, res: Response) => {
    try {
      const db = getScoutQuestDb();
      const col = db.collection("eval_usage");

      const daily = await col
        .aggregate([
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
              },
              cost: { $sum: "$cost" },
              calls: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      res.json(
        daily.map((d) => ({
          date: d._id,
          cost: d.cost,
          calls: d.calls,
        })),
      );
    } catch (err) {
      console.error("Eval daily cost error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
