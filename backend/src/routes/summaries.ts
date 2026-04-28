/**
 * Conversation-summary read endpoints — Stream G step 7.
 *
 * Mirrors the role-gating shape of routes/history.ts, but reads from
 * `conversation_summaries` (per Stream G design 2026-04-26-scout-state-and-summaries.md)
 * instead of `conversations`.
 *
 * Endpoint                         | Who                          | Filters by
 * -------------------------------- | ---------------------------- | --------------------
 * GET /api/summaries/mine          | any authenticated user       | userEmail = me
 * GET /api/summaries/scout/:email  | parent of scout `email`      | scoutEmail = email
 * GET /api/summaries/troop/:t      | leader/admin of troop `t`    | troopId = t
 * GET /api/summaries/conversation/:id | role-gated like transcript | _id = id
 *
 * Auth checks are identical to history.ts — kept here rather than factored out
 * because the rules differ from /api/history/* in subtle ways yet (e.g. when
 * Stream G ships scout_recap, scouts may eventually read their own — not yet).
 */

import express, { type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import { getUserFromCookie } from "./auth.js";
import { lookupUserRole } from "../auth/role-lookup.js";

const COLLECTION = "conversation_summaries";
const MAX_LIST = 100;

interface SummaryListItem {
  _id: unknown;
  scoutEmail: string | null;
  userEmail: string;
  troopId?: string | null;
  channel: "chat" | "voice" | "mixed";
  one_liner: string;
  parent_recap: string;
  topics: string[];
  achievements: string[];
  next_steps: string[];
  blockers: string[];
  safety_tier?: 1 | 2 | 3;
  generated_at: Date;
  durationMs: number;
  turnCount: number;
}

const LIST_PROJECTION = {
  scoutEmail: 1,
  userEmail: 1,
  troopId: 1,
  channel: 1,
  one_liner: 1,
  parent_recap: 1,
  topics: 1,
  achievements: 1,
  next_steps: 1,
  blockers: 1,
  safety_tier: 1,
  generated_at: 1,
  durationMs: 1,
  turnCount: 1,
};

async function listSummaries(filter: Record<string, unknown>): Promise<SummaryListItem[]> {
  const db = getScoutQuestDb();
  return db
    .collection<SummaryListItem>(COLLECTION)
    .find(filter, { projection: LIST_PROJECTION })
    .sort({ generated_at: -1 })
    .limit(MAX_LIST)
    .toArray();
}

export function createSummariesRouter(): express.Router {
  const router = express.Router();

  router.get("/api/summaries/mine", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.json(await listSummaries({ userEmail: user.email }));
  });

  router.get("/api/summaries/scout/:email", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const scoutEmail = String(req.params.email).toLowerCase();
    const roleInfo = await lookupUserRole(user.email);

    const allowed =
      roleInfo.isAdmin ||
      roleInfo.scoutEmails.map((s) => s.toLowerCase()).includes(scoutEmail);

    if (!allowed) {
      res.status(403).json({
        error: "You can only view scouts you are listed as a parent for.",
      });
      return;
    }

    res.json(
      await listSummaries({ $or: [{ scoutEmail }, { userEmail: scoutEmail }] }),
    );
  });

  router.get("/api/summaries/troop/:troopId", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const troopId = String(req.params.troopId);
    const roleInfo = await lookupUserRole(user.email);
    const isLeaderRole = roleInfo.roles.some(
      (r) => r === "leader" || r === "admin" || r === "superuser",
    );

    if (!isLeaderRole) {
      res.status(403).json({ error: "Leader role required" });
      return;
    }
    if (!roleInfo.isAdmin && roleInfo.troop !== troopId) {
      res.status(403).json({ error: "You can only view your own troop." });
      return;
    }

    res.json(await listSummaries({ troopId }));
  });

  router.get("/api/summaries/all", async (req: Request, res: Response) => {
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
    res.json(await listSummaries({}));
  });

  /**
   * Single summary — full body including scout_recap. Role gate matches
   * GET /api/history/conversation/:id (owner / parent of scout / leader of troop / admin).
   */
  router.get("/api/summaries/conversation/:id", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(String(req.params.id));
    } catch {
      res.status(400).json({ error: "Invalid conversation ID" });
      return;
    }

    try {
      const db = getScoutQuestDb();
      const doc = await db.collection(COLLECTION).findOne({ _id: oid });
      if (!doc) {
        res.status(404).json({ error: "Summary not found" });
        return;
      }

      const roleInfo = await lookupUserRole(user.email);
      const lowerEmail = user.email.toLowerCase();
      const ownsIt = String(doc.userEmail ?? "").toLowerCase() === lowerEmail;
      const isParentOfScout =
        !!doc.scoutEmail &&
        roleInfo.scoutEmails.map((e) => e.toLowerCase()).includes(String(doc.scoutEmail).toLowerCase());
      const isLeaderForTroop =
        !!doc.troopId &&
        (roleInfo.roles.includes("leader") ||
          roleInfo.roles.includes("admin") ||
          roleInfo.roles.includes("superuser")) &&
        (roleInfo.troop === doc.troopId || roleInfo.isAdmin);

      if (!(ownsIt || isParentOfScout || isLeaderForTroop || roleInfo.isAdmin)) {
        res.status(403).json({ error: "You don't have access to this summary." });
        return;
      }

      res.json(doc);
    } catch (err) {
      console.error("[summaries] fetch failed:", err);
      res.status(500).json({ error: "Failed to load summary" });
    }
  });

  return router;
}
