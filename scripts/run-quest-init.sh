#!/bin/bash
# Initialize quest profiles from synced Scoutbook data in local devbox MongoDB
# Run this AFTER run-scoutbook-sync.sh completes
#
# Usage:
#   bash scripts/run-quest-init.sh                  # init all scouts (dry run first!)
#   bash scripts/run-quest-init.sh --dry-run         # preview what would be created
#   bash scripts/run-quest-init.sh "ScoutName"       # init a single scout by name
#   bash scripts/run-quest-init.sh "ScoutName" --scout-email scout@example.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Override MONGO_URI for local devbox (no Scoutbook creds needed — reads from local DB only)
export MONGO_URI=mongodb://localhost:27017/scoutquest

echo "Quest Init — initializing scout profiles from Scoutbook sync data"
echo "MONGO_URI=$MONGO_URI"
echo ""

node "$ROOT_DIR/mcp-servers/scout-quest/dist/scoutbook/cli.js" quest-init "$@"
