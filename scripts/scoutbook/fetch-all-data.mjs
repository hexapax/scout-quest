#!/usr/bin/env node
/**
 * Comprehensive Scoutbook data fetch via Chrome CDP.
 * Extracts JWT from cookies, fetches ALL data including per-requirement detail.
 *
 * Usage: nvm exec 24 node scripts/scoutbook/fetch-all-data.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'scouting-org-research', 'data', 'fresh');
const ORG_GUID = 'E1D07881-103D-43D8-92C4-63DEFDC05D48';
const UNIT_ID = '121894';
const USER_ID = '9120709';
const DELAY_MS = 800;

let TOKEN = '';
let count = 0;
let errors = 0;

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get token from Chrome
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('scouting.org') && !t.url.includes('login'));
  if (!tab) { console.error('No logged-in scouting.org tab found.'); process.exit(1); }

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

  // Extract token
  const cookies = await cdp('Network.getCookies', {
    urls: ['https://api.scouting.org', 'https://advancements.scouting.org', 'https://my.scouting.org']
  });
  const tokenCookie = cookies.cookies.find(c => c.name === 'token' && c.value.startsWith('eyJ'));
  if (!tokenCookie) { console.error('No JWT token found. Log in first.'); process.exit(1); }
  TOKEN = tokenCookie.value;
  console.log(`Token: ${TOKEN.substring(0, 25)}...`);
  ws.close();

  // Test
  const test = await apiFetch(`/persons/${USER_ID}/myScout`);
  if (!test.ok) { console.error('API test failed:', test.status); process.exit(1); }
  console.log('API OK\n');

  // === ROSTER ===
  console.log('=== Roster ===');
  await fetchAndSave(`/organizations/v2/units/${ORG_GUID}/youths`, `org_units_youths.json`);
  await fetchAndSave(`/organizations/v2/units/${ORG_GUID}/adults`, `org_units_adults.json`);
  await fetchAndSave(`/organizations/v2/units/${ORG_GUID}/parents`, `org_units_parents.json`);
  await fetchAndSave(`/organizations/v2/units/${ORG_GUID}/subUnits`, `org_units_subUnits.json`);

  // === ORG DATA ===
  console.log('\n=== Org Data ===');
  await fetchAndSave(`/organizations/v2/${ORG_GUID}/advancementDashboard`, `org_advancementDashboard.json`);
  await fetchAndSave(`/organizations/v2/${ORG_GUID}/unitActivitiesDashboard`, `org_unitActivitiesDashboard.json`);
  await fetchAndSave(`/organizations/v2/${ORG_GUID}/profile`, `org_profile.json`);

  // === REFERENCE DATA ===
  console.log('\n=== Reference Data ===');
  await fetchAndSave('/advancements/ranks', 'ref_ranks.json');
  await fetchAndSave('/advancements/meritBadges', 'ref_meritBadges.json');
  await fetchAndSave('/advancements/awards', 'ref_awards.json');

  // === RANK REQUIREMENT DEFINITIONS ===
  console.log('\n=== Rank Requirement Definitions ===');
  // Scouts BSA rank IDs: 1=Scout, 2=Tenderfoot, 3=Second Class, 4=First Class, 5=Star, 6=Life, 7=Eagle
  for (const rankId of [1, 2, 3, 4, 5, 6, 7]) {
    await fetchAndSave(`/advancements/v2/ranks/${rankId}/requirements`, `ref_rank_${rankId}_requirements.json`);
  }

  // === LOAD ROSTER FOR PER-SCOUT FETCHING ===
  const rosterFile = path.join(OUTPUT_DIR, 'org_units_youths.json');
  const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf-8'));
  const users = roster.users || roster;
  console.log(`\n=== Per-Scout Data (${users.length} scouts) ===\n`);

  for (let i = 0; i < users.length; i++) {
    const scout = users[i];
    const uid = scout.userId;
    console.log(`[${i + 1}/${users.length}] ${scout.personFullName} (${uid})`);

    // Ranks summary
    const ranksData = await fetchAndSave(`/advancements/v2/youth/${uid}/ranks`, `youth_${uid}_ranks.json`);

    // Merit Badges
    await fetchAndSave(`/advancements/v2/youth/${uid}/meritBadges`, `youth_${uid}_meritBadges.json`);

    // Awards
    await fetchAndSave(`/advancements/v2/youth/${uid}/awards`, `youth_${uid}_awards.json`);

    // Activity Summary
    await fetchAndSave(`/advancements/v2/${uid}/userActivitySummary`, `youth_${uid}_activitySummary.json`);

    // Per-rank requirements — fetch for ranks that are in progress
    if (ranksData) {
      for (const prog of (ranksData.program || [])) {
        if (!prog.program?.includes('Scouts BSA')) continue;
        for (const rank of (prog.ranks || [])) {
          const pct = rank.percentCompleted || 0;
          // Fetch requirements for any rank that's started or awarded (we want the completion data)
          if (pct > 0 || rank.status === 'Awarded') {
            await fetchAndSave(
              `/advancements/v2/youth/${uid}/ranks/${rank.id}/requirements`,
              `youth_${uid}_rank_${rank.id}_requirements.json`
            );
          }
        }
      }
    }

    // Person profile
    await fetchAndSave(`/persons/v2/${uid}/personprofile`, `person_${uid}_profile.json`);
  }

  // === CALENDAR ===
  console.log('\n=== Calendar ===');
  const now = new Date();
  const future = new Date(now); future.setMonth(future.getMonth() + 3);
  const past = new Date(now); past.setMonth(past.getMonth() - 1);

  await fetchPostAndSave('/advancements/events', {
    organizationGuid: ORG_GUID,
    startDate: past.toISOString().split('T')[0],
    endDate: future.toISOString().split('T')[0],
  }, 'events.json');

  await fetchAndSave(`/advancements/v2/users/${USER_ID}/calendars`, `user_calendars.json`);

  // === MANIFEST ===
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  fs.writeFileSync(path.join(OUTPUT_DIR, '_manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    totalFiles: files.length,
    fetched: count,
    errors,
  }, null, 2));

  console.log(`\n=== DONE: ${count} fetched, ${errors} errors, ${files.length} total files ===`);
  process.exit(0);
}

async function apiFetch(apiPath) {
  await sleep(DELAY_MS);
  return fetch(`https://api.scouting.org${apiPath}`, {
    headers: {
      'Authorization': `bearer ${TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://advancements.scouting.org',
      'Referer': 'https://advancements.scouting.org/',
    }
  });
}

async function fetchAndSave(apiPath, filename) {
  try {
    const resp = await apiFetch(apiPath);
    if (resp.status !== 200) {
      console.log(`    ${resp.status} SKIP ${filename}`);
      errors++;
      return null;
    }
    const data = await resp.json();
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
    console.log(`    OK ${filename}`);
    count++;
    return data;
  } catch (e) {
    console.log(`    ERR ${filename}: ${e.message}`);
    errors++;
    return null;
  }
}

async function fetchPostAndSave(apiPath, body, filename) {
  try {
    await sleep(DELAY_MS);
    const resp = await fetch(`https://api.scouting.org${apiPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://advancements.scouting.org',
        'Referer': 'https://advancements.scouting.org/',
      },
      body: JSON.stringify(body),
    });
    if (resp.status !== 200) {
      console.log(`    ${resp.status} SKIP ${filename}`);
      errors++;
      return null;
    }
    const data = await resp.json();
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
    console.log(`    OK ${filename}`);
    count++;
    return data;
  } catch (e) {
    console.log(`    ERR ${filename}: ${e.message}`);
    errors++;
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
