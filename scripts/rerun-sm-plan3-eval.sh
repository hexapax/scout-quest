#!/usr/bin/env bash
# Re-run SM-PLAN3 (+ SM-INS1) after the get_scout_status earned-rank fix
# and scout_buddies description change (commit 5d649d7).
#
# Baseline (2026-04-18 01:33, commit 20d42b3) for SM-PLAN3:
#   Opus 4.7: avg=4.1 (acc 3, coa 5, spe 6, too 4)
#   Opus 4.6: avg=4.0 (acc 2, coa 6, spe 7, too 4)
#   Sonnet:   avg=5.3 (acc 4, coa —, spe 7, too 5)
#
# Expected post-fix: models should see "ALREADY EARNED" instead of 83 reqs
# "Not started" for Finn, reframe Finn as mentor, and more likely call
# scout_buddies (newly described for leader pairing queries).

set -euo pipefail

BUDGET="${1:-5.00}"
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

echo "=== SM-PLAN3 / SM-INS1 re-run (post earned-rank fix) ==="
echo "Backend: $BACKEND_URL"
echo "Budget : \$${BUDGET}"
echo

cd "$PROJECT_ROOT"
python3 scripts/run-eval.py \
  --eval-set scout-eval-scoutmaster-v1.yaml \
  --spectre knowledge \
  --questions SM-PLAN3,SM-INS1 \
  --config backend-claude-opus-47,backend-claude-opus-46-sm,backend-claude-sonnet-46-sm \
  --budget "$BUDGET" \
  --desc "SM-PLAN3/INS1 re-run — verify get_scout_status earned-rank fix (commit 5d649d7)"
