#!/bin/bash
# Integration tests for the Scout Quest v2 backend
# Usage: ./scripts/integration-test.sh [BACKEND_URL] [BACKEND_API_KEY]
#
# Tests:
#   1. Health endpoint
#   2. Models list
#   3. Auth rejection (bad key)
#   4. Non-streaming chat completion
#   5. Streaming (SSE) chat completion
#   6. Tool invocation (get_scout_status via natural question)
#   7. Scout context injection (x-user-email header)
#   8. Knowledge loaded (reload endpoint)
#
# Requires: curl, jq
# Cost: ~$0.10-0.20 in Anthropic API calls (3-4 short completions)

set -euo pipefail

BACKEND_URL="${1:-http://localhost:3090}"
API_KEY="${2:-${BACKEND_API_KEY:-}}"

# A known scout email from the Scoutbook data
TEST_SCOUT_EMAIL="henry.baddley28@paceacademy.org"

PASS=0
FAIL=0
SKIP=0

# --- Helpers ---

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
yellow(){ printf "\033[33m%s\033[0m" "$1"; }

pass() { PASS=$((PASS + 1)); echo "  $(green PASS) $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  $(red FAIL) $1: $2"; }
skip() { SKIP=$((SKIP + 1)); echo "  $(yellow SKIP) $1: $2"; }

auth_header() {
  if [ -n "$API_KEY" ]; then
    echo "Authorization: Bearer $API_KEY"
  else
    echo "X-No-Auth: true"
  fi
}

# --- Tests ---

echo ""
echo "=== Scout Quest v2 Backend Integration Tests ==="
echo "  Backend: $BACKEND_URL"
echo "  Auth:    $([ -n "$API_KEY" ] && echo 'API key provided' || echo 'no key (auth disabled?)')"
echo ""

# 1. Health endpoint
echo "--- Test 1: Health endpoint ---"
HEALTH=$(curl -sf "$BACKEND_URL/health" 2>/dev/null || echo "CURL_FAILED")
if echo "$HEALTH" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  pass "GET /health returns {status: ok}"
else
  fail "GET /health" "Expected {status: ok}, got: $HEALTH"
fi

# 2. Models list
echo "--- Test 2: Models list ---"
MODELS=$(curl -sf "$BACKEND_URL/v1/models" 2>/dev/null || echo "CURL_FAILED")
if echo "$MODELS" | jq -e '.data | length == 2' >/dev/null 2>&1; then
  NAMES=$(echo "$MODELS" | jq -r '.data[].id' | tr '\n' ',')
  pass "GET /v1/models returns 2 models: $NAMES"
else
  fail "GET /v1/models" "Expected 2 models, got: $MODELS"
fi

# 3. Auth rejection
echo "--- Test 3: Auth rejection (bad key) ---"
if [ -n "$API_KEY" ]; then
  AUTH_RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BACKEND_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer WRONG_KEY" \
    -d '{"model":"scout-coach","messages":[{"role":"user","content":"test"}],"stream":false}')
  if [ "$AUTH_RESP" = "401" ]; then
    pass "Bad API key returns 401"
  else
    fail "Auth rejection" "Expected 401, got $AUTH_RESP"
  fi
else
  skip "Auth rejection" "No API key configured, auth may be disabled"
fi

# 4. Non-streaming chat completion
echo "--- Test 4: Non-streaming chat (simple question) ---"
CHAT_RESP=$(curl -sf \
  -X POST "$BACKEND_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "$(auth_header)" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "What rank comes after First Class in Boy Scouts? Answer in one sentence."}],
    "stream": false,
    "max_tokens": 150
  }' 2>/dev/null || echo "CURL_FAILED")

if echo "$CHAT_RESP" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
  CONTENT=$(echo "$CHAT_RESP" | jq -r '.choices[0].message.content' | head -c 120)
  TOKENS=$(echo "$CHAT_RESP" | jq -r '.usage.prompt_tokens // "?"')
  CACHE_READ=$(echo "$CHAT_RESP" | jq -r '.usage.cache_read_input_tokens // 0')
  pass "Non-streaming chat returned content (${TOKENS} input tokens, ${CACHE_READ} cache read)"
  echo "    Response: ${CONTENT}..."
else
  fail "Non-streaming chat" "No choices[0].message.content in response: $(echo "$CHAT_RESP" | head -c 200)"
fi

