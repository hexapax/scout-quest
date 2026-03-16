#!/usr/bin/env node
/**
 * Capture Scoutbook API data via Chrome DevTools Protocol.
 * Connects to Chrome with --remote-debugging-port=9222,
 * navigates to advancements.scouting.org, captures API responses.
 *
 * Usage: nvm exec 24 node scripts/capture-scoutbook-data.mjs [--wait 90]
 * Prereq: Chrome open with remote debugging, logged into my.scouting.org
 * Requires: Node 24+ (built-in WebSocket + fetch)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'scouting-org-research', 'data', 'fresh');
const WAIT_SECS = parseInt(process.argv.find(a => /^\d+$/.test(a)) || '90');

const API_HOSTS = ['api.scouting.org', 'my.scouting.org'];
const INTERESTING = [
  '/organizations/v2/units/',
  '/advancements/v2/youth/',
  '/advancements/v2/',
  '/advancements/events',
  '/advancements/ranks',
  '/advancements/meritBadges',
  '/advancements/awards',
  '/organizations/v2/',
  '/persons/',
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Find the scouting.org tab
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('scouting.org'));
  if (!tab) { console.error('No scouting.org tab found.'); process.exit(1); }
  console.log(`Tab: ${tab.title} — ${tab.url}`);

  // Connect CDP WebSocket
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const captured = [];

  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);

    // Resolve pending calls
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }

    // Capture API responses
    if (msg.method === 'Network.responseReceived') {
      const { requestId, response } = msg.params;
      const url = response.url;
      if (!API_HOSTS.some(h => url.includes(h))) return;
      if (!INTERESTING.some(p => url.includes(p))) return;

      setTimeout(() => {
        cdp('Network.getResponseBody', { requestId })
          .then(({ body, base64Encoded }) => {
            const text = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
            const filename = urlToFilename(url);
            const filepath = path.join(OUTPUT_DIR, filename);

            try { fs.writeFileSync(filepath, JSON.stringify(JSON.parse(text), null, 2)); }
            catch { fs.writeFileSync(filepath, text); }

            captured.push({ url: url.slice(0, 140), file: filename, status: response.status });
            console.log(`  [${captured.length}] ${response.status} ${filename}`);
          })
          .catch(() => {});
      }, 300);
    }
  };

  // Enable network capture
  await cdp('Network.enable');
  await cdp('Page.enable');
  console.log('Network capture active.\n');

  // Navigate to advancements
  console.log('Navigating to advancements.scouting.org...');
  await cdp('Page.navigate', { url: 'https://advancements.scouting.org' });

  console.log(`Capturing for ${WAIT_SECS}s — interact with Chrome to trigger more API calls.\n`);

  for (let s = 0; s < WAIT_SECS; s += 10) {
    await sleep(10000);
    console.log(`  ${s + 10}s — ${captured.length} captured`);
  }

  // Save manifest
  fs.writeFileSync(path.join(OUTPUT_DIR, '_manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    count: captured.length,
    files: captured,
  }, null, 2));

  console.log(`\n=== Done: ${captured.length} responses saved to ${OUTPUT_DIR} ===`);
  captured.forEach(c => console.log(`  ${c.status} ${c.file}`));

  ws.close();
  process.exit(0);
}

function urlToFilename(url) {
  const u = new URL(url);
  let name = u.pathname.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
  return (name.length > 150 ? name.slice(0, 150) : name) + '.json';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
