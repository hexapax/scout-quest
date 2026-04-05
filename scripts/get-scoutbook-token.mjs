#!/usr/bin/env node
/**
 * Open a browser to my.scouting.org, wait for login, extract JWT token.
 * Usage: node scripts/get-scoutbook-token.mjs
 *
 * After extracting the token, kicks off the Scoutbook sync on the VM.
 */

import { chromium } from "playwright";

const LOGIN_URL = "https://my.scouting.org";
const TOKEN_COOKIE_PREFIX = "eyJ";
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min to log in

console.log("Opening browser to my.scouting.org...");
console.log("Log in manually — I'll extract the token when you're done.\n");

const browser = await chromium.launch({ headless: false, channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(LOGIN_URL);

// Poll for JWT cookie
const startTime = Date.now();
let token = null;

while (Date.now() - startTime < TIMEOUT_MS) {
  const cookies = await context.cookies();
  const jwtCookie = cookies.find(
    (c) => c.value.startsWith(TOKEN_COOKIE_PREFIX) && c.value.length > 100
  );
  if (jwtCookie) {
    token = jwtCookie.value;
    console.log(`\nToken found! (cookie: ${jwtCookie.name}, ${token.length} chars)`);
    console.log(`Token preview: ${token.substring(0, 40)}...`);
    break;
  }

  // Also check for tokens in localStorage
  try {
    const stored = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (val && val.startsWith("eyJ") && val.length > 100) {
          return { key, val };
        }
      }
      return null;
    });
    if (stored) {
      token = stored.val;
      console.log(`\nToken found in localStorage! (key: ${stored.key}, ${token.length} chars)`);
      console.log(`Token preview: ${token.substring(0, 40)}...`);
      break;
    }
  } catch {
    // Page might not be ready yet
  }

  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
}

await browser.close();

if (!token) {
  console.error("\nTimeout — no token found after 5 minutes.");
  process.exit(1);
}

// Output token for piping
console.log(`\nSCOUTBOOK_TOKEN=${token}`);
console.log("\nTo sync, run:");
console.log(`  SCOUTBOOK_TOKEN=${token.substring(0, 20)}... bash scripts/run-token-sync-vm.sh`);

// Write to temp file for easy use
import { writeFileSync } from "fs";
const tmpFile = "/tmp/scoutbook-token.txt";
writeFileSync(tmpFile, token);
console.log(`\nToken saved to ${tmpFile}`);
