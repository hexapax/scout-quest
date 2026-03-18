#!/usr/bin/env node
/**
 * Intercept BSA API calls via Chrome CDP.
 * Connects to Chrome on port 9222, watches all network traffic to api.scouting.org,
 * and logs method, URL, request body, and response for each call.
 *
 * Usage: node scripts/scoutbook/intercept-api.mjs
 * Then interact with advancements.scouting.org in Chrome — all API calls are logged.
 * Press Ctrl+C to stop and save captured data.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, '..', '..', 'scouting-org-research', 'data', 'api-intercept.json');

const captured = [];
const requestBodies = new Map();

async function main() {
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('scouting.org'));
  if (!tab) { console.error('No scouting.org tab found. Is Chrome open?'); process.exit(1); }

  console.log(`Connected to: ${tab.title} (${tab.url})\n`);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();

  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = ++msgId;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);

    // Handle CDP responses
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }

    // Capture request bodies (for POST/PUT/PATCH)
    if (msg.method === 'Network.requestWillBeSent') {
      const { requestId, request } = msg.params;
      if (!request.url.includes('api.scouting.org')) return;

      requestBodies.set(requestId, {
        method: request.method,
        url: request.url,
        headers: request.headers,
        postData: request.postData || null,
        timestamp: new Date().toISOString(),
      });

      const label = request.postData ? `\n  Body: ${request.postData}` : '';
      console.log(`→ ${request.method} ${request.url}${label}`);
    }

    // Capture responses
    if (msg.method === 'Network.responseReceived') {
      const { requestId, response } = msg.params;
      if (!response.url.includes('api.scouting.org')) return;

      const reqInfo = requestBodies.get(requestId) || { method: 'GET', url: response.url };

      // Try to get response body
      setTimeout(() => {
        cdp('Network.getResponseBody', { requestId })
          .then(({ body, base64Encoded }) => {
            const text = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
            let parsed;
            try { parsed = JSON.parse(text); } catch { parsed = text; }

            const entry = {
              method: reqInfo.method,
              url: reqInfo.url,
              status: response.status,
              requestBody: reqInfo.postData ? tryParse(reqInfo.postData) : null,
              responseBody: parsed,
              timestamp: reqInfo.timestamp || new Date().toISOString(),
            };

            captured.push(entry);
            // Only show write operations in detail, summarize reads
            if (reqInfo.method !== 'GET' && reqInfo.method !== 'OPTIONS') {
              console.log(`  ← ${response.status} Response:\n${JSON.stringify(parsed, null, 2)}\n`);
            } else {
              const bodyPreview = typeof parsed === 'object'
                ? JSON.stringify(parsed).substring(0, 150) + '...'
                : String(parsed).substring(0, 150);
              console.log(`  ← ${response.status} (${text.length} bytes) ${bodyPreview}\n`);
            }
            // Auto-save after each write operation
            if (reqInfo.method !== 'GET' && reqInfo.method !== 'OPTIONS') {
              fs.writeFileSync(OUTPUT_FILE, JSON.stringify(captured, null, 2));
            }
          })
          .catch(() => {
            // Body not available
            captured.push({
              method: reqInfo.method,
              url: reqInfo.url,
              status: response.status,
              requestBody: reqInfo.postData ? tryParse(reqInfo.postData) : null,
              responseBody: null,
              timestamp: reqInfo.timestamp || new Date().toISOString(),
            });
          });
      }, 300);
    }
  };

  // Enable network capture
  await cdp('Network.enable');
  console.log('Network interception active. Watching api.scouting.org calls...');
  console.log('Interact with the Scoutbook UI in Chrome. Press Ctrl+C to stop.\n');
  console.log('─'.repeat(70) + '\n');

  // Save on exit
  process.on('SIGINT', () => {
    console.log(`\n\n${'─'.repeat(70)}`);
    console.log(`Captured ${captured.length} API calls.`);
    if (captured.length > 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(captured, null, 2));
      console.log(`Saved to: ${OUTPUT_FILE}`);

      // Summary
      console.log('\n=== Summary ===');
      const methods = {};
      for (const c of captured) {
        const key = `${c.method} ${new URL(c.url).pathname}`;
        methods[key] = (methods[key] || 0) + 1;
      }
      for (const [key, count] of Object.entries(methods).sort()) {
        console.log(`  ${key} × ${count}`);
      }

      // Highlight write operations
      const writes = captured.filter(c => c.method !== 'GET');
      if (writes.length > 0) {
        console.log('\n=== Write Operations ===');
        for (const w of writes) {
          console.log(`\n  ${w.method} ${w.url}`);
          console.log(`  Status: ${w.status}`);
          if (w.requestBody) console.log(`  Body: ${JSON.stringify(w.requestBody, null, 4)}`);
        }
      }
    }
    ws.close();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
