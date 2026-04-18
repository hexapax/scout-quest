#!/usr/bin/env bash
# Run the scoutmaster multi-turn advancement-planning chain against Opus 4.7,
# Opus 4.6, and Sonnet 4.6 — the comparison test the user asked for.
#
# Usage:
#   bash scripts/run-opus47-planning-eval.sh [BUDGET_USD]
#
# Defaults to $15 budget. Override as the first arg.
#
# Sources ANTHROPIC_API_KEY + BACKEND_API_KEY from config/scout-quest/.env so
# the eval engine can hit Anthropic (for direct configs) and the deployed
# backend at api.hexapax.com (for backend-* configs).

set -euo pipefail

BUDGET="${1:-15.00}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="${PROJECT_ROOT}/config/scout-quest/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run ./deploy-config.sh pull first." >&2
  exit 1
fi

# Pluck just the keys we need. Sourcing the whole .env would break — some
# values contain shell metachars like `<GENERATE>` placeholders.
extract_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-
}
export ANTHROPIC_API_KEY="$(extract_env ANTHROPIC_API_KEY)"
export BACKEND_API_KEY="$(extract_env BACKEND_API_KEY)"

if [ -z "$ANTHROPIC_API_KEY" ] || [ -z "$BACKEND_API_KEY" ]; then
  echo "ERROR: missing ANTHROPIC_API_KEY or BACKEND_API_KEY in $ENV_FILE" >&2
  exit 1
fi

export BACKEND_URL="${BACKEND_URL:-https://api.hexapax.com/v1}"

echo "=== Opus 4.7 vs 4.6 vs Sonnet — scoutmaster planning questions ==="
echo "Backend : $BACKEND_URL"
echo "Budget  : \$${BUDGET}"
echo "Items   : SM-INS1..3 + SM-PLAN1..3 (multi-scout advancement-planning + insights)"
echo "Notes   : Chain perspective routes to a deprecated TS harness (CLAUDE.md)."
echo "          Single-turn knowledge-perspective questions cover the same planning scenarios."
echo

cd "$PROJECT_ROOT"

python3 scripts/run-eval.py \
  --eval-set scout-eval-scoutmaster-v1.yaml \
  --spectre knowledge \
  --questions SM-PLAN1,SM-PLAN2,SM-PLAN3,SM-INS1,SM-INS2,SM-INS3 \
  --config backend-claude-opus-47,backend-claude-opus-46-sm,backend-claude-sonnet-46-sm \
  --budget "$BUDGET" \
  --desc "Opus 4.7 vs 4.6 vs Sonnet 4.6 — leader planning + insights questions"
