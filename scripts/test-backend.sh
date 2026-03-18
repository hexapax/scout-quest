#!/bin/bash
# Backend evaluation test sequence
# Tests all major endpoints and tool paths against the deployed backend
set -euo pipefail

BASE="https://scout-quest.hexapax.com/backend"
SCOUT_EMAIL="jack29mcd@gmail.com"
SCOUT_USERID="11614623"
PASS=0
FAIL=0
TOTAL=0

test_result() {
  local name="$1" ok="$2" detail="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$ok" = "true" ]; then
    PASS=$((PASS + 1))
    echo "  ✓ $name"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ $name — $detail"
  fi
}

echo "============================================"
echo "Scout Quest Backend — Evaluation Tests"
echo "============================================"
echo ""

# --- 1. Health check ---
echo "1. Health & Infrastructure"
HEALTH=$(curl -s "$BASE/health")
test_result "Health endpoint" "$(echo "$HEALTH" | grep -q '"ok"' && echo true || echo false)" "$HEALTH"

MODELS=$(curl -s "$BASE/v1/models")
test_result "Models endpoint" "$(echo "$MODELS" | grep -q 'scout-coach' && echo true || echo false)" "$MODELS"

# --- 2. Static file serving ---
echo ""
echo "2. Micro-App Static Files"
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/progress.html")
test_result "Progress micro-app (HTML)" "$([ "$HTTP" = "200" ] && echo true || echo false)" "HTTP $HTTP"

HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/email.html")
test_result "Email micro-app (HTML)" "$([ "$HTTP" = "200" ] && echo true || echo false)" "HTTP $HTTP"

# --- 3. Progress API ---
echo ""
echo "3. Progress API"
PROGRESS=$(curl -s "$BASE/api/progress?email=$SCOUT_EMAIL")
HAS_NAME=$(echo "$PROGRESS" | grep -q '"name"' && echo true || echo false)
test_result "Progress API returns scout data" "$HAS_NAME" "$PROGRESS"

HAS_RANKS=$(echo "$PROGRESS" | grep -q '"ranks"' && echo true || echo false)
test_result "Progress includes rank data" "$HAS_RANKS" "missing ranks"

HAS_MB=$(echo "$PROGRESS" | grep -q '"meritBadges"' && echo true || echo false)
test_result "Progress includes merit badges" "$HAS_MB" "missing meritBadges"

# --- 4. BSA Token Status ---
echo ""
echo "4. BSA Token Management"
TOKEN_STATUS=$(curl -s "$BASE/bsa-token/status")
test_result "Token status endpoint" "$(echo "$TOKEN_STATUS" | grep -q '"valid"' && echo true || echo false)" "$TOKEN_STATUS"

# --- 5. Chat Completions (the big test — costs real API credits) ---
echo ""
echo "5. Chat Completions (Anthropic API)"
echo "   Sending test query: 'What rank am I working on?'"
echo "   (This calls Anthropic API — may take 10-30s)"

CHAT_RESPONSE=$(curl -s --max-time 60 "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $SCOUT_EMAIL" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "What rank am I currently working on? Just tell me the rank name and percentage."}],
    "stream": false,
    "max_tokens": 300
  }')

HAS_CHOICES=$(echo "$CHAT_RESPONSE" | grep -q '"choices"' && echo true || echo false)
test_result "Chat completions returns choices" "$HAS_CHOICES" "$(echo "$CHAT_RESPONSE" | head -c 200)"

if [ "$HAS_CHOICES" = "true" ]; then
  CONTENT=$(echo "$CHAT_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'][:200])" 2>/dev/null || echo "parse error")
  echo "   Response: $CONTENT"
fi

# --- 6. Tool use test (get_scout_status) ---
echo ""
echo "6. Tool Use — get_scout_status"
echo "   Sending: 'Show me a summary of my advancement progress'"
echo "   (Expects the AI to call get_scout_status tool)"

TOOL_RESPONSE=$(curl -s --max-time 90 "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $SCOUT_EMAIL" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "Show me a detailed summary of my advancement progress — ranks, merit badges, everything."}],
    "stream": false,
    "max_tokens": 1000
  }')

HAS_CONTENT=$(echo "$TOOL_RESPONSE" | grep -q '"choices"' && echo true || echo false)
test_result "Tool use chat returns response" "$HAS_CONTENT" "$(echo "$TOOL_RESPONSE" | head -c 200)"

if [ "$HAS_CONTENT" = "true" ]; then
  TOOL_CONTENT=$(echo "$TOOL_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'][:400])" 2>/dev/null || echo "parse error")
  echo "   Response: $TOOL_CONTENT"
fi

# --- 7. Search tool test ---
echo ""
echo "7. Tool Use — search_bsa_reference"
echo "   Sending: 'What are the exact requirements for the Camping merit badge?'"

SEARCH_RESPONSE=$(curl -s --max-time 90 "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $SCOUT_EMAIL" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "What are the exact requirements for the Camping merit badge? List them."}],
    "stream": false,
    "max_tokens": 1500
  }')

HAS_SEARCH=$(echo "$SEARCH_RESPONSE" | grep -q '"choices"' && echo true || echo false)
test_result "Search tool returns response" "$HAS_SEARCH" "$(echo "$SEARCH_RESPONSE" | head -c 200)"

if [ "$HAS_SEARCH" = "true" ]; then
  SEARCH_CONTENT=$(echo "$SEARCH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'][:400])" 2>/dev/null || echo "parse error")
  echo "   Response: $SEARCH_CONTENT"
fi

# --- Summary ---
echo ""
echo "============================================"
echo "Results: $PASS passed, $FAIL failed, $TOTAL total"
echo "============================================"
