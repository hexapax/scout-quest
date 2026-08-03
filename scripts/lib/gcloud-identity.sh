#!/bin/bash
# Shared gcloud identity setup for privileged access to the scout-assistant
# project (scout-coach-vm). Source this, don't execute it:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/gcloud-identity.sh"
#   gcloud_identity_preflight          # optional; fails fast with a clear message
#   gcloud compute ssh ... --account="$GCLOUD_ACCOUNT" --tunnel-through-iap
#
# Why this file exists: two scripts (ssh-vm.sh and run-token-sync-vm.sh) both
# SSH to the same VM in the same cross-project way. They had drifted, and only
# one of them worked from the devbox. One copy of the rules, imported by both.
#
# The rules, in short:
#
#   1. Impersonate claude-admin. The devbox default compute SA cannot reach the
#      scout-assistant-487523 project on its own.
#   2. Pin the base account. Impersonation authenticates as core/account FIRST,
#      then mints a token for claude-admin. The devbox has several credentialed
#      accounts across two orgs, so whichever is "active" is arbitrary, and a
#      Meditech account cannot impersonate claude-admin. Never trust gcloud config.
#   3. Default the base account to the devbox compute SA, not a user identity.
#      Both hold roles/iam.serviceAccountTokenCreator on claude-admin, but the
#      compute SA's credentials come from the GCE metadata server and refresh
#      themselves. User credentials hit Google's periodic reauth challenge,
#      which cannot be answered non-interactively, so anything driven by an
#      agent or a cron job breaks on it.
#   4. Tunnel through IAP. The VM has no public SSH path.
#
# Overrides: export GCLOUD_ACCOUNT / IMPERSONATE_SA / PROJECT_ID before sourcing.
# Off the devbox (a laptop has no metadata server), use your user identity:
#   GCLOUD_ACCOUNT=jeremy@hexapax.com ./scripts/ssh-vm.sh "docker ps"
#
# Full background: docs/gcloud-admin-mode.md

PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"
VM_NAME="${VM_NAME:-scout-coach-vm}"
VM_ZONE="${VM_ZONE:-us-east4-b}"
GCLOUD_ACCOUNT="${GCLOUD_ACCOUNT:-856219795903-compute@developer.gserviceaccount.com}"
IMPERSONATE_SA="${IMPERSONATE_SA:-claude-admin@hexapax-devbox.iam.gserviceaccount.com}"

export CLOUDSDK_CORE_ACCOUNT="$GCLOUD_ACCOUNT"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT="$IMPERSONATE_SA"

# Verify the base credential is usable before starting long work. The two auth
# failures here look alike in the wild, so name them explicitly:
#   "Reauthentication failed. cannot prompt during non-interactive execution"
#       -> stale user credentials; needs a real TTY.
#   "PERMISSION_DENIED ... Failed to impersonate"
#       -> wrong base account; the error text names the account it used.
gcloud_identity_preflight() {
  if gcloud auth print-access-token --account="$GCLOUD_ACCOUNT" >/dev/null 2>&1; then
    return 0
  fi
  echo "ERROR: no usable credentials for $GCLOUD_ACCOUNT on this host." >&2
  case "$GCLOUD_ACCOUNT" in
    *gserviceaccount.com)
      echo "       That is a service account, so this host is probably not the devbox." >&2
      echo "       Re-run pinned to your user identity:" >&2
      echo "         GCLOUD_ACCOUNT=jeremy@hexapax.com $0 ..." >&2
      ;;
    *)
      echo "       Run in a REAL TTY on this machine (not via Claude Code, not on another host):" >&2
      echo "         gcloud auth login --no-launch-browser --account=$GCLOUD_ACCOUNT" >&2
      ;;
  esac
  return 1
}
