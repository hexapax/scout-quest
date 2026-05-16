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
#   See docs/gcloud-admin-mode.md — set CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT
#   to claude-admin@hexapax-devbox.iam.gserviceaccount.com.
set -euo pipefail

TOKEN="${SCOUTBOOK_TOKEN:?SCOUTBOOK_TOKEN env var is required}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

# Collect scout IDs from args (positional) OR env var, normalize to comma-separated.
SCOUT_IDS="${SCOUT_IDS:-}"
if [ $# -gt 0 ]; then
  SCOUT_IDS="${SCOUT_IDS:+$SCOUT_IDS,}$(IFS=,; echo "$*")"
fi
SCOUT_IDS="$(echo "$SCOUT_IDS" | tr ' ' ',' | tr -s ',' | sed 's/^,//;s/,$//')"

echo "=== Scoutbook Token Sync ==="
if [ -n "$SCOUT_IDS" ]; then
  echo "Targeted: $SCOUT_IDS"
fi

# Single SSH + single docker exec — no host-side temp files, no inline JS heredoc.
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
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
