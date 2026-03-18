/** Express route: POST /bsa-token
 * Stores a BSA JWT extracted by the leader from Chrome.
 * Protected by BACKEND_API_KEY.
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import {
  storeBsaToken,
  getBsaToken,
  tokenMinutesRemaining,
} from "../bsa-token.js";

export function createBsaTokenRouter(): Router {
  const router = createRouter();

  /** Store a BSA token.
   * Body: { token: string, leaderUserId: string, storedBy?: string }
   * Header: Authorization: Bearer <BACKEND_API_KEY>
   */
  router.post("/bsa-token", async (req: Request, res: Response) => {
    // Simple API key auth
    const apiKey = process.env.BACKEND_API_KEY;
    const authHeader = req.headers.authorization ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (apiKey && provided !== apiKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { token, leaderUserId, storedBy } = req.body as {
      token?: string;
      leaderUserId?: string;
      storedBy?: string;
    };

    if (!token || typeof token !== "string" || !token.startsWith("eyJ")) {
      res.status(400).json({ error: "token must be a JWT string starting with 'eyJ'" });
      return;
    }
    if (!leaderUserId) {
      res.status(400).json({ error: "leaderUserId is required" });
      return;
    }

    await storeBsaToken(token, String(leaderUserId), storedBy ?? "admin");
    const mins = await tokenMinutesRemaining();
    res.json({ ok: true, expiresInMinutes: mins });
  });

  /** Check token status (no auth required — just returns metadata, not the token). */
  router.get("/bsa-token/status", async (_req: Request, res: Response) => {
    const doc = await getBsaToken();
    if (!doc) {
      res.json({ valid: false, expiresInMinutes: 0 });
      return;
    }
    const mins = await tokenMinutesRemaining();
    res.json({
      valid: true,
      expiresInMinutes: mins,
      storedBy: doc.storedBy,
      storedAt: doc.storedAt,
      leaderUserId: doc.leaderUserId,
    });
  });

  return router;
}
