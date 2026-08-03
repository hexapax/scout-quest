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
# Cross-project SSH identity (impersonation, base account pinning, IAP) is
# handled by scripts/lib/gcloud-identity.sh, shared with ssh-vm.sh. Read that
# file, or docs/gcloud-admin-mode.md, before changing how auth works here.
#
# On a laptop (or anywhere that isn't a GCE instance) there is no metadata
# server, so override the base account to your user identity:
#   GCLOUD_ACCOUNT=jeremy@hexapax.com SCOUTBOOK_TOKEN=eyJ... bash scripts/run-token-sync-vm.sh
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"

source "$(dirname "${BASH_SOURCE[0]}")/lib/gcloud-identity.sh"

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

# Fail fast with a clear message rather than 18 minutes in.
gcloud_identity_preflight || exit 1

# Single SSH + single docker exec — no host-side temp files, no inline JS heredoc.
gcloud compute ssh "$VM_NAME" \
  --zone="$VM_ZONE" \
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
