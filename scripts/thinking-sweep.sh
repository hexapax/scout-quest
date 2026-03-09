#!/usr/bin/env bash
set -euo pipefail

export ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret=anthropic-api-key-test --project=scout-assistant-487523)
NVM_RUN="/opt/repos/scout-quest/scripts/nvm-run.sh"
PREFIX="--prefix /opt/repos/scout-quest/mcp-servers/scout-quest"
HARNESS="/opt/repos/scout-quest/mcp-servers/scout-quest/test/harness.ts"
REPORTS="/opt/repos/scout-quest/mcp-servers/scout-quest/test/reports"

echo "=== Thinking Budget Sweep ==="
echo ""

for BUDGET in 0 2000 5000 10000 16000; do
  if [ "$BUDGET" -eq 0 ]; then
    echo "--- Budget: OFF (no thinking) ---"
    $NVM_RUN npx $PREFIX tsx $HARNESS --scenarios daily-chore --output "$REPORTS/sweep-no-thinking.md" 2>&1 | grep -E '^\s*(Result|Average|\[USAGE\]|\[THINK\])'
  else
    echo "--- Budget: $BUDGET tokens ---"
    $NVM_RUN npx $PREFIX tsx $HARNESS --scenarios daily-chore --thinking --thinking-budget $BUDGET --output "$REPORTS/sweep-${BUDGET}.md" 2>&1 | grep -E '^\s*(Result|Average|\[USAGE\]|\[THINK\])'
  fi
  echo ""
done

echo "=== Sweep complete ==="
