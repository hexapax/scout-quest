#!/usr/bin/env node
/**
 * Refresh the Scoutbook JWT by driving real Chrome through the BSA web app.
 *
 * Architecture (verified 2026-04-30):
 *   - SPA at https://advancements.scouting.org/ (Scoutbook Plus)
 *   - Auth backend at https://auth.scouting.org/
 *   - On page load the SPA hits /api/users/self_<GUID>/sessions/current; if
 *     no valid session it redirects to /login.
 *   - The login form has a reCAPTCHA v2 checkbox — auto-form-fill from a
 *     cloud IP will fail. Persistent-profile reuse is the only viable path.
 *   - JWT lands in cookies on .scouting.org after a successful sign-in.
 *
 * Modes:
 *   --bootstrap     Headed Chrome with persistent profile. Sign in
 *                   manually (including reCAPTCHA). Run on a workstation
 *                   with a residential IP for best reCAPTCHA score.
 *   (default)       Headless. Reuses the persistent profile; reads the
 *                   JWT from cookies; writes it to token.txt. Never
 *                   touches the form. If the session is gone, exits with
 *                   a "re-bootstrap" hint.
 *   --headed        Default behavior but headed; for debugging.
 *
 * Stealth: real Chrome (channel: 'chrome') + persistent context + stealth
 * plugin. Stops short of solving reCAPTCHA — the persistent profile is
 * how we avoid ever seeing the captcha after the first sign-in.
 */

import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

chromiumExtra.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = process.env.SCOUTBOOK_PROFILE_DIR || join(__dirname, "profile");
const TOKEN_FILE = process.env.SCOUTBOOK_TOKEN_FILE || join(__dirname, "token.txt");
const DEBUG_DIR = join(__dirname, "debug");
const TARGET_URL = process.env.SCOUTBOOK_LOGIN_URL || "https://advancements.scouting.org/";

const args = new Set(process.argv.slice(2));
const BOOTSTRAP = args.has("--bootstrap");
const HEADED = args.has("--headed") || BOOTSTRAP;

const COOKIE_DOMAINS = ["scouting.org", ".scouting.org", "auth.scouting.org", "advancements.scouting.org", "my.scouting.org"];

function isJwtish(value) {
  return typeof value === "string" && /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./.test(value);
}

function decodeJwt(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return payload;
  } catch {
    return null;
  }
}

function pickJwtCookie(cookies) {
  const candidates = cookies
    .filter((c) =>
      COOKIE_DOMAINS.some((d) => c.domain === d || c.domain === "." + d.replace(/^\./, "")),
    )
    .filter((c) => isJwtish(c.value))
    .map((c) => ({ cookie: c, payload: decodeJwt(c.value) }))
    .filter((x) => x.payload && typeof x.payload.exp === "number");
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.payload.exp - a.payload.exp);
  return candidates[0];
}

async function readJwtFromContext(context) {
  const cookies = await context.cookies();
  return pickJwtCookie(cookies);
}

async function main() {
  if (BOOTSTRAP) {
    console.log("[scoutbook-auth] BOOTSTRAP — opening headed Chrome.");
    console.log("    Profile dir : " + PROFILE_DIR);
    console.log("    Sign in manually (and complete the reCAPTCHA). The");
    console.log("    window closes automatically once a JWT cookie lands.");
    console.log("");
  }

  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromiumExtra.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: !HEADED,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    console.log(`[scoutbook-auth] Loading ${TARGET_URL}…`);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    // The SPA does an async session check before redirecting to /login.
    // Give it up to 8s to settle so we capture either the dashboard
    // (logged in) or the login redirect (not logged in).
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const nowSec = Math.floor(Date.now() / 1000);
    const minMargin = 60 * 60; // expire ≥ 1h from now to be considered fresh

    let picked = await readJwtFromContext(context);
    let valid = picked && picked.payload.exp > nowSec + minMargin;

    if (BOOTSTRAP) {
      // Block until JWT is detected (or 5min timeout).
      if (!valid) {
        console.log("[scoutbook-auth] Waiting for sign-in. Polling cookies every 2s…");
        const start = Date.now();
        while (Date.now() - start < 5 * 60 * 1000) {
          await page.waitForTimeout(2000);
          picked = await readJwtFromContext(context);
          valid = picked && picked.payload.exp > nowSec + minMargin;
          if (valid) break;
        }
      }
    }

    if (!valid) {
      // Snapshot for diagnosis.
      mkdirSync(DEBUG_DIR, { recursive: true });
      const shot = join(DEBUG_DIR, `failed-${Date.now()}.png`);
      const finalUrl = page.url();
      try {
        await page.screenshot({ path: shot, fullPage: true });
      } catch { /* ignore */ }

      const onLogin = /\/login(\?|$)/.test(finalUrl);
      const hint = BOOTSTRAP
        ? "No valid JWT cookie after 5min of waiting. Did sign-in complete? Check the open browser window or the screenshot."
        : onLogin
          ? "Session has expired (the SPA redirected to /login). Re-run with --bootstrap on a workstation with a residential IP, then re-sync the profile dir to this host."
          : "No valid JWT cookie in profile. Run with --bootstrap to sign in.";

      throw new Error(`${hint}\n  final URL: ${finalUrl}\n  screenshot: ${shot}`);
    }

    const jwt = picked.cookie.value;
    const expDate = new Date(picked.payload.exp * 1000).toISOString();
    const remainingDays = ((picked.payload.exp * 1000 - Date.now()) / 86_400_000).toFixed(1);

    writeFileSync(TOKEN_FILE, jwt + "\n", { mode: 0o600 });
    console.log(`[scoutbook-auth] Wrote token to ${TOKEN_FILE}`);
    console.log(`    cookie name : ${picked.cookie.name}`);
    console.log(`    cookie domain: ${picked.cookie.domain}`);
    console.log(`    JWT exp     : ${expDate} (${remainingDays} days from now)`);
    console.log(`    JWT user    : ${picked.payload.user || picked.payload.sub || "?"}`);
    console.log("");
    console.log("Use it with:");
    console.log(`    SCOUTBOOK_TOKEN=$(cat ${TOKEN_FILE}) bash scripts/run-token-sync-vm.sh`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
