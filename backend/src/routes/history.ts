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
import { getScoutQuestDb } from "../db.js";
import { getUserFromCookie } from "./auth.js";
import { lookupUserRole } from "../auth/role-lookup.js";

interface ConversationListItem {
  _id: unknown;
  title: string;
  model: string;
  channel: "chat" | "voice" | null;
  userEmail: string;
  scoutEmail?: string | null;
  troopId?: string | null;
  messageCount: number;
  updatedAt: Date;
  createdAt: Date;
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
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(MAX_LIST)
    .project({
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
    })
    .toArray();

  return docs as unknown as ConversationListItem[];
}
