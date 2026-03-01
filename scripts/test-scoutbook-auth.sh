#!/bin/bash
# Test Scoutbook BSA authentication with dry-run sync
# Sources SCOUTBOOK_* credentials from ai-chat .env and runs CLI locally

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Extract only SCOUTBOOK_* values from .env (avoid sourcing entire file which has placeholders)
eval "$(grep '^SCOUTBOOK_' "$ROOT_DIR/config/ai-chat/.env")"
export SCOUTBOOK_USERNAME SCOUTBOOK_PASSWORD SCOUTBOOK_ORG_GUID SCOUTBOOK_UNIT_ID

# Override MONGO_URI for local testing
export MONGO_URI=mongodb://localhost:27017/scoutquest

echo "Running Scoutbook sync-all --dry-run..."
echo "SCOUTBOOK_USERNAME=$SCOUTBOOK_USERNAME"
echo "SCOUTBOOK_ORG_GUID=$SCOUTBOOK_ORG_GUID"
echo "SCOUTBOOK_UNIT_ID=$SCOUTBOOK_UNIT_ID"
echo "(password not shown)"

node "$ROOT_DIR/mcp-servers/scout-quest/dist/scoutbook/cli.js" sync-all --dry-run
