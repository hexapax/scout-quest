#!/bin/bash
# ============================================
# permission-gate.sh — PreToolUse hook for Claude Code
# ============================================
# Reads tool call JSON from stdin. Decides whether to:
#   - Auto-approve (exit 0): safe, read-only operations
#   - Auto-deny (exit 2): dangerous/destructive patterns
#   - Request human approval via Telegram (exit 0 or 2 based on response)
#
# Communication with telegram bot:
#   Writes request to /tmp/claude-approval-{uuid}.request
#   Polls for /tmp/claude-approval-{uuid}.response (timeout: 5 min)

set -euo pipefail

APPROVAL_DIR="/tmp/claude-approvals"
TIMEOUT_SECONDS=300  # 5 minutes

mkdir -p "${APPROVAL_DIR}"

# Read tool call from stdin (JSON with tool_name, tool_input object)
INPUT=$(cat)
TOOL_NAME=$(echo "${INPUT}" | jq -r '.tool_name // empty')

# If not a Bash tool call, auto-approve (other tools are handled by settings.json)
if [ "${TOOL_NAME}" != "Bash" ]; then
  exit 0
fi

# Extract the command — tool_input is an object with a .command field for Bash
COMMAND=$(echo "${INPUT}" | jq -r '.tool_input.command // empty')

if [ -z "${COMMAND}" ]; then
  exit 0
fi

# --- Auto-approve: safe read-only and dev commands ---
SAFE_PATTERNS=(
  "^git status"
  "^git diff"
  "^git log"
  "^git branch"
  "^git stash"
  "^git show"
  "^ls "
  "^cat "
  "^head "
  "^tail "
  "^wc "
  "^pwd$"
  "^echo "
  "^npx tsc"
  "^npm test"
  "^npm run"
  "^node "
  "^which "
  "^file "
  "^stat "
  "^du "
  "^df "
  "^uname"
  "^date$"
  "^whoami$"
  "^env$"
  "^printenv"
)

for pattern in "${SAFE_PATTERNS[@]}"; do
  if echo "${COMMAND}" | grep -qE "${pattern}"; then
    exit 0
  fi
done

# --- Auto-deny: dangerous patterns ---
DENY_PATTERNS=(
  "rm -rf /"
  "git push --force.*main"
  "git push --force.*master"
  "git reset --hard"
  "DROP TABLE"
  "DROP DATABASE"
  "shutdown"
  "reboot"
  "mkfs"
  "dd if="
  "> /dev/"
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "${COMMAND}" | grep -qF "${pattern}"; then
    echo '{"decision": "block", "reason": "Auto-denied: dangerous command pattern"}' >&2
    exit 2
  fi
done

# --- Everything else: request human approval via Telegram ---
UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)
REQUEST_FILE="${APPROVAL_DIR}/${UUID}.request"
RESPONSE_FILE="${APPROVAL_DIR}/${UUID}.response"

# Write approval request
cat > "${REQUEST_FILE}" << EOF
{
  "uuid": "${UUID}",
  "tool_name": "${TOOL_NAME}",
  "command": $(echo "${COMMAND}" | jq -Rs .),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Poll for response
ELAPSED=0
POLL_INTERVAL=2

while [ ${ELAPSED} -lt ${TIMEOUT_SECONDS} ]; do
  if [ -f "${RESPONSE_FILE}" ]; then
    DECISION=$(jq -r '.decision' "${RESPONSE_FILE}" 2>/dev/null || echo "deny")
    REASON=$(jq -r '.reason // "Denied by human"' "${RESPONSE_FILE}" 2>/dev/null || echo "Denied by human")
    # Clean up
    rm -f "${REQUEST_FILE}" "${RESPONSE_FILE}"
    if [ "${DECISION}" = "approve" ]; then
      exit 0
    else
      echo "{\"decision\": \"block\", \"reason\": \"${REASON}\"}" >&2
      exit 2
    fi
  fi
  sleep ${POLL_INTERVAL}
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# Timeout — deny by default
rm -f "${REQUEST_FILE}"
echo '{"decision": "block", "reason": "Approval timeout (5 min) — auto-denied"}' >&2
exit 2
