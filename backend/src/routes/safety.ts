/**
 * Stream H step 7: admin Safety Queue read endpoints.
 *
 * Phase 1 scope — read-only. Review/decide/document UI lands in step 10
 * (Phase 2). Admin-gated; non-admins get 403.
 *
 * Endpoint                           | Returns
 * -----------------------------------|----------------------------------------
 * GET /api/safety/events             | recent SafetyEvent[] (filter: ?tier=)
 * GET /api/safety/events/:id         | full SafetyEvent doc
 *
 * Filter params:
 *   ?tier=1|2|3   — narrow by tier
 *   ?limit=N      — cap (default 50, max 200)
 *   ?openOnly=1   — caseClosed=false only
 */

import express, { type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getUserFromCookie } from "./auth.js";
import { lookupUserRole } from "../auth/role-lookup.js";
import { getSafetyEvent, listRecentForAdmin } from "../safety/store.js";

async function requireAdmin(
  req: Request,
  res: Response,
): Promise<boolean> {
  const user = getUserFromCookie(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  const roleInfo = await lookupUserRole(user.email);
  if (!roleInfo.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

function parseTier(v: unknown): 1 | 2 | 3 | undefined {
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 ? n : undefined;
}

export function createSafetyRouter(): express.Router {
  const router = express.Router();

  router.get("/api/safety/events", async (req: Request, res: Response) => {
    if (!(await requireAdmin(req, res))) return;

    const tier = parseTier(req.query.tier);
    const limit = Math.max(
      1,
      Math.min(200, Number(req.query.limit) || 50),
    );
    const openOnly = req.query.openOnly === "1" || req.query.openOnly === "true";

    try {
      const events = await listRecentForAdmin({
        tier,
        limit,
        ...(openOnly ? { caseClosed: false } : {}),
      });
      res.json(events);
    } catch (err) {
      console.error("[safety] list failed:", err);
      res.status(500).json({ error: "Failed to load safety events" });
    }
  });

  router.get("/api/safety/events/:id", async (req: Request, res: Response) => {
    if (!(await requireAdmin(req, res))) return;

    let oid: ObjectId;
    try {
      oid = new ObjectId(String(req.params.id));
    } catch {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    try {
      const ev = await getSafetyEvent(oid);
      if (!ev) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      res.json(ev);
    } catch (err) {
      console.error("[safety] read failed:", err);
      res.status(500).json({ error: "Failed to load safety event" });
    }
  });

  return router;
}
