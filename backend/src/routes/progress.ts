/** Progress API — serves scout advancement data for the progress micro-app.
 * GET /api/progress?email=<scout_email>
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { getScoutQuestDb } from "../db.js";

export function createProgressRouter(): Router {
  const router = createRouter();

  router.get("/api/progress", async (req: Request, res: Response) => {
    const email = req.query.email as string | undefined;
    if (!email) {
      res.status(400).json({ error: "email query parameter required" });
      return;
    }

    try {
      const db = getScoutQuestDb();

      // Find scout by email in scoutbook data
      const scoutbookScout = await db.collection("scoutbook_scouts").findOne({
        $or: [{ email }, { "parents": { $elemMatch: { email } } }],
      });
      if (!scoutbookScout) {
        res.status(404).json({ error: "Scout not found" });
        return;
      }

      const userId = (scoutbookScout as any).userId;
      const name = `${(scoutbookScout as any).firstName ?? ""} ${(scoutbookScout as any).lastName ?? ""}`.trim();

      // Get advancement data
      const advancement = await db.collection("scoutbook_advancement")
        .find({ userId })
        .toArray();

      // Get requirements for in-progress items
      const requirements = await db.collection("scoutbook_requirements")
        .find({ userId })
        .toArray();

      // Group requirements by advancement
      const reqByAdv = new Map<string, any[]>();
      for (const req of requirements) {
        const key = `${(req as any).advancementType}:${(req as any).advancementId}`;
        const existing = reqByAdv.get(key);
        if (existing) existing.push(req);
        else reqByAdv.set(key, [req]);
      }

      // Build response
      const ranks = advancement
        .filter((a: any) => a.type === "rank")
        .map((a: any) => ({
          name: a.name,
          advancementId: a.advancementId,
          status: a.status,
          percentComplete: a.percentCompleted ?? 0,
          dateAwarded: a.dateAwarded,
          dateStarted: a.dateStarted,
          requirements: (reqByAdv.get(`rank:${a.advancementId}`) ?? [])
            .sort((x: any, y: any) =>
              (x.reqNumber ?? "").localeCompare(y.reqNumber ?? "", undefined, { numeric: true })
            )
            .map((r: any) => ({
              number: r.reqNumber,
              name: r.reqName,
              completed: !!r.completed,
              started: !!r.started,
              dateCompleted: r.dateCompleted,
            })),
        }));

      const meritBadges = advancement
        .filter((a: any) => a.type === "meritBadge")
        .map((a: any) => ({
          name: a.name,
          advancementId: a.advancementId,
          status: a.status,
          percentComplete: a.percentCompleted ?? 0,
          dateAwarded: a.dateAwarded,
          isEagleRequired: a.isEagleRequired ?? false,
          requirements: (reqByAdv.get(`meritBadge:${a.advancementId}`) ?? [])
            .sort((x: any, y: any) =>
              (x.reqNumber ?? "").localeCompare(y.reqNumber ?? "", undefined, { numeric: true })
            )
            .map((r: any) => ({
              number: r.reqNumber,
              name: r.reqName,
              completed: !!r.completed,
              started: !!r.started,
              dateCompleted: r.dateCompleted,
            })),
        }));

      // Activity summary
      const activitySummary = (scoutbookScout as any).activitySummary ?? {};

      res.json({
        name,
        userId,
        currentRank: (scoutbookScout as any).currentRank?.name ?? null,
        activitySummary: {
          campingNights: activitySummary.campingNights ?? 0,
          hikingMiles: activitySummary.hikingMiles ?? 0,
          serviceHours: activitySummary.serviceHours ?? 0,
        },
        ranks,
        meritBadges,
        syncedAt: (scoutbookScout as any).syncedAt ?? null,
      });
    } catch (err) {
      console.error("Progress API error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
