# Scoutbook auth — Playwright-driven token refresh

Replaces the manual "F12 → copy `eyJ...` cookie" workflow documented in
CLAUDE.md. After a one-time interactive bootstrap, subsequent token
refreshes are headless and unattended.

## Why this exists

`mcp-servers/scout-quest/src/scoutbook/api-client.ts:authenticate()` POSTs
to `my.scouting.org/api/users/{username}/authenticate` — the JSON-API auth
endpoint, which BSA throttles to 503. The browser sign-in flow is a
separate code path that works. This script drives it.

## What we learned about BSA's auth (verified 2026-04-30)

- **`my.scouting.org/`** is API-only now and returns 404 for any web
  path. Don't load it.
- **`https://advancements.scouting.org/`** is the live SPA (Scoutbook
  Plus). On load it calls `https://auth.scouting.org/api/users/self_<GUID>/sessions/current`;
  no session → redirect to `/login`.
- **The login form has reCAPTCHA v2** (the "I'm not a robot" checkbox).
  Auto-form-fill from a cloud IP is essentially impossible against a
  fresh profile — even with the stealth plugin, reCAPTCHA scores cloud
  IPs as high-risk and serves a challenge. The persistent-profile
  architecture is therefore the *only* viable path: sign in once
  interactively (where reCAPTCHA scores low), persist the profile,
  and reuse the session cookies for ~30 days.
- **No Cloudflare network-level challenge** at the time of writing —
  the page loads cleanly from headless Chrome with stealth on.

## How it works

- **Real Chrome**, not playwright-bundled chromium (`channel: 'chrome'`).
- **Persistent profile** in `./profile/` — cookies + localStorage +
  IndexedDB survive across runs. Subsequent runs find the JWT already in
  cookies and exit without ever touching the form.
- **Stealth plugin** — masks the cheap headless-fingerprint vectors.
- **No auto-form-fill.** The previous version of this script tried to
  fill credentials when cookies were stale; that path is removed because
  reCAPTCHA reliably blocks it. If the persistent session goes stale you
  re-bootstrap (interactive, ~30 seconds) instead.

## Setup

```bash
cd scripts/scoutbook-auth
npm install
npm run install-browser
```

You also need real Chrome installed on the host running this. The dev
VM had it installed via:

```bash
wget -q -O /tmp/chrome-key.pub https://dl.google.com/linux/linux_signing_key.pub
sudo install -D -o root -g root -m 644 /tmp/chrome-key.pub /etc/apt/keyrings/google-chrome.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.asc] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update && sudo apt-get install -y google-chrome-stable
```

## Quick start on Windows

The `windows/` subdir holds three PowerShell scripts. Two of them
(`install-task.ps1`, `refresh.ps1`) are real value-add — they wire up
Windows Task Scheduler and serve as the entry point the scheduled task
invokes. The third (`bootstrap.ps1`) is a thin convenience wrapper
around `npm run bootstrap` that pre-sets env vars; you can skip it if
you'd rather run things by hand.

The architecture in one paragraph: the persistent Chrome profile lives
on the **local Windows filesystem** at `%LOCALAPPDATA%\scoutbook-auth\`
— not on the WSL UNC share, because Chrome on Windows is unreliable
persisting cookies into a UNC profile dir. The repo itself can stay on
`\\wsl.localhost\...`; only the live profile and token sit local. Both
the bootstrap wrapper and `refresh.ps1` set `SCOUTBOOK_PROFILE_DIR` and
`SCOUTBOOK_TOKEN_FILE` to that path so the two sides see the same
state.

From regular PowerShell (not WSL2 — bootstrap needs a Windows-native
Chrome window):

```powershell
cd scripts\scoutbook-auth\windows

# One-time interactive sign-in. Chrome opens, you sign in + click reCAPTCHA,
# the script captures cookies and exits.
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

