/** Google OAuth2 routes for the Scout Quest app.
 *
 * GET  /auth/google   — redirect to Google consent screen
 * GET  /auth/callback — exchange code for tokens, set JWT cookie, redirect to app
 * GET  /auth/me       — return current user from cookie
 * POST /auth/logout   — clear cookie
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const JWT_SECRET = process.env.APP_JWT_SECRET || process.env.BACKEND_API_KEY || "dev-secret";
const COOKIE_NAME = "sq_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AppUser {
  email: string;
  name: string;
  picture: string;
}

/** Extract user from JWT cookie. Returns null if not authenticated. */
export function getUserFromCookie(req: Request): AppUser | null {
  const token = req.cookies?.[COOKIE_NAME] || parseCookieManual(req, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AppUser;
    return { email: payload.email, name: payload.name, picture: payload.picture };
  } catch {
    return null;
  }
}

/** Manual cookie parsing (no cookie-parser middleware needed). */
function parseCookieManual(req: Request, name: string): string | null {
  const header = req.headers.cookie || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3090";
  return `${proto}://${host}`;
}

export function createAuthRouter(): Router {
  const router = createRouter();

  // Step 1: Redirect to Google
  router.get("/auth/google", (req: Request, res: Response) => {
    if (!GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured" });
      return;
    }
    const redirectUri = `${getBaseUrl(req)}/auth/callback`;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // Step 2: Google callback — exchange code for tokens, set cookie
  router.get("/auth/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).send("Missing code parameter");
      return;
    }

    try {
      const redirectUri = `${getBaseUrl(req)}/auth/callback`;

      // Exchange code for tokens
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.text();
        console.error("[auth] Token exchange failed:", err);
        res.status(500).send("Authentication failed");
        return;
      }

      const tokens = (await tokenResp.json()) as { id_token?: string; access_token?: string };

      // Get user info
      const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResp.ok) {
        res.status(500).send("Failed to get user info");
        return;
      }

      const userInfo = (await userResp.json()) as { email: string; name: string; picture: string };
      console.log(`[auth] User logged in: ${userInfo.email} (${userInfo.name})`);

      // Issue JWT
      const token = jwt.sign(
        { email: userInfo.email, name: userInfo.name, picture: userInfo.picture },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      // Set cookie and redirect to app
      res.setHeader("Set-Cookie",
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE / 1000}; Secure`
      );
      res.redirect("/app.html");
    } catch (err) {
      console.error("[auth] Callback error:", err);
      res.status(500).send("Authentication failed");
    }
  });

  // Get current user
  router.get("/auth/me", (req: Request, res: Response) => {
    const user = getUserFromCookie(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(user);
  });

  // Logout
  router.post("/auth/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie",
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
    );
    res.json({ ok: true });
  });

  return router;
}
