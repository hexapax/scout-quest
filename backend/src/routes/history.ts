/**
 * Role-based conversation-history viewing — Stream B endpoints from
 * docs/plans/2026-04-16-alpha-launch-plan.md.
 *
 * Endpoint   | Who                         | Filters by
 * ---------- | --------------------------- | ----------
 * /mine      | any authenticated user      | userEmail = me
 * /scout/:e  | parent of scout `e`         | scoutEmail = e (parent role check)
 * /troop/:t  | leader of troop `t`         | troopId = t (leader/admin role check)
 * /all       | admin/superuser             | unfiltered
 *
 * Authorization is enforced server-side via `lookupUserRole` — a parent who
 * isn't on the scout's `scoutEmails` list gets 403, even if the route is
 * publicly reachable. We don't trust the URL alone.
 *
 * Returns lightweight summaries (no message bodies). For the full transcript,
 * call the existing `GET /api/conversations/:id` — that endpoint will need a
 * matching auth widening when the history viewer wants to load other people's
 * conversations. Tracked separately; this PR only ships the listing endpoints.
 */

import express, { type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getScoutQuestDb } from "../db.js";
import { getUserFromCookie } from "./auth.js";
import { lookupUserRole } from "../auth/role-lookup.js";

interface ConversationListItem {
  _id: unknown;
  title: string;
  /** First user-message snippet, trimmed to ~80 chars. Shown as fallback when
   *  `title` is blank or literally "(untitled)". Derived by the aggregation
   *  pipeline in listConversations so the client can render without fetching
   *  the full doc. */
  firstMessage?: string;
  model: string;
  channel: "chat" | "voice" | null;
  userEmail: string;
  scoutEmail?: string | null;
  troopId?: string | null;
  messageCount: number;
  updatedAt: Date;
  createdAt: Date;
  /** Set by POST /api/history/conversation/:id/reviewed. A reviewer marking a
   *  conversation stamps their email + timestamp; the client shows a tick and
   *  can filter unread-only. Does not modify the conversation body. */
  reviewedBy?: string;
  reviewedAt?: Date;
}

const COLLECTION = "conversations";
const MAX_LIST = 100;

export function createHistoryRouter(): express.Router {
  const router = express.Router();

  /** Own history. Equivalent to existing GET /api/conversations but lives under
   *  /api/history/* for symmetry with the other role-scoped endpoints. */
  router.get("/api/history/mine", async (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const filter = applyChannelFilter({ userEmail: user.email }, req);
    res.json(await listConversations(filter));
  });

  /** Parent → child: list a single scout's conversations. Parents may only
   *  view scouts in their `scoutEmails`; admins may view any scout. */
  router.get("/api/history/scout/:email", async (req: Request, res: Response) => {
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

    const filter = applyChannelFilter(
      { $or: [{ scoutEmail }, { userEmail: scoutEmail }] },
      req,
    );
    res.json(await listConversations(filter));
  });

  /** Leader → troop: all conversations in a troop. Leaders/admins only.
   *  A leader may only view their *own* troop unless they're an admin. */
  router.get("/api/history/troop/:troopId", async (req: Request, res: Response) => {
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

    const filter = applyChannelFilter({ troopId }, req);
    res.json(await listConversations(filter));
  });

  /** Admin: unfiltered. Returns the most recent MAX_LIST conversations. */
  router.get("/api/history/all", async (req: Request, res: Response) => {
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

    const filter = applyChannelFilter({}, req);
    res.json(await listConversations(filter));
  });

  /**
   * Role-aware transcript endpoint — returns the full message body.
   *
   * Authorized when ANY of:
   *   - caller owns the conversation (userEmail matches)
   *   - caller is a parent of the conversation's scoutEmail
   *   - caller is a leader of the conversation's troopId
   *   - caller is admin/superuser
   *
   * Kept separate from the existing `GET /api/conversations/:id` (which
   * is strictly own-only) so app.html's user-side UX stays unchanged.
   */
  router.get("/api/history/conversation/:id", async (req: Request, res: Response) => {
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
      const doc = await db.collection("conversations").findOne({ _id: oid });
      if (!doc) {
        res.status(404).json({ error: "Conversation not found" });
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
        res.status(403).json({ error: "You don't have access to this conversation." });
        return;
      }

      res.json(doc);
    } catch (err) {
      console.error("[history] conversation read error:", err);
      res.status(500).json({ error: "Failed to load conversation" });
    }
  });

  /**
   * Mark a conversation as reviewed by the caller (or clear the mark).
   *
   *   POST /api/history/conversation/:id/reviewed    { reviewed: true|false }
   *
   * Authorization re-uses the read check from GET /api/history/conversation/:id
   * — if you can see a conversation, you can mark it reviewed. Scouts can
   * mark their own conversations reviewed too; harmless, and saves us a
   * second role check.
   */
  router.post("/api/history/conversation/:id/reviewed", async (req: Request, res: Response) => {
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

    const reviewed = req.body?.reviewed !== false;

    try {
      const db = getScoutQuestDb();
      const doc = await db.collection("conversations").findOne({ _id: oid });
      if (!doc) {
        res.status(404).json({ error: "Conversation not found" });
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
        res.status(403).json({ error: "You don't have access to this conversation." });
        return;
      }

      if (reviewed) {
        await db.collection("conversations").updateOne(
          { _id: oid },
          { $set: { reviewedBy: user.email, reviewedAt: new Date() } },
        );
      } else {
        await db.collection("conversations").updateOne(
          { _id: oid },
          { $unset: { reviewedBy: "", reviewedAt: "" } },
        );
      }

      res.json({ ok: true, reviewed });
    } catch (err) {
      console.error("[history] reviewed update error:", err);
      res.status(500).json({ error: "Failed to update review state" });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add `?channel=voice|chat` filtering to any base filter. */
function applyChannelFilter(
  base: Record<string, unknown>,
  req: Request,
): Record<string, unknown> {
  const ch = req.query.channel;
  if (ch === "voice" || ch === "chat") {
    return { ...base, channel: ch };
  }
  return base;
}

async function listConversations(
  filter: Record<string, unknown>,
): Promise<ConversationListItem[]> {
  const db = getScoutQuestDb();
  const docs = await db
    .collection(COLLECTION)
    .aggregate([
      { $match: filter },
      { $sort: { updatedAt: -1 } },
      { $limit: MAX_LIST },
      {
        $project: {
          _id: 1,
          title: 1,
          model: 1,
          channel: 1,
          userEmail: 1,
          scoutEmail: 1,
          troopId: 1,
          updatedAt: 1,
          createdAt: 1,
          messageCount: { $size: { $ifNull: ["$messages", []] } },
          reviewedBy: 1,
          reviewedAt: 1,
          // Pull the first user message's content for the fallback label on
          // rows where `title` is blank/"(untitled)". `$filter` keeps only
          // user-role turns; `$arrayElemAt` 0 grabs the earliest.
          firstMessage: {
            $let: {
              vars: {
                userMsgs: {
                  $filter: {
                    input: { $ifNull: ["$messages", []] },
                    as: "m",
                    cond: { $eq: ["$$m.role", "user"] },
                  },
                },
              },
              in: {
                $substrCP: [
                  { $ifNull: [{ $arrayElemAt: ["$$userMsgs.content", 0] }, ""] },
                  0,
                  80,
                ],
              },
            },
          },
        },
      },
    ])
    .toArray();

  return docs as unknown as ConversationListItem[];
}
