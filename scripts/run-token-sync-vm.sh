#!/bin/bash
# Run Scoutbook sync on the VM using an injected JWT token.
#
# Usage:
#   # Sync ALL scouts in the roster:
#   SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh
#
#   # Sync only specific scouts by userId (space or comma separated):
#   SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh 8539237 12352438
#   SCOUTBOOK_TOKEN=eyJ... SCOUT_IDS="8539237,12352438" bash scripts/run-token-sync-vm.sh
#
# What this script is (and isn't):
# - It is a thin SSH wrapper. The real work — token validation, auth shim,
#   per-scout iteration, jitter, syncSkip filter — lives in the `sync-with-token`
#   subcommand of dist/scoutbook/cli.js. This script just forwards env vars
#   into the scout-quest-api container and runs that subcommand.
# - When the BSA auth flow comes back online, retire this script and call
#   `node dist/scoutbook/cli.js sync-all` directly. The CLI is the canonical path.
#
# Prereq for cross-project SSH from the devbox:
#   See docs/gcloud-admin-mode.md. Two things are required and BOTH are easy to
#   miss, because they fail with errors that look alike:
#
#   1. Impersonation. The devbox default compute SA cannot reach the
#      scout-assistant project, so gcloud must impersonate claude-admin.
#   2. The base account. Impersonation authenticates as core/account FIRST and
#      then mints a token for claude-admin. The devbox has five credentialed
#      accounts across two orgs, so whichever is "active" is arbitrary, and a
#      Meditech account cannot impersonate claude-admin. This script therefore
#      pins the base account rather than trusting gcloud config.
#
#   Telling the failures apart:
#     "Reauthentication failed. cannot prompt during non-interactive execution"
#         -> stale credentials; run `gcloud auth login` in a real TTY on THIS host.
#     "PERMISSION_DENIED ... Failed to impersonate"
#         -> wrong base account; the error text names the account it used.
#
# On a laptop (or anywhere that isn't a GCE instance) there is no metadata
# server, so override the base account to your user identity:
#   GCLOUD_ACCOUNT=jeremy@hexapax.com SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

# Pin the gcloud identity explicitly. Never rely on the active gcloud config:
# with several accounts credentialed, "active" is effectively arbitrary, and
# picking up a Meditech identity for hexapax work is both a failure mode and a
# data-boundary problem. Override either by exporting these before the call.
#
# The default is the devbox's own compute SA, not jeremy@hexapax.com. Both hold
# roles/iam.serviceAccountTokenCreator on claude-admin (see docs/gcloud-admin-mode.md),
# but the compute SA's credentials come from the GCE metadata server, so they
# refresh themselves and never hit Google's periodic reauth challenge. User
# credentials do, and that challenge cannot be answered non-interactively, which
# is what breaks this sync when it's driven by an agent or a cron job.
GCLOUD_ACCOUNT="${GCLOUD_ACCOUNT:-856219795903-compute@developer.gserviceaccount.com}"
IMPERSONATE_SA="${IMPERSONATE_SA:-claude-admin@hexapax-devbox.iam.gserviceaccount.com}"

export CLOUDSDK_CORE_ACCOUNT="$GCLOUD_ACCOUNT"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT="$IMPERSONATE_SA"

# Collect scout IDs from args (positional) OR env var, normalize to comma-separated.
SCOUT_IDS="${SCOUT_IDS:-}"
if [ $# -gt 0 ]; then
  SCOUT_IDS="${SCOUT_IDS:+$SCOUT_IDS,}$(IFS=,; echo "$*")"
fi
SCOUT_IDS="$(echo "$SCOUT_IDS" | tr ' ' ',' | tr -s ',' | sed 's/^,//;s/,$//')"

echo "=== Scoutbook Token Sync ==="
echo "Account:     $GCLOUD_ACCOUNT"
echo "Project:     $PROJECT_ID"
echo "Impersonate: $IMPERSONATE_SA"
if [ -n "$SCOUT_IDS" ]; then
  echo "Targeted:    $SCOUT_IDS"
fi

# Fail fast with a clear message rather than 14 minutes in.
if ! gcloud auth print-access-token --account="$GCLOUD_ACCOUNT" >/dev/null 2>&1; then
  echo "ERROR: no usable credentials for $GCLOUD_ACCOUNT on this host." >&2
  case "$GCLOUD_ACCOUNT" in
    *gserviceaccount.com)
      echo "       That is a service account, so this host is probably not the devbox." >&2
      echo "       Re-run pinned to your user identity:" >&2
      echo "         GCLOUD_ACCOUNT=jeremy@hexapax.com SCOUTBOOK_TOKEN=... bash \$0" >&2
      ;;
    *)
      echo "       Run in a REAL TTY on this machine (not via Claude Code, not on another host):" >&2
      echo "         gcloud auth login --no-launch-browser --account=$GCLOUD_ACCOUNT" >&2
      ;;
  esac
  exit 1
fi

# Single SSH + single docker exec — no host-side temp files, no inline JS heredoc.
gcloud compute ssh scout-coach-vm \
  --zone=us-east4-b \
  --project="$PROJECT_ID" \
  --account="$GCLOUD_ACCOUNT" \
  --tunnel-through-iap \
  --command="
    sudo -u scoutcoach docker exec \
      -e SCOUTBOOK_TOKEN='${TOKEN}' \
      -e SCOUT_IDS='${SCOUT_IDS}' \
      -e SCOUTBOOK_ORG_GUID='E1D07881-103D-43D8-92C4-63DEFDC05D48' \
      -e SCOUTBOOK_UNIT_ID='121894' \
      -e SCOUTBOOK_USERNAME='jebramwell' \
      -e SCOUTBOOK_PASSWORD='dummy' \
      -e MONGO_URI='mongodb://mongodb:27017/scoutquest' \
      scout-quest-api node /app/mcp-servers/scout-quest/dist/scoutbook/cli.js sync-with-token
  " 2>&1

echo ""
echo "=== Sync complete. Run graph loader next: ==="
echo "  ./scripts/ssh-vm.sh 'sudo -u scoutcoach docker exec scout-quest-backend node dist/graph-loader.js'"
