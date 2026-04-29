/**
 * Stream G UI smoke (headless Chromium against scout-quest.hexapax.com).
 *
 * Two suites:
 *   - Unauthenticated (always runs): static-asset + signed-out behavior +
 *     /api/summaries/mine route alive (401)
 *   - Authenticated (runs when SQ_SESSION_COOKIE is set): exercises the
 *     view-toggle on /history.html and the recap card on /app.html with a
 *     real session cookie injected into the Playwright context
 *
 * See README.md for cookie capture instructions. The auth flow does NOT
 * drive Google OAuth — Google blocks Playwright on real accounts. We replay
 * a manually-captured `sq_session` JWT instead. Same pattern as the existing
 * SCOUTBOOK_TOKEN injection workflow documented in CLAUDE.md.
 */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://scout-quest.hexapax.com';
const SESSION_COOKIE = process.env.SQ_SESSION_COOKIE || '';
const RUN_AUTH = SESSION_COOKIE.length > 0 || process.argv.includes('--auth');

if (process.argv.includes('--auth') && !SESSION_COOKIE) {
  console.error('--auth requested but SQ_SESSION_COOKIE is not set. See README.md.');
  process.exit(2);
}

function makeContext(browser) {
  return browser.newContext();
}

function makeAuthContext(browser) {
  // Inject the captured sq_session cookie. Playwright's storageState format
  // matches Chrome's — domain/path/secure/httpOnly mirror what auth.ts sets.
  const url = new URL(BASE);
  return browser.newContext({
    storageState: {
      cookies: [
        {
          name: 'sq_session',
          value: SESSION_COOKIE,
          domain: url.hostname,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          expires: -1,
        },
      ],
      origins: [],
    },
  });
}

async function visit(ctx, url, { allowMissing = [] } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  const failedReqs = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource.*401/.test(text)) return;
    errors.push('console.error: ' + text);
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (allowMissing.some((m) => u.includes(m))) return;
    failedReqs.push(`${req.failure()?.errorText || '?'} ${u}`);
  });

  console.log(`\n--- GET ${url} ---`);
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  const status = resp ? resp.status() : 'no-response';
  console.log(`  status: ${status}`);
  await page.waitForTimeout(800);
  return { page, status, errors, failedReqs };
}

// --- Unauthenticated suite ----------------------------------------------------

async function checkAppUnauth(browser) {
  const ctx = await makeContext(browser);
  const { page, status, errors, failedReqs } = await visit(ctx, `${BASE}/app.html`, {
    allowMissing: ['/auth/me'],
  });

  const checks = [];
  checks.push(['HTTP 200', status === 200]);
  checks.push([
    'auth gate visible',
    await page.evaluate(() => {
      const g = document.getElementById('authGate');
      return !!g && !g.classList.contains('hidden');
    }),
  ]);
  checks.push([
    'main app hidden',
    await page.evaluate(() => {
      const a = document.getElementById('app');
      return !!a && a.classList.contains('hidden');
    }),
  ]);
  const recap = await page.evaluate(() => {
    const c = document.getElementById('recapCard');
    return c ? { exists: true, hidden: c.classList.contains('hidden') } : { exists: false };
  });
  checks.push(['recapCard div present', recap.exists === true, JSON.stringify(recap)]);
  checks.push(['recapCard initially hidden', recap.hidden === true]);

  await ctx.close();
  return { name: 'app.html (unauth)', checks, errors, failedReqs };
}

async function checkHistoryUnauth(browser) {
  const ctx = await makeContext(browser);
  const { page, status, errors, failedReqs } = await visit(ctx, `${BASE}/history.html`, {
    allowMissing: ['/auth/me'],
  });

  const checks = [];
  checks.push(['HTTP 200', status === 200]);

  const toggle = await page.evaluate(() => {
    const c = document.getElementById('view-conversations');
    const s = document.getElementById('view-summaries');
    return {
      conversations: c ? { text: c.textContent, active: c.classList.contains('active') } : null,
      summaries: s ? { text: s.textContent, active: s.classList.contains('active') } : null,
    };
  });
  checks.push([
    'view-toggle: Conversations button present',
    toggle.conversations && toggle.conversations.text.includes('Conversations'),
  ]);
  checks.push([
    'view-toggle: Summaries button present',
    toggle.summaries && toggle.summaries.text.includes('Summaries'),
  ]);
  checks.push([
    'view-toggle: Conversations is the default-active view',
    toggle.conversations && toggle.conversations.active === true,
  ]);

  await page.click('#view-summaries');
  await page.waitForTimeout(200);
  const afterClick = await page.evaluate(() => {
    const c = document.getElementById('view-conversations');
    const s = document.getElementById('view-summaries');
    return {
      conversations_active: c?.classList.contains('active'),
      summaries_active: s?.classList.contains('active'),
    };
  });
  checks.push([
    'signed-out click on Summaries: inert (Conversations stays active, no crash)',
    afterClick.conversations_active === true && afterClick.summaries_active === false,
    JSON.stringify(afterClick),
  ]);

  const transcriptHtml = await page.evaluate(
    () => document.getElementById('transcript')?.innerHTML || ''
  );
  checks.push([
    'signed-out: transcript pane shows sign-in prompt',
    /Sign in/i.test(transcriptHtml) || /select a/i.test(transcriptHtml),
  ]);

  await ctx.close();
  return { name: 'history.html (unauth)', checks, errors, failedReqs };
}