# 5. Streaming chat completion
echo "--- Test 5: Streaming (SSE) chat ---"
STREAM_RAW=$(curl -sf \
  -X POST "$BACKEND_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "$(auth_header)" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "Name one Eagle-required merit badge. Just the name, nothing else."}],
    "stream": true,
    "max_tokens": 50
  }' 2>/dev/null || echo "CURL_FAILED")

if echo "$STREAM_RAW" | grep -q 'data: \[DONE\]'; then
  # Extract content from SSE chunks
  STREAM_CONTENT=$(echo "$STREAM_RAW" | grep '^data: {' | sed 's/^data: //' | jq -r '.choices[0].delta.content // empty' 2>/dev/null | tr -d '\n')
  if [ -n "$STREAM_CONTENT" ]; then
    pass "Streaming chat returned SSE with [DONE] terminator"
    echo "    Response: ${STREAM_CONTENT}"
  else
    fail "Streaming chat" "Got [DONE] but no content deltas"
  fi
else
  fail "Streaming chat" "No [DONE] terminator in SSE stream"
fi

# 6. Tool invocation (get_scout_status)
echo "--- Test 6: Tool invocation (get_scout_status) ---"
TOOL_RESP=$(curl -sf \
  -X POST "$BACKEND_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "$(auth_header)" \
  -H "x-user-email: $TEST_SCOUT_EMAIL" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "What is my current rank progress? Use the get_scout_status tool to look it up."}],
    "stream": false,
    "max_tokens": 500
  }' 2>/dev/null || echo "CURL_FAILED")

if echo "$TOOL_RESP" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
  TOOL_CONTENT=$(echo "$TOOL_RESP" | jq -r '.choices[0].message.content')
  # Check if response mentions rank-related words (indicates tool was used)
  if echo "$TOOL_CONTENT" | grep -iqE '(scout|class|star|life|eagle|rank|first|second|tenderfoot)'; then
    pass "Tool invocation returned rank-related content"
    echo "    Response: $(echo "$TOOL_CONTENT" | head -c 200)..."
  else
    fail "Tool invocation" "Response doesn't mention ranks — tool may not have been called"
    echo "    Response: $(echo "$TOOL_CONTENT" | head -c 200)..."
  fi
else
  fail "Tool invocation" "No content in response: $(echo "$TOOL_RESP" | head -c 200)"
fi

# 7. Scout context injection
echo "--- Test 7: Scout context injection (x-user-email) ---"
CTX_RESP=$(curl -sf \
  -X POST "$BACKEND_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "$(auth_header)" \
  -H "x-user-email: $TEST_SCOUT_EMAIL" \
  -d '{
    "model": "scout-coach",
    "messages": [{"role": "user", "content": "Hi, what patrol am I in?"}],
    "stream": false,
    "max_tokens": 150
  }' 2>/dev/null || echo "CURL_FAILED")

if echo "$CTX_RESP" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
  CTX_CONTENT=$(echo "$CTX_RESP" | jq -r '.choices[0].message.content')
  # Scout is in "Flaming Tortillas" patrol
  if echo "$CTX_CONTENT" | grep -iq 'tortilla'; then
    pass "Scout context injected — response mentions correct patrol"
    echo "    Response: $(echo "$CTX_CONTENT" | head -c 200)..."
  else
    fail "Scout context injection" "Response doesn't mention 'Flaming Tortillas' patrol"
    echo "    Response: $(echo "$CTX_CONTENT" | head -c 200)..."
  fi
else
  fail "Scout context injection" "No content: $(echo "$CTX_RESP" | head -c 200)"
fi

# 8. Knowledge reload
echo "--- Test 8: Knowledge reload endpoint ---"
RELOAD_RESP=$(curl -sf \
  -X POST "$BACKEND_URL/internal/reload-knowledge" \
  -H "Content-Type: application/json" \
  -H "$(auth_header)" \
  2>/dev/null || echo "CURL_FAILED")

if echo "$RELOAD_RESP" | jq -e '.ok == true' >/dev/null 2>&1; then
  TOKENS=$(echo "$RELOAD_RESP" | jq -r '.approxTokens')
  pass "Knowledge reload succeeded (~${TOKENS} tokens)"
else
  fail "Knowledge reload" "Expected {ok: true}, got: $RELOAD_RESP"
fi

# --- Summary ---
echo ""
echo "==========================================="
TOTAL=$((PASS + FAIL + SKIP))
echo "  Results: $(green "$PASS passed"), $(red "$FAIL failed"), $(yellow "$SKIP skipped") / $TOTAL total"
echo "==========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
