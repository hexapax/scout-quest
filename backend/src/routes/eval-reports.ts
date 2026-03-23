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

// Default knowledge dimensions — used as fallback when data doesn't specify
const DEFAULT_SCORE_DIMS = ["accuracy", "specificity", "safety", "coaching", "troop_voice"] as const;

// Detect dimensions from data: use whatever keys appear in the first scored entry
function detectDimensions(data: ResultsData): string[] {
  for (const entries of Object.values(data)) {
    for (const entry of entries) {
      if (entry.scores && !entry.error) {
        // Return all score keys except meta fields
        return Object.keys(entry.scores).filter(k => !["notes", "_assessments"].includes(k));
      }
    }
  }
  return [...DEFAULT_SCORE_DIMS];
}

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
  const dims = detectDimensions(data);

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
      for (const dim of dims) {
        const sum = scored.reduce((acc, e) => acc + ((e.scores as any)?.[dim] ?? 0), 0);
        avgScores[dim] = Math.round((sum / scored.length) * 10) / 10;
      }
      // overall average
      const dimValues = dims.map((d) => avgScores[d]).filter(v => v !== undefined);
      avgScores.overall = dimValues.length > 0
        ? Math.round((dimValues.reduce((a, b) => a + b, 0) / dimValues.length) * 10) / 10
        : 0;
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
        evalVersion: string | null;
        systemVersion: string | null;
        spectre: string;
        dimensions: string[];
        modelCount: number;
        questionCount: number;
        models: { key: string; label: string; avgOverall: number }[];
      }[] = [];

      for (const dir of dirs) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(dir)) continue;
        const data = await readResults(dir);
        if (!data) continue;

        // Read optional meta.json for description
        let meta: { description?: string; status?: string; totalCost?: number; evalVersion?: string; systemVersion?: string; perspective?: string; spectre?: string; dimensions?: string[] } = {};
        try {
          const metaRaw = await readFile(path.join(REPORTS_DIR, dir, "meta.json"), "utf-8");
          meta = JSON.parse(metaRaw);
        } catch {
          // no meta.json — older run
        }

        const summary = computeSummary(data);
        const dims = detectDimensions(data);
        reports.push({
          timestamp: dir,
          description: meta.description ?? null,
          status: meta.status ?? null,
          totalCost: meta.totalCost ?? null,
          evalVersion: meta.evalVersion ?? null,
          systemVersion: meta.systemVersion ?? null,
          spectre: meta.spectre ?? meta.perspective ?? "knowledge",
          dimensions: meta.dimensions ?? dims,
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

      // Read meta.json for expected question count and explicit status
      let meta: { questionCount?: number; models?: string[]; status?: string } = {};
      try {
        const metaRaw = await readFile(path.join(REPORTS_DIR, timestamp, "meta.json"), "utf-8");
        meta = JSON.parse(metaRaw);
      } catch {
        // no meta.json — use defaults
      }

      const expectedModels = meta.models?.length || modelKeys.length;
      const expectedPerModel = meta.questionCount || EXPECTED_QUESTIONS_PER_MODEL;
      const totalExpected = expectedModels * expectedPerModel;

      // Complete if meta says so, or if file stale AND all expected models present
      const mtime = fileStat.mtime.getTime();
      const now = Date.now();
      const metaComplete = meta.status === "complete" || meta.status === "budget_stopped";
      const staleFile = now - mtime > 30_000;
      const allModelsPresent = modelKeys.length >= expectedModels;
      const isComplete = metaComplete || (staleFile && allModelsPresent);

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

  // Serve usage.json for a specific run (fallback when no MongoDB data)
  router.get("/api/eval/reports/:ts/usage", async (req: Request, res: Response) => {
    try {
      const ts = Array.isArray(req.params.ts) ? req.params.ts[0] : req.params.ts;
      const filePath = path.join(REPORTS_DIR, ts, "usage.json");
      const content = await readFile(filePath, "utf-8");
      res.json(JSON.parse(content));
    } catch {
      res.status(404).json({ error: "No usage data for this run" });
    }
  });

  // Cost summary + breakdowns by model and run
  // Supports ?period=today|week|month|all OR ?run=<run_id> for a specific run
  router.get("/api/eval/cost", async (req: Request, res: Response) => {
    try {
      const runId = req.query.run as string | undefined;
      const period = (req.query.period as string) || "today";
      const db = getScoutQuestDb();
      const col = db.collection("eval_usage");

      // Build match filter: either by run_id or by time period
      const match = runId
        ? { run_id: runId }
        : { timestamp: { $gte: getPeriodStart(period) } };

      // Total
      const [totalResult] = await col
        .aggregate([
          { $match: match },
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
          { $match: match },
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
          { $match: match },
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
        period: runId ? `run:${runId}` : period,
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

  // ── Eval Results from MongoDB ──

  // Get all results for a question across all runs (for ranking/analysis)
  router.get("/api/eval/results/by-question/:questionId", async (req: Request, res: Response) => {
    try {
      const db = getScoutQuestDb();
      const col = db.collection("eval_results");
      const questionId = req.params.questionId as string;

      const results = await col
        .find({ question_id: questionId })
        .sort({ timestamp: -1 })
        .limit(200)
        .toArray();

      res.json({
        questionId,
        count: results.length,
        results: results.map((r) => ({
          runId: r.run_id,
          model: r.model,
          label: r.label,
          evalVersion: r.eval_version,
          response: r.response,
          responseHash: r.response_hash,
          scores: r.scores,
          notes: r.scores_notes,
          assessments: r.scores_assessments,
          error: r.error,
          timestamp: r.timestamp,
        })),
      });
    } catch (err) {
      console.error("Eval results by question error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get question-level stats (for question quality analysis)
  router.get("/api/eval/questions/stats", async (_req: Request, res: Response) => {
    try {
      const db = getScoutQuestDb();
      const col = db.collection("eval_results");

      const stats = await col
        .aggregate([
          { $match: { scores: { $exists: true } } },
          {
            $group: {
              _id: "$question_id",
              responseCount: { $sum: 1 },
              models: { $addToSet: "$model" },
              runs: { $addToSet: "$run_id" },
              avgAccuracy: { $avg: "$scores.accuracy" },
              avgCoaching: { $avg: "$scores.coaching" },
              avgTroopVoice: { $avg: "$scores.troop_voice" },
              scores: {
                $push: {
                  accuracy: "$scores.accuracy",
                  coaching: "$scores.coaching",
                  troop_voice: "$scores.troop_voice",
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      res.json(
        stats.map((s) => {
          const accScores = s.scores.map((sc: { accuracy: number }) => sc.accuracy);
          const accVariance =
            accScores.length > 1
              ? accScores.reduce((sum: number, v: number) => sum + Math.pow(v - s.avgAccuracy, 2), 0) /
                accScores.length
              : 0;
          return {
            questionId: s._id,
            responseCount: s.responseCount,
            modelCount: s.models.length,
            runCount: s.runs.length,
            avgAccuracy: Math.round(s.avgAccuracy * 10) / 10,
            avgCoaching: Math.round(s.avgCoaching * 10) / 10,
            avgTroopVoice: Math.round(s.avgTroopVoice * 10) / 10,
            accuracyVariance: Math.round(accVariance * 100) / 100,
          };
        }),
      );
    } catch (err) {
      console.error("Eval question stats error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── TTS Proxy Endpoints ──

  function getElevenLabsApiKey(): string | null {
    if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
    try {
      // Synchronous fallback: voice-config.json is tiny, read at first call
      const fs = require("fs");
      const configPath = path.resolve(__dirname, "../../../experiments/voice-config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // The config has a GCP secret path, not the actual key — env var is the real source
      return config.secrets?.api_key_secret ? null : null;
    } catch {
      return null;
    }
  }

  // Multi-voice dialogue: POST /api/tts/dialogue
  router.post("/api/tts/dialogue", async (req: Request, res: Response) => {
    try {
      const apiKey = getElevenLabsApiKey();
      if (!apiKey) {
        res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });
        return;
      }

      const { inputs, model_id } = req.body as {
        inputs: { text: string; voice_id: string }[];
        model_id?: string;
      };

      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        res.status(400).json({ error: "inputs array is required" });
        return;
      }

      const body: Record<string, unknown> = { inputs };
      if (model_id) body.model_id = model_id;

      const upstream = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        console.error("ElevenLabs dialogue error:", upstream.status, errText);
        res.status(upstream.status).json({ error: `ElevenLabs API error: ${upstream.status}`, detail: errText });
        return;
      }

      res.setHeader("Content-Type", "audio/mpeg");
      const arrayBuf = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch (err) {
      console.error("TTS dialogue proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Single-voice speech: POST /api/tts/speak
  router.post("/api/tts/speak", async (req: Request, res: Response) => {
    try {
      const apiKey = getElevenLabsApiKey();
      if (!apiKey) {
        res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });
        return;
      }

      const { text, voice_id, model_id } = req.body as {
        text: string;
        voice_id: string;
        model_id?: string;
      };

      if (!text || !voice_id) {
        res.status(400).json({ error: "text and voice_id are required" });
        return;
      }

      const body: Record<string, unknown> = { text };
      if (model_id) body.model_id = model_id;

      const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        console.error("ElevenLabs speak error:", upstream.status, errText);
        res.status(upstream.status).json({ error: `ElevenLabs API error: ${upstream.status}`, detail: errText });
        return;
      }

      res.setHeader("Content-Type", "audio/mpeg");
      const arrayBuf = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch (err) {
      console.error("TTS speak proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Rankings Endpoint ──

  // Get ranking results for a specific question
  router.get("/api/eval/rankings/:questionId", async (req: Request, res: Response) => {
    try {
      const db = getScoutQuestDb();
      const col = db.collection("eval_rankings");
      const questionId = req.params.questionId as string;

      const rankings = await col
        .find({ question_id: questionId })
        .sort({ timestamp: -1 })
        .toArray();

      res.json({
        questionId,
        rankings: rankings.map((r) => ({
          timestamp: r.timestamp,
          method: r.method,
          judges: r.judges,
          aggregate: r.aggregate,
          representatives: r.representatives,
          judgeRankings: r.judgeRankings,
        })),
      });
    } catch (err) {
      console.error("Eval rankings error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Portfolio endpoint — cross-run aggregation ──

  router.get("/api/eval/portfolio", async (_req: Request, res: Response) => {
    try {
      const db = getScoutQuestDb();
      const col = db.collection("eval_results");

      // Aggregate: for each model_id × perspective × layer, get the latest scores
      const pipeline = [
        { $match: { scores: { $exists: true }, error: { $exists: false } } },
        { $sort: { timestamp: -1 as const } },
        {
          $group: {
            _id: {
              model_id: "$model_id",
              perspective: "$perspective",
              layer: "$layer",
              config_id: "$config_id",
            },
            label: { $first: "$label" },
            provider: { $first: "$provider" },
            price: { $first: "$price" },
            scores: { $push: "$scores" },
            run_id: { $first: "$run_id" },
            count: { $sum: 1 },
          },
        },
      ];

      const results = await col.aggregate(pipeline).toArray();

      // Organize into portfolio structure
      const models: Record<string, {
        model_id: string;
        label: string;
        provider: string;
        price: string;
        spectres: Record<string, {
          layer: string;
          config_id: string;
          avg_scores: Record<string, number>;
          overall: number;
          count: number;
          run_id: string;
        }>;
      }> = {};

      // Track ablation entries separately
      const ablation: {
        model_id: string;
        label: string;
        layer: string;
        config_id: string;
        avg_scores: Record<string, number>;
        overall: number;
        count: number;
      }[] = [];

      for (const r of results) {
        const { model_id, perspective, layer, config_id } = r._id;
        const isAblation = (config_id || "").startsWith("layer-") ||
                          (config_id || "").startsWith("gemini3-L");

        // Compute average scores across all questions
        const scoreDocs = r.scores as Record<string, number>[];
        const avgScores: Record<string, number> = {};
        if (scoreDocs.length > 0) {
          const dims = Object.keys(scoreDocs[0]).filter(
            (k) => !["notes", "_assessments"].includes(k)
          );
          for (const dim of dims) {
            const vals = scoreDocs.map((s) => s[dim] || 0);
            avgScores[dim] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
          }
          const dimVals = Object.values(avgScores);
          avgScores._overall = dimVals.length > 0
            ? Math.round((dimVals.reduce((a, b) => a + b, 0) / dimVals.length) * 10) / 10
            : 0;
        }

        const entry = {
          layer: layer || "full",
          config_id: config_id || model_id,
          avg_scores: avgScores,
          overall: avgScores._overall || 0,
          count: r.count,
          run_id: r.run_id,
        };

        if (isAblation) {
          ablation.push({
            model_id,
            label: r.label || config_id || model_id,
            ...entry,
          });
        } else {
          if (!models[model_id]) {
            models[model_id] = {
              model_id,
              label: r.label || model_id,
              provider: r.provider || "",
              price: r.price || "",
              spectres: {},
            };
          }
          // Use perspective as key, keep the highest-scoring config per perspective
          const key = `${perspective}`;
          if (!models[model_id].spectres[key] || entry.overall > models[model_id].spectres[key].overall) {
            models[model_id].spectres[key] = entry;
          }
        }
      }

      // Get list of all spectres
      const allSpectres = [...new Set(
        Object.values(models).flatMap((m) => Object.keys(m.spectres))
      )].sort();

      res.json({
        models: Object.values(models).sort((a, b) => {
          // Sort by best overall across spectres
          const aMax = Math.max(...Object.values(a.spectres).map((s) => s.overall), 0);
          const bMax = Math.max(...Object.values(b.spectres).map((s) => s.overall), 0);
          return bMax - aMax;
        }),
        ablation: ablation.sort((a, b) => {
          // Group by model, then by layer order
          if (a.model_id !== b.model_id) return a.model_id.localeCompare(b.model_id);
          const layerOrder = ["persona-only", "troop+websearch", "knowledge-only", "knowledge+troop", "full"];
          return layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer);
        }),
        spectres: allSpectres,
      });
    } catch (err) {
      console.error("Portfolio error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