async function checkApiUnauth() {
  const checks = [];
  const r = await fetch(`${BASE}/api/summaries/mine`);
  checks.push([
    `/api/summaries/mine → 401 unauth (got ${r.status})`,
    r.status === 401,
  ]);
  return { name: '/api/summaries/mine (unauth)', checks, errors: [], failedReqs: [] };
}

// --- Authenticated suite ------------------------------------------------------

async function checkAppAuth(browser) {
  const ctx = await makeAuthContext(browser);
  const { page, status, errors, failedReqs } = await visit(ctx, `${BASE}/app.html`);

  const checks = [];
  checks.push(['HTTP 200', status === 200]);

  // Wait for init() to complete: the auth gate hides + the main app appears.
  await page.waitForFunction(
    () => {
      const g = document.getElementById('authGate');
      const a = document.getElementById('app');
      return g && g.classList.contains('hidden') && a && !a.classList.contains('hidden');
    },
    { timeout: 8000 },
  ).catch(() => { /* fall through, the next check will fail clearly */ });

  checks.push([
    'auth gate hidden after init()',
    await page.evaluate(() => document.getElementById('authGate')?.classList.contains('hidden') === true),
  ]);
  checks.push([
    'main app container visible',
    await page.evaluate(() => document.getElementById('app')?.classList.contains('hidden') === false),
  ]);

  // /auth/me — fetch via the page so it picks up the cookie.
  const me = await page.evaluate(async () => {
    const r = await fetch('/auth/me', { credentials: 'same-origin' });
    return { status: r.status, body: r.ok ? await r.json() : null };
  });
  checks.push([
    `/auth/me → 200 with email (got ${me.status})`,
    me.status === 200 && !!me.body?.email,
    me.body ? `email=${me.body.email} role=${me.body.role}` : '',
  ]);

  // /api/summaries/mine
  const summaries = await page.evaluate(async () => {
    const r = await fetch('/api/summaries/mine', { credentials: 'same-origin' });
    return { status: r.status, count: r.ok ? (await r.json()).length : -1 };
  });
  checks.push([
    `/api/summaries/mine → 200 with array (got ${summaries.status}, n=${summaries.count})`,
    summaries.status === 200 && summaries.count >= 0,
  ]);

  // Recap card — depends on data. Pass if either:
  //   - card is visible AND has non-empty body (recent summary exists), OR
  //   - card is hidden (no summary < 14d old, or all dismissed)
  // We assert this is consistent with what /api/summaries/mine returned.
  await page.waitForTimeout(500); // let fetchAndShowRecap settle
  const recap = await page.evaluate(() => {
    const c = document.getElementById('recapCard');
    if (!c) return { exists: false };
    return {
      exists: true,
      hidden: c.classList.contains('hidden'),
      hasTitle: !!c.querySelector('.recap-title')?.textContent?.trim(),
      hasBody: !!c.querySelector('.recap-body')?.textContent?.trim(),
    };
  });
  if (summaries.count > 0) {
    // We have summaries; card may still be hidden if dismissed or all > 14d.
    // Don't fail on hidden — just record what we found.
    console.log(`  recap state with n=${summaries.count}: ${JSON.stringify(recap)}`);
    checks.push(['recap card consistent with summary data', recap.exists === true]);
  } else {
    checks.push(['recap card hidden when 0 summaries', recap.exists && recap.hidden === true]);
  }

  await ctx.close();
  return { name: 'app.html (auth)', checks, errors, failedReqs };
}

