#!/usr/bin/env node
/**
 * Read Google Drive documents via Chrome CDP using Google Docs/Sheets export.
 * Uses the Drive export API which works when logged in via cookies.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'scouting-org-research', 'data', 'drive');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Files to read (from the folder crawl)
const FILES = [
  { id: '1s2iGpqyFUUiDPRtCLYsxxiFHLAqdfK5aJDpBrxXwyDU', name: 'All Troop 2024 Scouts by rank 2025-09-14', type: 'sheet' },
  { id: '1vTtsna6nmdTp1JdH5AxnvQjtRVtHubDB', name: 'Troop 2024 General Information 2023-2024', type: 'docx' },
  { id: '18T7H2WRvqt4VoH9oaWDHOCDQBDkfFlvG', name: 'Troop 2024 General Information', type: 'docx' },
  { id: '1Kr_IuVIw6M8oc-Iz956UEy2NsT9SCyznqvfRw5g_WcE', name: 'Troop 2024 Registered Adults & YPT Certification', type: 'gdoc' },
  { id: '19-aX-uhEK3ePEl9QTLkthWPd3p8qBCxN', name: 'Troop 2024 Camping Merit Badge', type: 'xlsx' },
];

// Folders to crawl
const FOLDERS = [
  { id: '1aZoBsbm-Kv-wGXjSPImo75p0pdYHfMW_', name: 'Adult Leadership Meetings' },
  { id: '12OSRkZuSUZ1yOUHw9tWDI2Mel5IFOOyT', name: 'Advancement' },
  { id: '10Z5idiHmh5xS-rI-lr1oVYwL62lCO5A-', name: 'Campouts' },
  { id: '1FM2uF_y43zX6yXHgSeH4b1bhzrkZfiU3', name: 'Finances' },
  { id: '1QjfPUy4Ose2Y6yOl0cNKRAnGxL-1IIxW', name: 'Handouts' },
  { id: '1QFwuagPrTc-uw3o0qJcgQV0kIwHu7pYA', name: 'Life to Eagle Scout' },
  { id: '1bqa2yzfqX1MoRJaj_UHZN_l81OxV3nmm', name: 'Newsletters' },
  { id: '1O4rOOBaOG1t9X3RGm3KmCa1yktBA7TsB', name: 'Patrol Leaders Council' },
  { id: '1WfxWWzEftgvZS0YjNqGvuQ_RGTF_8VUO', name: 'Recruitment' },
  { id: '1Gw1SMy6TZMF8DPE6qwMaNSRmWzj49l4i', name: 'Service Projects' },
  { id: '14vt7wjEJz_GQCkYh-18eygnInoNJCKQ7', name: 'Summer Camp @ Woodruff' },
  { id: '16kcZDCuOSq7Oz6cvaPSzP4POQA84tAsw', name: 'Conservation Weekend 2023' },
  { id: '1NE9-7oMSjmiK_oekH_pkuoZWcQ4DjVBU', name: 'Adult Certifications' },
  { id: '19e_rfAfKduvou1savnripU2kICPjtIEd', name: 'Patrols' },
];

let ws, msgId = 0;
const pending = new Map();

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++msgId;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function readGoogleDoc(fileId) {
  // Export as plain text via the export URL
  const result = await cdp('Runtime.evaluate', {
    expression: `
      (async () => {
        try {
          const resp = await fetch('https://docs.google.com/document/d/${fileId}/export?format=txt');
          if (!resp.ok) return JSON.stringify({ error: resp.status });
          return JSON.stringify({ text: await resp.text() });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

async function readGoogleSheet(fileId) {
  const result = await cdp('Runtime.evaluate', {
    expression: `
      (async () => {
        try {
          const resp = await fetch('https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv');
          if (!resp.ok) return JSON.stringify({ error: resp.status });
          return JSON.stringify({ text: await resp.text() });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

async function readDocxFromDrive(fileId) {
  // For uploaded .docx files, try opening in Google Docs viewer and exporting
  const result = await cdp('Runtime.evaluate', {
    expression: `
      (async () => {
        try {
          // Try direct download as text
          const resp = await fetch('https://drive.google.com/uc?export=download&id=${fileId}');
          if (!resp.ok) {
            // Try Google Docs export (works if file is converted)
            const resp2 = await fetch('https://docs.google.com/document/d/${fileId}/export?format=txt');
            if (!resp2.ok) return JSON.stringify({ error: 'both methods failed: ' + resp.status + ', ' + resp2.status });
            return JSON.stringify({ text: await resp2.text() });
          }
          const blob = await resp.blob();
          // If it's a docx, we can't easily parse it in browser
          // Try reading as text (works for some formats)
          const text = await blob.text();
          if (text.startsWith('PK')) {
            // It's a zip (docx) - try the Docs export instead
            const resp2 = await fetch('https://docs.google.com/document/d/${fileId}/export?format=txt');
            if (resp2.ok) return JSON.stringify({ text: await resp2.text() });
            return JSON.stringify({ error: 'docx binary, docs export failed' });
          }
          return JSON.stringify({ text });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

async function listFolderFiles(folderId) {
  await cdp('Page.navigate', { url: `https://drive.google.com/drive/folders/${folderId}` });
  await sleep(5000);

  const result = await cdp('Runtime.evaluate', {
    expression: `
      (function() {
        const items = [];
        const seen = new Set();
        document.querySelectorAll('[data-id]').forEach(el => {
          const id = el.getAttribute('data-id');
          if (!id || id.length < 10 || seen.has(id)) return;
          seen.add(id);
          const tooltip = el.querySelector('[data-tooltip]')?.getAttribute('data-tooltip') || '';
          if (!tooltip || tooltip.length < 3) return;
          // Skip navigation items
          if (['Home','Projects','My Drive','Computers','Recent items','Starred items',
               'Spam','Trashed items','Storage','Shared','Items shared with me',
               'List layout','Grid layout','Ready for offline','Support','Settings',
               'Advanced search'].includes(tooltip.replace(/ Shared folder$/, ''))) return;

          const isFolder = tooltip.includes('folder');
          const isSheet = tooltip.includes('Google Sheets');
          const isDoc = tooltip.includes('Google Docs');
          const isWord = tooltip.includes('Microsoft Word');
          const isExcel = tooltip.includes('Microsoft Excel');
          const isPdf = tooltip.includes('.pdf');

          let type = 'unknown';
          if (isFolder) type = 'folder';
          else if (isSheet || isExcel) type = 'sheet';
          else if (isDoc) type = 'gdoc';
          else if (isWord) type = 'docx';
          else if (isPdf) type = 'pdf';

          const name = tooltip.replace(/ Shared folder$/, '')
            .replace(/ Google Sheets$/, '')
            .replace(/ Google Docs$/, '')
            .replace(/ Microsoft Word$/, '')
            .replace(/ Microsoft Excel$/, '')
            .trim();

          items.push({ id, name, type, tooltip });
        });
        return JSON.stringify(items);
      })()
    `,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

async function main() {
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page');
  if (!tab) { console.error('No tab'); process.exit(1); }

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };

  // First navigate to Drive so cookies are set
  await cdp('Page.navigate', { url: 'https://drive.google.com' });
  await sleep(3000);

  let totalRead = 0;

  // === Read root-level files ===
  console.log('=== Root Files ===\n');
  for (const file of FILES) {
    console.log(`Reading: ${file.name} (${file.type})...`);
    let result;

    if (file.type === 'gdoc') result = await readGoogleDoc(file.id);
    else if (file.type === 'sheet') result = await readGoogleSheet(file.id);
    else if (file.type === 'docx') result = await readDocxFromDrive(file.id);
    else if (file.type === 'xlsx') result = await readGoogleSheet(file.id); // Try CSV export

    if (result?.text && result.text.length > 20) {
      const safeName = file.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = file.type === 'sheet' ? '.csv' : '.txt';
      fs.writeFileSync(path.join(OUTPUT_DIR, `${safeName}${ext}`), result.text);
      console.log(`  Saved (${result.text.length} chars)`);
      totalRead++;
    } else {
      console.log(`  Failed: ${result?.error || 'no content'}`);
    }
    await sleep(1500);
  }

  // === Crawl each subfolder and read files ===
  console.log('\n=== Subfolders ===\n');

  const allFiles = [];

  for (const folder of FOLDERS) {
    console.log(`\n📁 ${folder.name}`);
    const files = await listFolderFiles(folder.id);
    const realFiles = files.filter(f => f.type !== 'folder' && f.type !== 'unknown');
    console.log(`  ${files.length} items (${realFiles.length} readable files)`);

    for (const file of realFiles) {
      console.log(`  📄 ${file.name} (${file.type})`);
      allFiles.push({ ...file, folder: folder.name });
    }
  }

  // Now read all discovered files
  console.log(`\n=== Reading ${allFiles.length} files from subfolders ===\n`);

  for (const file of allFiles) {
    console.log(`Reading: ${file.folder}/${file.name}...`);
    let result;

    try {
      if (file.type === 'gdoc') result = await readGoogleDoc(file.id);
      else if (file.type === 'sheet') result = await readGoogleSheet(file.id);
      else if (file.type === 'docx') result = await readDocxFromDrive(file.id);
      else continue;

      if (result?.text && result.text.length > 20) {
        const folderDir = path.join(OUTPUT_DIR, file.folder.replace(/[^a-zA-Z0-9_-]/g, '_'));
        fs.mkdirSync(folderDir, { recursive: true });
        const safeName = file.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
        const ext = file.type === 'sheet' ? '.csv' : '.txt';
        fs.writeFileSync(path.join(folderDir, `${safeName}${ext}`), result.text);
        console.log(`  Saved (${result.text.length} chars)`);
        totalRead++;
      } else {
        console.log(`  No content: ${result?.error || 'empty'}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    await sleep(1500);
  }

  console.log(`\n=== Done: ${totalRead} documents read ===`);

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
