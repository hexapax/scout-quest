#!/usr/bin/env node
/**
 * Playwright smoke test for scout-quest.hexapax.com
 * Tests: login flow, UI state, preset selection, MCP config, chat routing
 *
 * Usage: node scripts/playwright-librechat-test.mjs
 */

import { chromium } from "playwright";

const BASE_URL = "https://scout-quest.hexapax.com";
const SCREENSHOT_DIR = "/tmp/playwright-screenshots";

async function main() {
  console.log("=== LibreChat Playwright Smoke Test ===\n");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Create screenshot dir
  const { mkdirSync } = await import("fs");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const results = [];
  const pass = (name, detail) => { results.push({ name, status: "PASS", detail }); console.log(`  ✓ ${name}: ${detail || ""}`); };
  const fail = (name, detail) => { results.push({ name, status: "FAIL", detail }); console.log(`  ✗ ${name}: ${detail || ""}`); };
  const info = (name, detail) => { results.push({ name, status: "INFO", detail }); console.log(`  ℹ ${name}: ${detail || ""}`); };

  try {
    // --- Test 1: Page loads ---
    console.log("\n--- Test 1: Page loads ---");
    const response = await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    if (response && response.ok()) {
      pass("Page loads", `HTTP ${response.status()}`);
    } else {
      fail("Page loads", `HTTP ${response?.status() || "no response"}`);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-initial-load.png` });

    // Check if we're on login page or main app
    const url = page.url();
    info("Current URL", url);

    // --- Test 2: Login page detection ---
    console.log("\n--- Test 2: Login page ---");
    const isLoginPage = url.includes("/login") || url.includes("/auth");
    if (isLoginPage) {
      info("Login page detected", "Need to authenticate");

      // Check for Google OAuth button
      const googleBtn = await page.$('button:has-text("Google"), a:has-text("Google"), [data-provider="google"]');
      if (googleBtn) {
        pass("Google OAuth button", "Found on login page");
      } else {
        info("Google OAuth button", "Not found — checking other auth options");
      }

      // Check for email/password form
      const emailInput = await page.$('input[type="email"], input[name="email"]');
      const passwordInput = await page.$('input[type="password"]');
      if (emailInput && passwordInput) {
        info("Email/password login", "Available");
      }

      await page.screenshot({ path: `${SCREENSHOT_DIR}/02-login-page.png` });
    } else {
      pass("Skipped login", "Already authenticated or no login required");
    }

    // --- Test 3: Check page content (even without auth) ---
    console.log("\n--- Test 3: Page content audit ---");
    const pageText = await page.textContent("body");

    // Check for LibreChat branding
    if (pageText?.includes("LibreChat") || pageText?.includes("Scout")) {
      info("App identified", "LibreChat / Scout Quest detected");
    }

    // Look for model/preset selectors
    const presetSelector = await page.$('[class*="preset"], [data-testid*="preset"], [class*="model-select"], select[name="model"]');
    if (presetSelector) {
      info("Preset selector", "Found");
    }

    // --- Test 4: Check for visible UI elements ---
    console.log("\n--- Test 4: UI element audit ---");

    // Sidebar
    const sidebar = await page.$('nav, [class*="sidebar"], [role="navigation"]');
    info("Sidebar", sidebar ? "Present" : "Not found");

    // Chat input
    const chatInput = await page.$('textarea, [contenteditable="true"], input[type="text"][placeholder*="message" i]');
    info("Chat input", chatInput ? "Present" : "Not found (may need auth)");

    // New chat button
    const newChatBtn = await page.$('button:has-text("New"), a:has-text("New chat"), [data-testid*="new"]');
    info("New chat button", newChatBtn ? "Present" : "Not found");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-ui-audit.png`, fullPage: true });

    // --- Test 5: Check network requests for backend routing ---
    console.log("\n--- Test 5: Network / API audit ---");

    // Check if /api/models endpoint works
    const modelsResp = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/models", { credentials: "include" });
        return { status: r.status, ok: r.ok };
      } catch (e) {
        return { error: e.message };
      }
    });
    info("GET /api/models", JSON.stringify(modelsResp));

    // Check backend health directly through Caddy
    const backendHealth = await page.evaluate(async () => {
      try {
        const r = await fetch("/backend/health");
        if (r.ok) return await r.json();
        return { status: r.status };
      } catch (e) {
        return { error: e.message };
      }
    });
    if (backendHealth?.status === "ok") {
      pass("Backend health via Caddy", "/backend/health returns ok");
    } else {
      info("Backend health via Caddy", JSON.stringify(backendHealth));
    }

    // --- Test 6: Check LibreChat config ---
    console.log("\n--- Test 6: LibreChat config ---");
    const configResp = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/config", { credentials: "include" });
        if (r.ok) {
          const data = await r.json();
          return {
            status: r.status,
            registration: data.registration,
            socialLogin: data.socialLogin,
            endpoints: Object.keys(data.endpoints || {}),
            modelSpecs: data.modelSpecs ? "present" : "absent",
          };
        }
        return { status: r.status };
      } catch (e) {
        return { error: e.message };
      }
    });
    info("LibreChat config", JSON.stringify(configResp));

    // --- Test 7: Check for MCP server configuration ---
    console.log("\n--- Test 7: MCP server status ---");

    // LibreChat's MCP config is in librechat.yaml — check via the startup endpoint
    const startupResp = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/config/startup", { credentials: "include" });
        if (r.ok) return await r.json();
        return { status: r.status };
      } catch (e) {
        return { error: e.message };
      }
    });
    info("Startup config", JSON.stringify(startupResp).substring(0, 500));

    // --- Test 8: Check CSS / UI customization ---
    console.log("\n--- Test 8: UI customization ---");

    // Check page title
    const title = await page.title();
    info("Page title", title);

    // Check for custom CSS or branding
    const hasCustomBranding = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="description"]');
      const logo = document.querySelector('img[alt*="logo" i], img[class*="logo" i]');
      return {
        description: meta?.content || null,
        hasLogo: !!logo,
        logoSrc: logo?.src || null,
      };
    });
    info("Branding", JSON.stringify(hasCustomBranding));

    // Check all visible text for scout-related content
    const scoutContent = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const matches = [];
      for (const kw of ["Scout", "Troop", "BSA", "Coach", "Guide", "quest"]) {
        if (body.toLowerCase().includes(kw.toLowerCase())) matches.push(kw);
      }
      return matches;
    });
    info("Scout-related content visible", scoutContent.length > 0 ? scoutContent.join(", ") : "None visible");

    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-final-state.png`, fullPage: true });

  } catch (err) {
    fail("Test error", err.message);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  // --- Summary ---
  console.log("\n=== Summary ===");
  const passes = results.filter(r => r.status === "PASS").length;
  const fails = results.filter(r => r.status === "FAIL").length;
  const infos = results.filter(r => r.status === "INFO").length;
  console.log(`  ${passes} passed, ${fails} failed, ${infos} info`);
  console.log(`\nScreenshots: ${SCREENSHOT_DIR}/`);

  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
