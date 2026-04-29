#!/usr/bin/env bash
# Full scoutmaster v1 single-turn eval sweep across the three Anthropic configs,
# post earned-rank + scout_buddies tool fix (commit 5d649d7).
#
# 8 questions × 3 models = 24 runs. Caching makes this cheap (<$2 typical).
# Baseline sweep from 2026-04-18 01:33 (commit 20d42b3) covered 6 of these
# questions; SM-REF1 and SM-ONB1 are new territory for Opus 4.7.
#
# Usage:
#   bash scripts/run-scoutmaster-full-eval.sh [BUDGET_USD]

set -euo pipefail

BUDGET="${1:-10.00}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/config/scout-quest/.env"

extract_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
export ANTHROPIC_API_KEY="$(extract_env ANTHROPIC_API_KEY)"
export BACKEND_API_KEY="$(extract_env BACKEND_API_KEY)"
export BACKEND_URL="${BACKEND_URL:-https://api.hexapax.com/v1}"

if [ -z "$ANTHROPIC_API_KEY" ] || [ -z "$BACKEND_API_KEY" ]; then
  echo "ERROR: missing ANTHROPIC_API_KEY or BACKEND_API_KEY in $ENV_FILE" >&2
  exit 1
fi

echo "=== Scoutmaster v1 full sweep — Opus 4.7 vs 4.6 vs Sonnet ==="
echo "Questions : SM-INS1..3, SM-PLAN1..3, SM-REF1, SM-ONB1  (8 × 3 configs)"
echo "Backend   : $BACKEND_URL"
echo "Budget    : \$${BUDGET}"
echo

cd "$PROJECT_ROOT"
python3 scripts/run-eval.py \
  --eval-set scout-eval-scoutmaster-v1.yaml \
  --spectre knowledge \
  --questions SM-INS1,SM-INS2,SM-INS3,SM-PLAN1,SM-PLAN2,SM-PLAN3,SM-REF1,SM-ONB1 \
  --config backend-claude-opus-47,backend-claude-opus-46-sm,backend-claude-sonnet-46-sm \
  --budget "$BUDGET" \
  --desc "Scoutmaster v1 full sweep — post earned-rank fix (commit 62afe19)"
