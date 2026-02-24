#!/usr/bin/env bash
# setup-librechat.sh — Install LibreChat + dependencies on devbox VM
# Run as devuser: sudo -u devuser bash setup-librechat.sh
# Idempotent: safe to re-run
set -euo pipefail

LIBRECHAT_DIR="$HOME/LibreChat"
SCOUT_QUEST_DIR="$HOME/scout-quest"
NVM_DIR="$HOME/.nvm"

echo "=== Loading nvm ==="
export NVM_DIR
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "=== Node version: $(node -v) ==="

# --- Docker containers (MongoDB + Redis) ---
echo "=== Starting MongoDB ==="
if ! docker ps --format '{{.Names}}' | grep -q '^librechat-mongo$'; then
  docker rm -f librechat-mongo 2>/dev/null || true
  docker run -d --name librechat-mongo --restart unless-stopped \
    -p 127.0.0.1:27017:27017 \
    -v librechat-mongo-data:/data/db \
    mongo:7
  echo "MongoDB started"
else
  echo "MongoDB already running"
fi

echo "=== Starting Redis ==="
if ! docker ps --format '{{.Names}}' | grep -q '^librechat-redis$'; then
  docker rm -f librechat-redis 2>/dev/null || true
  docker run -d --name librechat-redis --restart unless-stopped \
    -p 127.0.0.1:6379:6379 \
    redis:7-alpine
  echo "Redis started"
else
  echo "Redis already running"
fi

# --- Clone LibreChat ---
echo "=== Setting up LibreChat ==="
if [ ! -d "$LIBRECHAT_DIR" ]; then
  git clone https://github.com/danny-avila/LibreChat.git "$LIBRECHAT_DIR"
  echo "LibreChat cloned"
else
  echo "LibreChat directory exists, pulling latest"
  git -C "$LIBRECHAT_DIR" pull --ff-only || echo "Pull failed (not on a branch?), skipping"
fi

# --- Install dependencies ---
echo "=== Installing LibreChat dependencies ==="
cd "$LIBRECHAT_DIR"
npm ci

# --- Build frontend ---
echo "=== Building LibreChat frontend ==="
npm run frontend

# --- Clone scout-quest repo ---
echo "=== Setting up scout-quest repo ==="
if [ ! -d "$SCOUT_QUEST_DIR" ]; then
  git clone https://github.com/jebramwell/scout-quest.git "$SCOUT_QUEST_DIR"
  echo "scout-quest cloned"
else
  echo "scout-quest directory exists"
fi

# --- Install Playwright + Chromium ---
echo "=== Installing Playwright browser ==="
# System deps (apt packages) must be installed separately as root — see deploy script
npx playwright install chromium

# --- Install claude-code-mcp globally ---
echo "=== Installing claude-code-mcp ==="
npm install -g @steipete/claude-code-mcp

# --- Check Claude Code CLI ---
echo "=== Checking Claude Code CLI ==="
if command -v claude &>/dev/null; then
  echo "Claude Code CLI found at: $(which claude)"
  echo "Remember to run 'claude login' manually to authenticate with your Max plan"
else
  echo "WARNING: Claude Code CLI not found in PATH"
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy .env and librechat.yaml to $LIBRECHAT_DIR/"
echo "  2. Run 'claude login' to authenticate Claude Code"
echo "  3. Run 'claude --dangerously-skip-permissions' once to accept terms"
echo "  4. Start LibreChat: cd $LIBRECHAT_DIR && npm run backend"
