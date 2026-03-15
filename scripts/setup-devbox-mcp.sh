#!/usr/bin/env bash
# Setup MCP servers for Claude Code on devbox
# 1. Installs Node.js system-wide (removes nvm dependency for MCP servers)
# 2. Configures Perplexity + Brave Search MCP for both users
# Usage: Pass secrets as arguments:
#   setup-devbox-mcp.sh <PERPLEXITY_API_KEY> <BRAVE_API_KEY>
set -euo pipefail

PERPLEXITY_KEY="${1:?Usage: $0 <PERPLEXITY_KEY> <BRAVE_KEY>}"
BRAVE_KEY="${2:?Usage: $0 <PERPLEXITY_KEY> <BRAVE_KEY>}"

USERS=(jeremy_hexapax_com devuser)

# --- Step 1: Install Node.js system-wide if not already present ---
if ! command -v /usr/bin/node &>/dev/null; then
  echo "Installing Node.js 24.x system-wide via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
  echo "Node.js $(node --version) installed at $(which node)"
else
  echo "System Node.js already installed: $(/usr/bin/node --version)"
fi

echo "System npx: $(which npx) — $(npx --version)"

# --- Step 2: Configure MCP servers for each user ---
for user in "${USERS[@]}"; do
  echo ""
  echo "=== Configuring $user ==="

  # Remove old perplexity config (may have stale nvm path)
  sudo -u "$user" claude mcp remove perplexity --scope user 2>/dev/null || true

  # Add Perplexity
  sudo -u "$user" claude mcp add --scope user perplexity \
    --env PERPLEXITY_API_KEY="$PERPLEXITY_KEY" \
    -- npx -y @perplexity-ai/mcp-server

  # Remove old brave config if exists
  sudo -u "$user" claude mcp remove brave-search --scope user 2>/dev/null || true

  # Add Brave Search
  sudo -u "$user" claude mcp add --scope user brave-search \
    --env BRAVE_API_KEY="$BRAVE_KEY" \
    -- npx -y @brave/brave-search-mcp-server

  echo "Done: $user"
done

# --- Step 3: Pre-cache npm packages ---
echo ""
echo "Pre-caching MCP server packages..."
npx -y @perplexity-ai/mcp-server --help 2>/dev/null || true
npx -y @brave/brave-search-mcp-server --help 2>/dev/null || true

echo ""
echo "Setup complete. MCP servers configured for: ${USERS[*]}"
echo "  - perplexity: perplexity_ask, perplexity_search, perplexity_research, perplexity_reason"
echo "  - brave-search: brave_web_search, brave_local_search"