# Register the weekly headless refresh in Task Scheduler (default: Sunday 3am).
# Run elevated the first time; the task itself runs as your normal user.
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
# Or pick a different time:
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Day Monday -At 06:30
```

**Why `-ExecutionPolicy Bypass`:** if your repo lives on the WSL2
filesystem (`\\wsl.localhost\Ubuntu\…`) Windows tags `.ps1` files there
as remote/untrusted regardless of your ExecutionPolicy setting, and the
default `Restricted` / `RemoteSigned` will refuse to run them. Per-call
bypass is the safest narrow fix. Once `install-task.ps1` runs, the
scheduled task itself is registered with `-ExecutionPolicy Bypass`
already, so the recurring `refresh.ps1` invocations don't have this
problem.

After bootstrap, Task Scheduler runs `windows\refresh.ps1` weekly. Logs
land in `windows\refresh.log` (rotated at 1 MB). The fresh JWT lands
in `..\token.txt`. To verify on demand:

```powershell
Start-ScheduledTask -TaskName ScoutbookTokenRefresh
Get-Content -Tail 30 .\refresh.log
```

The token can be consumed from WSL2 — it's just a file on the Windows
filesystem (`/mnt/c/...`) or on the WSL filesystem accessed from
Windows (`\\wsl$\...`), depending on where you cloned.

## One-time bootstrap (do this on your workstation)

The bootstrap step does the actual interactive sign-in, including the
reCAPTCHA checkbox. Doing it on your own laptop/desktop means BSA sees a
real residential IP and a real Chrome history — reCAPTCHA scores you low
risk and almost always passes silently.

```bash
# On your Mac:
cd scripts/scoutbook-auth
npm install && npm run install-browser
npm run bootstrap
```

A Chrome window opens. Sign in with your `my.scouting.org` credentials,
click the reCAPTCHA checkbox if shown. The script polls cookies every
2 seconds; once a valid JWT is in cookies it writes `token.txt` and
closes the browser.

Then sync the profile to the VM:

```bash
# Tarball the profile (preserve modes for cookie integrity) and ship it
tar czf /tmp/scoutbook-profile.tar.gz -C scripts/scoutbook-auth profile
gcloud compute scp /tmp/scoutbook-profile.tar.gz \
  scout-coach-vm:/tmp/scoutbook-profile.tar.gz \
  --zone=us-east4-b --project=scout-assistant-487523
gcloud compute ssh scout-coach-vm \
  --zone=us-east4-b --project=scout-assistant-487523 \
  --command="cd /opt/repos/scout-quest/scripts/scoutbook-auth && tar xzf /tmp/scoutbook-profile.tar.gz"
```

## Day-to-day refresh (on the VM)

```bash
cd scripts/scoutbook-auth
npm run refresh
# → writes ./token.txt with the current JWT (mode 0600)
```

To use the token for a sync:

```bash
SCOUTBOOK_TOKEN=$(cat scripts/scoutbook-auth/token.txt) \
  bash scripts/run-token-sync-vm.sh
```

## Scheduling

Tokens from BSA's web sign-in are good for ~30 days. Refreshing weekly
gives a comfortable safety margin. Cron entry on the VM:

```cron
# Refresh Scoutbook JWT every Sunday at 03:00 UTC
0 3 * * 0  cd /opt/repos/scout-quest/scripts/scoutbook-auth && npm run refresh >>/var/log/scoutcoach/scoutbook-refresh.log 2>&1
```

If the persistent profile's session goes stale (BSA forces a re-sign-in,
or you change your password), the headless run fails with:

> Session has expired (the SPA redirected to /login). Re-run with
> `--bootstrap` on a workstation with a residential IP, then re-sync the
> profile dir to this host.

A diagnostic screenshot is saved to `./debug/`.

## Bot-detection escape hatches

If headless on the VM ever stops working (BSA tightens detection,
reCAPTCHA appears mid-session, etc.):

1. **`xvfb-run` headed mode on the VM** — boot a virtual display so
   Chrome thinks it's headed:
   ```bash
   sudo apt-get install -y xvfb
   xvfb-run --server-args="-screen 0 1280x900x24" npm run refresh:headed
   ```
2. **Move the cron job to your workstation** instead. The VM pulls
   `token.txt` from a known location.
3. **Last resort**: fall back to the manual cookie-grab workflow from
   CLAUDE.md. The injected-token code path stays in place either way.

## Files

| Path                | Purpose                                       | Gitignored |
|---------------------|-----------------------------------------------|------------|
| `refresh-token.mjs` | Main script                                   | no         |
| `package.json`      | Pinned deps                                   | no         |
| `profile/`          | Persistent Chrome profile (cookies, etc.)     | **yes**    |
| `token.txt`         | Most recently extracted JWT                   | **yes**    |
| `debug/`            | Failure screenshots                           | **yes**    |
