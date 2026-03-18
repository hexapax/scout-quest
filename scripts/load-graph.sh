#!/bin/bash
# Load scoutbook data from MongoDB into FalkorDB knowledge graph.
# Run after MongoDB has been populated with Scoutbook data.
#
# Usage: ./scripts/load-graph.sh [gcloud|<VM_IP>]
#
# This runs graph-loader.js inside the backend container on the VM.

set -euo pipefail

MODE="${1:-gcloud}"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

REMOTE_CMD="cd /opt/scoutcoach/scout-quest && sudo -u scoutcoach docker compose exec backend node dist/graph-loader.js"

echo "=== Loading FalkorDB Graph ==="
echo ""

if [ "$MODE" = "gcloud" ]; then
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" \
    --command="$REMOTE_CMD"
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" "$REMOTE_CMD"
fi

echo ""
echo "=== Graph load complete ==="
