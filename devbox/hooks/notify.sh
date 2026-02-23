#!/bin/bash
# ============================================
# notify.sh — PostToolUse hook for Claude Code
# ============================================
# Sends a notification to Telegram when significant tool calls complete.
# Reads tool result from stdin, forwards summary to the telegram bot's
# notification endpoint.

set -euo pipefail

NOTIFY_FILE="/tmp/claude-approvals/notify"

# Read tool call/result from stdin (JSON with tool_name, tool_input, tool_result)
INPUT=$(cat)
TOOL_NAME=$(echo "${INPUT}" | jq -r '.tool_name // empty')

# Only notify for significant operations (skip reads/searches)
NOTIFY_TOOLS=("Bash" "Edit" "Write")

SHOULD_NOTIFY=false
for tool in "${NOTIFY_TOOLS[@]}"; do
  if [ "${TOOL_NAME}" = "${tool}" ]; then
    SHOULD_NOTIFY=true
    break
  fi
done

if [ "${SHOULD_NOTIFY}" = false ]; then
  exit 0
fi

# Write notification for the telegram bot to pick up
cat > "${NOTIFY_FILE}.$(date +%s%N)" << EOF
{
  "tool_name": "${TOOL_NAME}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

exit 0
