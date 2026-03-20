#!/usr/bin/env node
/**
 * Explore Kindle Cloud Reader via Chrome CDP.
 * Navigates to read.amazon.com, lists library, and attempts to extract book content.
 *
 * Usage: nvm exec 24 node scripts/scrape/kindle-reader.mjs [--book "Title substring"]
 *
 * Prereq: Chrome running with --remote-debugging-port=9222, logged into Amazon
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'inbox', 'kindle-extract');
const BOOK_FILTER = process.argv.find(a => a.startsWith('--book='))?.split('=').slice(1).join('=')
  || process.argv[process.argv.indexOf('--book') + 1]
  || null;

const MODE = process.argv.includes('--extract') ? 'extract' : 'explore';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let ws, msgId = 0;
const pending = new Map();

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++msgId;
    const timeout = setTimeout(() => {
      pending.delete(mid);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(mid, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Evaluation error');
  }
  return result.result.value;
}

async function main() {
  // Connect to Chrome
  const tabs = await (await fetch('http://localhost:9222/json')).json();
  const tab = tabs.find(t => t.type === 'page');
  if (!tab) { console.error('No tab found'); process.exit(1); }

  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timeout } = pending.get(msg.id);
      clearTimeout(timeout);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };

  console.log(`Connected to Chrome: ${tab.url}\n`);

  // Navigate to Kindle Cloud Reader
  console.log('Navigating to read.amazon.com...');
  await cdp('Page.navigate', { url: 'https://read.amazon.com' });
  await sleep(5000);

  // Check if we're logged in
  const pageUrl = await evaluate('window.location.href');
  const pageTitle = await evaluate('document.title');
  console.log(`Page: ${pageTitle} (${pageUrl})\n`);

  if (pageUrl.includes('signin') || pageUrl.includes('ap/signin')) {
    console.error('Not logged into Amazon. Please log in at read.amazon.com in Chrome first.');
    ws.close();
    process.exit(1);
  }

  // Wait for library to load
  console.log('Waiting for library to load...');
  await sleep(5000);

  // Try to list books in the library
  console.log('=== Exploring Library ===\n');

  // Strategy 1: Look for Kindle Cloud Reader library items
  const libraryInfo = await evaluate(`
    (function() {
      const results = { strategies: [] };

      // Strategy 1: Look for book title elements
      const titles = [];
      document.querySelectorAll('[id*="title"], [class*="title"], [data-asin]').forEach(el => {
        const text = el.textContent?.trim();
        const asin = el.getAttribute('data-asin') || el.closest('[data-asin]')?.getAttribute('data-asin');
        if (text && text.length > 3 && text.length < 200) {
          titles.push({ text: text.substring(0, 100), asin, tag: el.tagName });
        }
      });
      results.strategies.push({ name: 'title-elements', count: titles.length, items: titles.slice(0, 30) });

      // Strategy 2: Look for book cover images with alt text
      const covers = [];
      document.querySelectorAll('img[alt]').forEach(img => {
        const alt = img.alt?.trim();
        if (alt && alt.length > 3 && !alt.includes('Amazon') && !alt.includes('logo')) {
          covers.push({ alt: alt.substring(0, 100), src: img.src?.substring(0, 100) });
        }
      });
      results.strategies.push({ name: 'cover-images', count: covers.length, items: covers.slice(0, 30) });

      // Strategy 3: Look for list/grid items
      const items = [];
      document.querySelectorAll('[role="listitem"], [role="gridcell"], li[class*="book"], div[class*="book"]').forEach(el => {
        const text = el.textContent?.trim()?.substring(0, 200);
        if (text) items.push(text);
      });
      results.strategies.push({ name: 'list-items', count: items.length, items: items.slice(0, 20) });

      // Strategy 4: Check the URL and main content area
      results.url = window.location.href;
      results.bodyText = document.body?.innerText?.substring(0, 3000);

      // Strategy 5: Look for iframes (Kindle reader might use them)
      const iframes = [];
      document.querySelectorAll('iframe').forEach(f => {
        iframes.push({ src: f.src?.substring(0, 200), id: f.id, name: f.name });
      });
      results.strategies.push({ name: 'iframes', count: iframes.length, items: iframes });

      return JSON.stringify(results);
    })()
  `);

  const info = JSON.parse(libraryInfo);
  console.log(`URL: ${info.url}\n`);

  for (const strategy of info.strategies) {
    console.log(`--- ${strategy.name} (${strategy.count} found) ---`);
    for (const item of strategy.items) {
      if (typeof item === 'string') {
        console.log(`  ${item.substring(0, 120)}`);
      } else {
        console.log(`  ${JSON.stringify(item)}`);
      }
    }
    console.log('');
  }

  // Show page text preview
  if (info.bodyText) {
    console.log('--- Page body text (preview) ---');
    console.log(info.bodyText.substring(0, 2000));
    console.log('\n');
  }

  // If a book filter is specified and we found books, try to open it
  if (BOOK_FILTER) {
    console.log(`\nSearching for book matching: "${BOOK_FILTER}"...`);

    const clickResult = await evaluate(`
      (function() {
        const filter = ${JSON.stringify(BOOK_FILTER.toLowerCase())};
        // Look for clickable elements containing the book title
        const allElements = document.querySelectorAll('a, button, [role="button"], [onclick], [data-asin]');
        for (const el of allElements) {
          const text = (el.textContent || el.getAttribute('alt') || el.getAttribute('title') || '').toLowerCase();
          if (text.includes(filter)) {
            return JSON.stringify({
              found: true,
              text: el.textContent?.trim()?.substring(0, 200),
              tag: el.tagName,
              href: el.href || null,
              asin: el.getAttribute('data-asin') || el.closest('[data-asin]')?.getAttribute('data-asin')
            });
          }
        }
        return JSON.stringify({ found: false });
      })()
    `);

    const click = JSON.parse(clickResult);
    if (click.found) {
      console.log(`Found: ${click.text}`);
      console.log(`Tag: ${click.tag}, ASIN: ${click.asin}, href: ${click.href}`);

      if (MODE === 'extract') {
        console.log('\nAttempting to open book...');
        // Try clicking to open the book
        await evaluate(`
          (function() {
            const filter = ${JSON.stringify(BOOK_FILTER.toLowerCase())};
            const allElements = document.querySelectorAll('a, button, [role="button"], [onclick], [data-asin]');
            for (const el of allElements) {
              const text = (el.textContent || el.getAttribute('alt') || el.getAttribute('title') || '').toLowerCase();
              if (text.includes(filter)) {
                el.click();
                return true;
              }
            }
            return false;
          })()
        `);

        console.log('Waiting for reader to load...');
        await sleep(8000);

        // Try to extract text from the reader view
        const readerContent = await evaluate(`
          (function() {
            const results = {};
            results.url = window.location.href;
            results.title = document.title;

            // Look for reader content frames/divs
            const contentAreas = [];

            // Common Kindle reader content selectors
            const selectors = [
              '#kindleReader_content',
              '#kindle-reader-content',
              '[class*="readerContent"]',
              '[class*="book-content"]',
              '[id*="column"]',
              'iframe[id*="reader"]',
              '[role="document"]',
              '#kr-renderer',
              '.kp-notebook-annotations',
            ];

            for (const sel of selectors) {
              document.querySelectorAll(sel).forEach(el => {
                contentAreas.push({
                  selector: sel,
                  tag: el.tagName,
                  text: el.innerText?.substring(0, 1000) || '',
                  html: el.innerHTML?.substring(0, 500) || '',
                  children: el.children?.length || 0,
                });
              });
            }

            results.contentAreas = contentAreas;

            // Also grab all visible text as fallback
            results.bodyText = document.body?.innerText?.substring(0, 5000);

            // Check for iframes
            const iframes = [];
            document.querySelectorAll('iframe').forEach(f => {
              iframes.push({ src: f.src?.substring(0, 200), id: f.id });
              try {
                const doc = f.contentDocument || f.contentWindow?.document;
                if (doc) {
                  iframes[iframes.length-1].text = doc.body?.innerText?.substring(0, 1000);
                }
              } catch(e) {
                iframes[iframes.length-1].crossOrigin = true;
              }
            });
            results.iframes = iframes;

            return JSON.stringify(results);
          })()
        `);

        const reader = JSON.parse(readerContent);
        console.log(`\nReader page: ${reader.title} (${reader.url})`);
        console.log(`Content areas found: ${reader.contentAreas.length}`);
        console.log(`Iframes found: ${reader.iframes.length}\n`);

        for (const area of reader.contentAreas) {
          console.log(`  [${area.selector}] ${area.tag} (${area.children} children)`);
          if (area.text) console.log(`    Text: ${area.text.substring(0, 200)}...`);
        }

        for (const iframe of reader.iframes) {
          console.log(`  [iframe] id=${iframe.id} src=${iframe.src}`);
          if (iframe.text) console.log(`    Text: ${iframe.text.substring(0, 200)}...`);
          if (iframe.crossOrigin) console.log(`    (cross-origin, can't read)`);
        }

        if (reader.bodyText) {
          console.log('\n--- Reader body text ---');
          console.log(reader.bodyText.substring(0, 3000));
        }

        // Save everything we got
        fs.writeFileSync(
          path.join(OUTPUT_DIR, 'reader-exploration.json'),
          JSON.stringify(reader, null, 2)
        );
        console.log(`\nSaved to ${OUTPUT_DIR}/reader-exploration.json`);
      }
    } else {
      console.log('Book not found in clickable elements.');
    }
  }

  // Save the library exploration
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'library-exploration.json'),
    JSON.stringify(info, null, 2)
  );
  console.log(`\nLibrary data saved to ${OUTPUT_DIR}/library-exploration.json`);

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
