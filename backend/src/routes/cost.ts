/**
 * Cost summary API — admin-facing aggregations over the `message_usage`
 * collection that `cost/logger.ts` writes to.
 *
 * Endpoints:
 *
 *   GET /api/cost/summary?scope=global|user|scout|troop&period=today|week|month[&id=<scope-id>]
 *
 * `scope=user` and `scope=scout` require `id` (the email).
 * `scope=troop` requires `id` (the troop label).
 * `scope=global` ignores `id`.
 *
 * Only admins (per `lookupUserRole`) may call this — non-admin requests
 * with a valid cookie get 403, anonymous get 401.
 */

import express, { type Request, type Response } from "express";
import { getScoutQuestDb } from "../db.js";
import { getUserFromCookie } from "./auth.js";
import { lookupUserRole } from "../auth/role-lookup.js";

type Scope = "global" | "user" | "scout" | "troop";
type Period = "today" | "week" | "month";

interface SummaryRow {
  key: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

interface SummaryResponse {
  scope: Scope;
  period: Period;
  id: string | null;
  since: string;
  totals: SummaryRow;
  byModel: SummaryRow[];
  byUser?: SummaryRow[];
  byScout?: SummaryRow[];
}

export function createCostRouter(): express.Router {
  const router = express.Router();

  router.get("/api/cost/summary", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const roleInfo = await lookupUserRole(user.email);
    if (!roleInfo.isAdmin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const scope = (req.query.scope as Scope) || "global";
    const period = (req.query.period as Period) || "today";
    const id = (req.query.id as string | undefined) || null;

    if (!isValidScope(scope)) {
      res.status(400).json({ error: `Invalid scope. Use one of: global, user, scout, troop` });
      return;
    }
    if (!isValidPeriod(period)) {
      res.status(400).json({ error: `Invalid period. Use one of: today, week, month` });
      return;
    }
    if ((scope === "user" || scope === "scout" || scope === "troop") && !id) {
      res.status(400).json({ error: `scope=${scope} requires &id=<value>` });
      return;
    }

    const since = periodStart(period);
    const match: Record<string, unknown> = { createdAt: { $gte: since } };
    if (scope === "user") match.userEmail = id;
    else if (scope === "scout") match.scoutEmail = id;
    else if (scope === "troop") match.troopId = id;

    try {
      const coll = getScoutQuestDb().collection("message_usage");
      const totals = await aggregateOne(coll, match);

      const byModelDocs = await coll
        .aggregate([
          { $match: match },
          { $group: groupBy("$modelExact") },
          { $sort: { costUsd: -1 } },
        ])
        .toArray();
      const byModel: SummaryRow[] = byModelDocs.map(rowFromDoc);

      const response: SummaryResponse = {
        scope,
        period,
        id,
        since: since.toISOString(),
        totals,
        byModel,
      };

      // Global scope is most useful with leaderboards.
      if (scope === "global") {
        const byUserDocs = await coll
          .aggregate([
            { $match: match },
            { $group: groupBy("$userEmail") },
            { $sort: { costUsd: -1 } },
            { $limit: 25 },
          ])
          .toArray();
        response.byUser = byUserDocs.map(rowFromDoc);

        const byScoutDocs = await coll
          .aggregate([
            { $match: { ...match, scoutEmail: { $ne: null } } },
            { $group: groupBy("$scoutEmail") },
            { $sort: { costUsd: -1 } },
            { $limit: 25 },
          ])
          .toArray();
        response.byScout = byScoutDocs.map(rowFromDoc);
      }

      res.json(response);
    } catch (err) {
      console.error("[cost] summary error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidScope(s: string): s is Scope {
  return s === "global" || s === "user" || s === "scout" || s === "troop";
}

function isValidPeriod(p: string): p is Period {
  return p === "today" || p === "week" || p === "month";
}

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === "week") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 7);
    return d;
  }
  // month
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

function groupBy(field: string): Record<string, unknown> {
  return {
    _id: field,
    calls: { $sum: 1 },
    promptTokens: { $sum: "$promptTokens" },
    completionTokens: { $sum: "$completionTokens" },
    cacheReadTokens: { $sum: "$cacheReadTokens" },
    costUsd: { $sum: "$costUsd" },
  };
}

async function aggregateOne(
  coll: ReturnType<ReturnType<typeof getScoutQuestDb>["collection"]>,
  match: Record<string, unknown>,
): Promise<SummaryRow> {
  const docs = await coll
    .aggregate([{ $match: match }, { $group: { ...groupBy("null"), _id: null } }])
    .toArray();
  if (!docs.length) {
    return { key: "total", calls: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  }
  return rowFromDoc({ ...docs[0], _id: "total" });
}

function rowFromDoc(doc: Record<string, unknown>): SummaryRow {
  return {
    key: String(doc._id ?? "unknown"),
    calls: Number(doc.calls ?? 0),
    promptTokens: Number(doc.promptTokens ?? 0),
    completionTokens: Number(doc.completionTokens ?? 0),
    cacheReadTokens: Number(doc.cacheReadTokens ?? 0),
    costUsd: Math.round(Number(doc.costUsd ?? 0) * 1e6) / 1e6,
  };
}
