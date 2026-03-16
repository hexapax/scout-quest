#!/usr/bin/env node
/**
 * Fetch per-scout advancement data by injecting API calls into Chrome.
 * Extracts the JWT token from cookies and passes it in Authorization header.
 *
 * Usage: nvm exec 24 node scripts/fetch-scout-data-via-cdp.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'scouting-org-research', 'data', 'fresh');
const ROSTER_FILE = path.join(OUTPUT_DIR, 'organizations_v2_units_E1D07881-103D-43D8-92C4-63DEFDC05D48_youths.json');
const USER_ID = '9120709';
const ORG_GUID = 'E1D07881-103D-43D8-92C4-63DEFDC05D48';
const DELAY_MS = 1200;

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
  const users = roster.users || roster;
  console.log(`Roster: ${users.length} scouts\n`);

  // Connect
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('scouting.org'));
  if (!tab) { console.error('No scouting.org tab.'); process.exit(1); }

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
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };

  // Get JWT token from cookies
  console.log('Extracting auth token from cookies...');
  const cookieResult = await cdp('Network.getCookies', {
    urls: ['https://api.scouting.org', 'https://advancements.scouting.org', 'https://my.scouting.org']
  });
  const tokenCookie = cookieResult.cookies.find(c => c.name === 'token' && c.value.startsWith('eyJ'));
  if (!tokenCookie) {
    console.error('No JWT token cookie found. Are you logged in?');
    console.log('Cookies found:', cookieResult.cookies.map(c => c.name).join(', '));
    process.exit(1);
  }
  const TOKEN = tokenCookie.value;
  console.log(`Got token: ${TOKEN.substring(0, 30)}...\n`);

  // Test
  console.log('Testing API access...');
  const testResult = await apiFetch(`/persons/${USER_ID}/myScout`, TOKEN);
  if (testResult.error || testResult.status !== 200) {
    console.error('API test failed:', testResult);
    process.exit(1);
  }
  console.log('API access OK!\n');

  let count = 0;

  // Per-scout advancement
  console.log('=== Per-Scout Advancement ===\n');
  for (let i = 0; i < users.length; i++) {
    const scout = users[i];
    const uid = scout.userId;
    console.log(`[${i + 1}/${users.length}] ${scout.personFullName} (${uid})`);

    for (const [suffix, label] of [
      [`/advancements/v2/youth/${uid}/ranks`, 'ranks'],
      [`/advancements/v2/youth/${uid}/meritBadges`, 'meritBadges'],
      [`/advancements/v2/youth/${uid}/awards`, 'awards'],
      [`/advancements/v2/${uid}/userActivitySummary`, 'activity'],
    ]) {
      const resp = await apiFetch(suffix, TOKEN);
      const filename = `advancements_v2_youth_${uid}_${label}.json`;
      if (label === 'activity') {
        // activity summary uses different path pattern
        const fn2 = `advancements_v2_${uid}_userActivitySummary.json`;
        if (saveFile(fn2, resp)) count++;
      } else {
        if (saveFile(filename, resp)) count++;
      }
      await sleep(DELAY_MS);
    }
  }

  // Calendar events
  console.log('\n=== Calendar Events ===\n');
  const now = new Date();
  const future = new Date(now); future.setMonth(future.getMonth() + 3);
  const evResp = await apiPost('/advancements/events', {
    organizationGuid: ORG_GUID,
    startDate: now.toISOString().split('T')[0],
    endDate: future.toISOString().split('T')[0],
  }, TOKEN);
  if (saveFile('POST_advancements_events.json', evResp)) count++;
  await sleep(DELAY_MS);

  // Calendars
  const calResp = await apiFetch(`/advancements/v2/users/${USER_ID}/calendars`, TOKEN);
  if (saveFile(`advancements_v2_users_${USER_ID}_calendars.json`, calResp)) count++;

  // Manifest
  const totalFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json') && f !== '_manifest.json').length;
  fs.writeFileSync(path.join(OUTPUT_DIR, '_manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    totalFiles,
    newInThisRun: count,
  }, null, 2));

  console.log(`\n=== Done: ${count} files saved, ${totalFiles} total ===`);
  ws.close();
  process.exit(0);
}

// Direct fetch from Node (not browser) using the extracted token
async function apiFetch(apiPath, token) {
  try {
    const resp = await fetch(`https://api.scouting.org${apiPath}`, {
      headers: {
        'Authorization': `bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://advancements.scouting.org',
        'Referer': 'https://advancements.scouting.org/',
      }
    });
    const text = await resp.text();
    return { status: resp.status, body: text };
  } catch (e) {
    return { error: e.message };
  }
}

async function apiPost(apiPath, body, token) {
  try {
    const resp = await fetch(`https://api.scouting.org${apiPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://advancements.scouting.org',
        'Referer': 'https://advancements.scouting.org/',
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    return { status: resp.status, body: text };
  } catch (e) {
    return { error: e.message };
  }
}

function saveFile(filename, resp) {
  if (resp.error) { console.log(`    ERROR: ${resp.error}`); return false; }
  if (resp.status !== 200) { console.log(`    ${resp.status} ${filename}`); return false; }
  const filepath = path.join(OUTPUT_DIR, filename);
  try { fs.writeFileSync(filepath, JSON.stringify(JSON.parse(resp.body), null, 2)); }
  catch { fs.writeFileSync(filepath, resp.body); }
  console.log(`    OK ${filename}`);
  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
