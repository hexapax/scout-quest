# Scout Quest UI smoke

Headless-Chromium smoke for `scout-quest.hexapax.com` (or any backend exposed
on `BASE`). Catches static-asset regressions and JS errors that the TS build
+ unit tests miss — for example, the `state.user.scoutEmails` crash that
happens only when the view-toggle is clicked before auth resolves.

## What's checked

**Unauthenticated suite (always runs):**

- `app.html` returns 200, auth gate visible, main app hidden, `#recapCard`
  div present + initially hidden.
- `history.html` returns 200, view-toggle (Conversations | Summaries)
  rendered, click on Summaries pre-auth is **inert** (no crash, no class
  desync) — this is the regression test for the `e118e06` fix.
- `/api/summaries/mine` returns 401 (route alive, auth wall on).
- No `pageerror`, no unexpected `console.error`.

**Authenticated suite (runs only when `SQ_SESSION_COOKIE` is set):**

- `/auth/me` returns the current user, app container visible.
- `/api/summaries/mine` returns a JSON array (200).
- View-toggle on `history.html` is now interactive: clicking Summaries
  swaps the active button, hides the unread filter, updates the search
  placeholder, and refetches the list.
- If the user has at least one summary < 14 days old that hasn't been
  dismissed, the recap card on `app.html` renders with non-empty body.
  (Otherwise the card stays hidden — that's also a pass.)

## Setup

```bash
# One-time install of Playwright + Chromium (~250 MB):
npm --prefix backend/scripts/smoke install
npm --prefix backend/scripts/smoke run install-browser
```

## Running unauthenticated

```bash
npm --prefix backend/scripts/smoke run smoke
# Override the target:
BASE=https://staging.scout-quest.hexapax.com npm --prefix backend/scripts/smoke run smoke
```

## Running authenticated

The harness consumes a `sq_session` JWT cookie via env var. It does **not**
drive the Google OAuth flow — that's brittle to automate, and would
require a real Google account + headed browser. The pattern matches what
CLAUDE.md already documents for `SCOUTBOOK_TOKEN`: capture once, replay
many times, until the cookie expires.

### Capturing the cookie

1. Open `https://scout-quest.hexapax.com` in Chrome and sign in with the
   account whose perspective you want the smoke to test from.
2. Open DevTools (F12) → **Application** → **Storage** → **Cookies** →
   `https://scout-quest.hexapax.com`.
3. Copy the **Value** of the cookie named `sq_session` (a JWT starting
   with `eyJ`).

### Running

```bash
SQ_SESSION_COOKIE=eyJ... npm --prefix backend/scripts/smoke run smoke:auth
```

The cookie is good for 30 days. When the JWT expires the smoke will fail
the `auth/me` check — re-capture and re-run.

## Notes

- The smoke depends only on the deployed backend; it does not need a
  local stack. Run it after `./scripts/deploy-backend.sh` to verify
  changes landed in production.
- Playwright + Chromium are installed into `backend/scripts/smoke/node_modules`
  so they don't bloat the backend production Docker image.
- The recap-card check is sensitive to whether the test account has a
  recent summary in `conversation_summaries`. A "card hidden" outcome is
  a pass when the account legitimately has no recent summary.