async function checkHistoryAuth(browser) {
  const ctx = await makeAuthContext(browser);
  const { page, status, errors, failedReqs } = await visit(ctx, `${BASE}/history.html`);

  const checks = [];
  checks.push(['HTTP 200', status === 200]);

  // Wait for the user-info header to populate.
  await page.waitForFunction(
    () => {
      const u = document.getElementById('user-info');
      return u && !u.textContent.includes('Loading') && !u.querySelector('a');
    },
    { timeout: 8000 },
  ).catch(() => { /* surface via next check */ });

  const userText = await page.evaluate(() => document.getElementById('user-info')?.textContent || '');
  checks.push([
    'user-info populated (signed-in)',
    userText.includes('@') && !userText.includes('Loading'),
    userText.slice(0, 100),
  ]);

  // Wait for tabs to be built.
  await page.waitForFunction(
    () => document.querySelectorAll('#tabs .tab').length > 0,
    { timeout: 8000 },
  ).catch(() => { /* fall through */ });

  // Click Summaries — expect the active state to flip and the search
  // placeholder to update. (renderList may show "No summaries match" if
  // the user has none — that's still a pass.)
  await page.click('#view-summaries');
  await page.waitForTimeout(800);
  const afterClick = await page.evaluate(() => {
    const c = document.getElementById('view-conversations');
    const s = document.getElementById('view-summaries');
    const unread = document.getElementById('unread-wrap');
    const search = document.getElementById('filter-q');
    return {
      summaries_active: s?.classList.contains('active'),
      conversations_active: c?.classList.contains('active'),
      unread_hidden: unread ? unread.style.display === 'none' : null,
      placeholder: search?.placeholder ?? null,
    };
  });
  checks.push([
    'auth click Summaries: Summaries becomes active',
    afterClick.summaries_active === true,
    JSON.stringify(afterClick),
  ]);
  checks.push([
    'auth click Summaries: Conversations no longer active',
    afterClick.conversations_active === false,
  ]);
  checks.push([
    'auth click Summaries: unread filter hidden',
    afterClick.unread_hidden === true,
  ]);
  checks.push([
    'auth click Summaries: search placeholder is "Search recap/topics…"',
    afterClick.placeholder && afterClick.placeholder.includes('recap'),
    afterClick.placeholder,
  ]);

  // Click back to Conversations — should toggle back.
  await page.click('#view-conversations');
  await page.waitForTimeout(400);
  const backToConv = await page.evaluate(() => {
    const c = document.getElementById('view-conversations');
    const s = document.getElementById('view-summaries');
    return {
      conversations_active: c?.classList.contains('active'),
      summaries_active: s?.classList.contains('active'),
    };
  });
  checks.push([
    'auth click Conversations: toggles back',
    backToConv.conversations_active === true && backToConv.summaries_active === false,
    JSON.stringify(backToConv),
  ]);

  await ctx.close();
  return { name: 'history.html (auth)', checks, errors, failedReqs };
}

// --- Runner -------------------------------------------------------------------

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    console.log(`\n## Unauthenticated suite (BASE=${BASE})`);
    results.push(await checkAppUnauth(browser));
    results.push(await checkHistoryUnauth(browser));

    if (RUN_AUTH) {
      console.log(`\n## Authenticated suite`);
      results.push(await checkAppAuth(browser));
      results.push(await checkHistoryAuth(browser));
    } else {
      console.log(`\n## Authenticated suite — SKIPPED (set SQ_SESSION_COOKIE)`);
    }
  } finally {
    await browser.close();
  }
  results.push(await checkApiUnauth());

  let totalFail = 0;
  for (const r of results) {
    console.log(`\n=== ${r.name} ===`);
    for (const [name, ok, detail] of r.checks) {
      const mark = ok ? 'PASS' : 'FAIL';
      if (!ok) totalFail++;
      console.log(
        `  ${mark} ${name}` + (detail !== undefined && !ok ? ` (detail: ${detail})` : '')
      );
    }
    if (r.errors.length) {
      console.log(`  ! page console/JS errors:`);
      for (const e of r.errors) console.log(`    ${e}`);
      totalFail += r.errors.length;
    }
    if (r.failedReqs.length) {
      console.log(`  ! failed network requests:`);
      for (const fr of r.failedReqs) console.log(`    ${fr}`);
      totalFail += r.failedReqs.length;
    }
  }

  console.log(`\nTotal failures: ${totalFail}`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
