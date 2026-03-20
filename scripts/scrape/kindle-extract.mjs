#!/usr/bin/env node
/**
 * Extract Kindle book content via CDP screenshots + page navigation.
 * Takes a screenshot of each page/location, saves as PNG for later OCR via Claude Vision.
 *
 * Usage: nvm exec 24 node scripts/scrape/kindle-extract.mjs [--asin ASIN] [--start N] [--end N]
 *
 * Prereq: Chrome with --remote-debugging-port=9222, book already open in Kindle reader
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  return defaultVal;
}

const START_LOC = parseInt(getArg('start', '1'));
const END_LOC = parseInt(getArg('end', '0')); // 0 = auto-detect
const PAGE_DELAY_MS = parseInt(getArg('delay', '2000'));

let ws, msgId = 0;
const pending = new Map();

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++msgId;
    const to = setTimeout(() => { pending.delete(mid); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(mid, { resolve, reject, to });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'eval error');
  return result.result.value;
}

async function main() {
  // Connect to the Kindle reader tab
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.url.includes('read.amazon.com') && t.url.includes('asin'));
  if (!tab) {
    console.error('No Kindle reader tab found. Open a book at read.amazon.com first.');
    process.exit(1);
  }

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, to } = pending.get(msg.id);
      clearTimeout(to);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };

  // Get book info
  const bookInfo = await evaluate(`JSON.stringify({
    url: location.href,
    title: document.title,
    locationText: document.querySelector('ion-footer')?.innerText || '',
  })`);
  const info = JSON.parse(bookInfo);
  const asinMatch = info.url.match(/asin=([A-Z0-9]+)/);
  const asin = asinMatch ? asinMatch[1] : 'unknown';

  // Parse total locations from footer like "Location 1 of 259 ● 0%"
  const locMatch = info.locationText.match(/of\s+(\d+)/);
  const totalLocations = locMatch ? parseInt(locMatch[1]) : 0;
  const endLoc = END_LOC > 0 ? END_LOC : totalLocations;

  console.log(`Book: ${info.title}`);
  console.log(`ASIN: ${asin}`);
  console.log(`Total locations: ${totalLocations}`);
  console.log(`Extracting: locations ${START_LOC} to ${endLoc}`);

  // Create output directory
  const OUTPUT_DIR = path.join(__dirname, '..', '..', 'inbox', 'kindle-extract', asin);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Save book metadata
  fs.writeFileSync(path.join(OUTPUT_DIR, '_metadata.json'), JSON.stringify({
    asin,
    title: info.title,
    url: info.url,
    totalLocations,
    extractedAt: new Date().toISOString(),
    startLocation: START_LOC,
    endLocation: endLoc,
  }, null, 2));

  // Go to start location if not at 1
  if (START_LOC > 1) {
    console.log(`\nNavigating to location ${START_LOC}...`);
    // Use the Kindle reader's go-to-location feature via keyboard shortcut or menu
    // For now, we'll page forward from current position
  }

  // Enable CDP domains
  await cdp('Page.enable');
  await cdp('Input.enable').catch(() => {}); // optional, may not need explicit enable

  // Screenshot loop: capture current page, then press right arrow to advance
  let currentLoc = START_LOC;
  let lastText = '';
  let stuckCount = 0;
  let screenshotCount = 0;

  console.log(`\nStarting extraction...\n`);

  while (currentLoc <= endLoc) {
    // Get current location from footer
    const locInfo = await evaluate(`
      document.querySelector('ion-footer')?.innerText || ''
    `);
    const curMatch = locInfo.match(/Location\s+(\d+)\s+of\s+(\d+)/);
    if (curMatch) {
      currentLoc = parseInt(curMatch[1]);
    }

    if (currentLoc > endLoc) break;

    // Take full-page screenshot (we'll crop later if needed)
    const screenshot = await cdp('Page.captureScreenshot', {
      format: 'png',
      quality: 90,
    });

    const filename = `page_${String(currentLoc).padStart(4, '0')}.png`;
    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      Buffer.from(screenshot.data, 'base64')
    );
    screenshotCount++;

    // Progress
    const pct = totalLocations > 0 ? Math.round((currentLoc / totalLocations) * 100) : '?';
    process.stdout.write(`\r  Location ${currentLoc}/${totalLocations} (${pct}%) — ${screenshotCount} screenshots`);

    // Check if we're stuck (same location after advancing)
    if (locInfo === lastText) {
      stuckCount++;
      if (stuckCount > 3) {
        console.log(`\n\nStuck at location ${currentLoc} — reached end of book or navigation issue.`);
        break;
      }
    } else {
      stuckCount = 0;
    }
    lastText = locInfo;

    // Advance to next page by pressing right arrow
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
    });
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
    });

    // Wait for page to render
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\n\nDone! ${screenshotCount} screenshots saved to ${OUTPUT_DIR}/`);
  console.log(`\nNext step: run OCR on screenshots using Claude Vision`);

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });
