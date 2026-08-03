# gcloud admin mode (cross-project privileged ops)

_Set up 2026-05-11. See `scripts/iam/` for the bootstrap script (path B)._

## The problem

The devbox VM runs `gcloud` as the **low-privilege default compute SA**
(`856219795903-compute@developer.gserviceaccount.com`), forced via the env var
`CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT` set in the VM's shell profile. That
SA has only enough access for routine work and **cannot reach the
`scout-assistant-487523` project** — so things like `gcloud compute ssh
scout-coach-vm --tunnel-through-iap` (used by the Scoutbook sync) fail with
`PERMISSION_DENIED`.

We don't want to widen the default SA, because then *every* routine command
runs with elevated rights. Instead: a separate **admin service account** you
explicitly impersonate when you need it.

## The setup

| Thing | Value |
|---|---|
| Admin SA | `claude-admin@hexapax-devbox.iam.gserviceaccount.com` |
| Roles on `scout-assistant-487523` (project) | `roles/iap.tunnelResourceAccessor`, `roles/compute.osAdminLogin` |
| Role on that project's VM SA (`249395226588-compute@developer.gserviceaccount.com`) | `roles/iam.serviceAccountUser` |
| Who can impersonate it (`roles/iam.serviceAccountTokenCreator`) | `user:jeremy@hexapax.com`, `serviceAccount:856219795903-compute@developer.gserviceaccount.com` (devbox default) |
| gcloud configuration | `admin` — `core/project=scout-assistant-487523`, `auth/impersonate_service_account=claude-admin@…` |

No service-account **key files** anywhere — impersonation only. Cloud Audit
Logs record both the impersonator and the SA, so elevation is always traceable.

## Using it

### On the devbox

The shell profile sets `CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT` to the
default SA, and that env var **overrides** `gcloud config`. So just activating
the `admin` config isn't enough — you must also override the env var.

**One-shot (recommended):**
```bash
CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=claude-admin@hexapax-devbox.iam.gserviceaccount.com \
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap --command='…'
```

The Scoutbook sync needs **no prefix at all** — `run-token-sync-vm.sh` sets its
own `CLOUDSDK_*` vars, defaulting the base account to the devbox compute SA:
```bash
SCOUTBOOK_TOKEN=eyJ... bash /opt/repos/scout-quest/scripts/run-token-sync-vm.sh
```
It pins the base account deliberately rather than trusting `gcloud config`. The
devbox has several credentialed accounts across two orgs, so whichever is
"active" is arbitrary — and a Meditech identity cannot impersonate `claude-admin`,
which fails with a `PERMISSION_DENIED` that looks a lot like a reauth error.
Override with `GCLOUD_ACCOUNT=` / `IMPERSONATE_SA=` when you need something else.

**Persistent for a shell session:**
```bash
export CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=claude-admin@hexapax-devbox.iam.gserviceaccount.com
gcloud config configurations activate admin
# ... do privileged work ...
gcloud config configurations activate default
unset CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT
```

Optional convenience wrapper for `~/.bashrc`:
```bash
gcloud-admin() {
  CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=claude-admin@hexapax-devbox.iam.gserviceaccount.com \
    gcloud --project=scout-assistant-487523 "$@"
}
```

### On your laptop (or any other machine)

A laptop is **not** on GCE, so there's no forced env var and no metadata-server
SA. You're authenticated as `jeremy@hexapax.com`, who already has
`serviceAccountTokenCreator` on `claude-admin`, so it just works:

```bash
gcloud auth login                       # as jeremy@hexapax.com (one time)

# one-shot
gcloud --impersonate-service-account=claude-admin@hexapax-devbox.iam.gserviceaccount.com \
  compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --tunnel-through-iap

# or set up the same named config
gcloud config configurations create admin
gcloud config set --configuration=admin core/project scout-assistant-487523
gcloud config set --configuration=admin auth/impersonate_service_account claude-admin@hexapax-devbox.iam.gserviceaccount.com
gcloud config configurations activate admin     # switch in
gcloud config configurations activate default   # switch out
```

That's the whole story for replication: the SA and all its bindings already
exist server-side; a new machine only needs `gcloud auth login` and (optionally)
the local `admin` config.

## Adding more privileged capabilities later

When you hit "the default SA can't do X", grant role `X` to **`claude-admin`**
(not to the default SA):
```bash
gcloud projects add-iam-policy-binding <project> \
  --member=serviceAccount:claude-admin@hexapax-devbox.iam.gserviceaccount.com \
  --role=roles/<the-role> --condition=None
```
If a task needs *much* broader rights (e.g. org-level), consider a second
purpose-specific SA rather than piling everything onto `claude-admin`.

## Gotchas

- **`Reauthentication failed. cannot prompt during non-interactive execution`** —
  `jeremy@hexapax.com` creds expired. Run `gcloud auth login` interactively
  (on the devbox via Claude Code, type `! gcloud auth login` so it runs in your
  real terminal). **On the devbox, prefer avoiding this entirely**: impersonate
  from the compute SA (`856219795903-compute@developer.gserviceaccount.com`)
  instead of your user account. It's already a `serviceAccountTokenCreator` on
  `claude-admin` per the table above, and its credentials come from the metadata
  server, so they never hit the reauth challenge. This matters for anything an
  agent or a cron job drives, since neither can answer an interactive prompt.
- **`PERMISSION_DENIED ... Failed to impersonate`** — looks similar, different
  cause: the *base* account is wrong. Impersonation authenticates as
  `core/account` first, then mints a token for `claude-admin`. Read the error
  text; it names the account it actually used. Pin `CLOUDSDK_CORE_ACCOUNT`.
- **IAM propagation** — a freshly created SA needs ~30s before it can be added
  as an IAM member; `serviceAccountTokenCreator` bindings took ~3–5 min to go
  live. If impersonation 403s right after setup, wait and retry.
- **Bootstrap chicken-and-egg** — the setup script itself can't run while gcloud
  is impersonating the default SA (it lacks `iam.serviceAccounts.create`). Run
  it with `env -u CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT bash scripts/iam/...`
  so the calls go as `jeremy@hexapax.com` directly.
