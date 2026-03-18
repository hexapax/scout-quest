/** Express routes for pending actions.
 * GET  /actions/:id          — get action details (for micro-app rendering)
 * POST /actions/:id/execute  — execute the action (optionally with updated payload)
 * POST /actions/:id/cancel   — cancel the action
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import {
  getPendingAction,
  executePendingAction,
  cancelPendingAction,
  type PendingActionDoc,
} from "../pending-action.js";
import { getBsaToken } from "../bsa-token.js";
import { advanceRequirement, rsvpEvent, ORG_GUID } from "../bsa-api.js";

/** Execute the actual BSA API call for a pending action. */
async function executeActionPayload(
  doc: PendingActionDoc
): Promise<{ ok: boolean; message: string; result?: unknown }> {
  const p = doc.payload;

  switch (doc.type) {
    case "send_email": {
      // Email is sent via BSA API
      const tokenDoc = await getBsaToken();
      if (!tokenDoc) return { ok: false, message: "No valid BSA token" };

      const res = await fetch(`https://api.scouting.org/advancements/v2/${ORG_GUID}/email`, {
        method: "POST",
        headers: {
          Authorization: `bearer ${tokenDoc.token}`,
          "Content-Type": "application/json",
          Origin: "https://advancements.scouting.org",
          Referer: "https://advancements.scouting.org/",
        },
        body: JSON.stringify({
          to: { memberId: p.toMemberIds as number[] },
          bcc: { memberId: p.bccMemberIds ?? [] },
          subject: p.subject,
          body: p.body,
        }),
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, message: `BSA API ${res.status}: ${text}` };
      return { ok: true, message: "Email sent", result: JSON.parse(text) };
    }

    case "advance_requirement": {
      const tokenDoc = await getBsaToken();
      if (!tokenDoc) return { ok: false, message: "No valid BSA token" };
      const result = await advanceRequirement({
        rankId: Number(p.rankId),
        scoutUserId: Number(p.scoutUserId),
        leaderUserId: Number(tokenDoc.leaderUserId),
        requirements: [
          {
            requirementId: Number(p.requirementId),
            completed: true,
            started: true,
            approved: true,
            dateCompleted: String(p.dateCompleted),
            leaderApprovedUserId: Number(tokenDoc.leaderUserId),
          },
        ],
      });
      return { ok: true, message: "Requirement advanced", result };
    }

    case "rsvp_event": {
      const result = await rsvpEvent({
        eventId: Number(p.eventId),
        userId: Number(p.scoutUserId),
        rsvpCode: String(p.rsvpCode) as "Y" | "M" | "N",
      });
      return { ok: true, message: "RSVP updated", result };
    }

    default:
      return { ok: false, message: `Unknown action type: ${doc.type}` };
  }
}

export function createActionsRouter(): Router {
  const router = createRouter();

  /** Get pending action details. */
  router.get("/actions/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const doc = await getPendingAction(id);
    if (!doc) {
      res.status(404).json({ error: "Action not found" });
      return;
    }
    // Never expose the full BSA token in the payload
    const safePayload = { ...doc.payload };
    delete safePayload.token;
    res.json({
      id: doc._id.toHexString(),
      type: doc.type,
      status: doc.status,
      payload: safePayload,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
      executedAt: doc.executedAt,
    });
  });

  /** Execute a pending action (optionally updating payload first). */
  router.post("/actions/:id/execute", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { updatedPayload } = req.body as { updatedPayload?: Record<string, unknown> };

    // Mark as executed in DB first
    const doc = await executePendingAction(id, updatedPayload);
    if (!doc) {
      res.status(404).json({ error: "Action not found, already executed, or expired" });
      return;
    }

    // Execute the actual API call
    try {
      const result = await executeActionPayload(doc);
      // Store result
      const { getScoutQuestDb } = await import("../db.js");
      const db = getScoutQuestDb();
      const { ObjectId } = await import("mongodb");
      await db.collection("pending_actions").updateOne(
        { _id: new ObjectId(id) },
        { $set: { result: result } }
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** Cancel a pending action. */
  router.post("/actions/:id/cancel", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const doc = await cancelPendingAction(id);
    if (!doc) {
      res.status(404).json({ error: "Action not found or already processed" });
      return;
    }
    res.json({ ok: true, status: "cancelled" });
  });

  return router;
}
